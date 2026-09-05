// Making a multi-file ES-module app runnable inside a sandboxed iframe.
//
// The generated app imports its own files by relative path ("./contract.js"),
// which cannot resolve without a real directory to resolve against. Each
// module is therefore turned into a data: URL and every relative import is
// rewritten to point at it, deepest dependency first.
//
// data: URLs rather than blob: URLs, and srcdoc rather than src, because the
// preview iframe runs sandboxed WITHOUT allow-same-origin: it gets an opaque
// origin, and Chrome refuses to load a blob: URL there ("Not allowed to load
// local resource"). Granting allow-same-origin would fix that by making the
// frame same-origin with DevStation, which would let generated code: some of
// it written by the AI: read DevStation's localStorage, including AI provider
// API keys. Not worth it. data: URLs and srcdoc work under a full sandbox,
// verified in Chrome.
//
// This is why the generated app keeps a shallow, acyclic module graph: it can
// be linearised without a bundler.

export interface PreviewBundle {
  /** Full HTML document for the iframe's srcdoc attribute. */
  srcdoc: string;
  /** Kept for API symmetry; data: URLs need no cleanup. */
  revoke: () => void;
}

/** Tag for error reports posted out of the preview. */
export const PREVIEW_ERROR_TAG = "devstation-preview-error";

export interface PreviewError {
  kind: "error" | "unhandledrejection" | "module";
  message: string;
  source?: string;
  line?: number;
  stack?: string;
}

// Injected into every preview. Without it a failed module leaves a white
// frame and nothing else: no console the user can see, no signal the agent can
// act on, and "the preview is blank" as the only available bug report. This
// forwards anything that goes wrong to the host, which surfaces it in the UI
// and feeds it back into the next turn of the conversation.
const ERROR_REPORTER = `<script>
(function () {
  var TAG = ${JSON.stringify("devstation-preview-error")};
  function send(payload) {
    try { parent.postMessage({ tag: TAG, error: payload }, "*"); } catch (e) {}
  }
  window.addEventListener("error", function (e) {
    // Failed module/script loads surface as an error event on the element.
    if (e.target && e.target !== window && (e.target.src || e.target.href)) {
      send({ kind: "module", message: "Failed to load " + (e.target.src || e.target.href) });
      return;
    }
    send({
      kind: "error",
      message: String(e.message || "Script error"),
      source: e.filename ? String(e.filename).slice(0, 120) : undefined,
      line: e.lineno,
      stack: e.error && e.error.stack ? String(e.error.stack).slice(0, 800) : undefined
    });
  }, true);
  window.addEventListener("unhandledrejection", function (e) {
    var r = e.reason;
    send({
      kind: "unhandledrejection",
      message: r && r.message ? String(r.message) : String(r),
      stack: r && r.stack ? String(r.stack).slice(0, 800) : undefined
    });
  });
  // Nothing mounted after load usually means the entry module threw before
  // render, which produces no error event of its own in some cases.
  window.addEventListener("load", function () {
    setTimeout(function () {
      var root = document.getElementById("root");
      if (root && root.childElementCount === 0 && document.body.innerText.trim() === "") {
        send({ kind: "module", message: "The app loaded but rendered nothing: the entry module probably threw before mounting." });
      }
    }, 2500);
  });
})();
</script>`;

/** Relative import specifiers in a module, e.g. "./contract.js". */
function relativeImports(source: string): string[] {
  const out = new Set<string>();
  // Covers `from "./x.js"`, `import "./x.js"` and `import("./x.js")`.
  for (const m of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.\/[^"']+)["']/g)) {
    out.add(m[1]);
  }
  return [...out];
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/**
 * Build a runnable preview from a generated app's files.
 *
 * `files` is keyed by workspace path; only the app's own directory is used.
 * Throws if the module graph cannot be linearised (a cycle), rather than
 * silently producing a page that fails at runtime with an opaque error.
 */
export function buildPreview(files: Record<string, string>, dir = "app"): PreviewBundle {
  const prefix = dir ? `${dir}/` : "";
  const own: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith(prefix)) own[baseName(path)] = content;
  }

  const html = own["index.html"];
  if (!html) throw new Error(`No index.html found in "${dir}".`);

  const urlFor = new Map<string, string>();
  // encodeURIComponent rather than btoa: the generated sources contain
  // non-ASCII characters (em dashes in comments), which btoa cannot encode.
  const moduleUrl = (content: string) =>
    `data:text/javascript;charset=utf-8,${encodeURIComponent(content)}`;
  const revoke = () => {};

  {
    // Resolve modules deepest-first: a module can only be turned into a
    // data: URL once every module it imports already has one.
    const modules = Object.keys(own).filter((n) => n.endsWith(".js"));
    let remaining = [...modules];
    let guard = modules.length + 1;
    while (remaining.length > 0) {
      if (guard-- <= 0) {
        throw new Error(
          `Could not resolve the module graph in "${dir}": check for a circular import between ${remaining.join(", ")}.`,
        );
      }
      const next: string[] = [];
      for (const name of remaining) {
        const deps = relativeImports(own[name]).map(baseName);
        if (deps.some((d) => own[d] !== undefined && !urlFor.has(d))) {
          next.push(name); // a dependency is not ready yet
          continue;
        }
        let source = own[name];
        for (const spec of relativeImports(own[name])) {
          const target = urlFor.get(baseName(spec));
          if (target)
            source = source
              .split(`"${spec}"`)
              .join(`"${target}"`)
              .split(`'${spec}'`)
              .join(`'${target}'`);
        }
        urlFor.set(name, moduleUrl(source));
      }
      remaining = next;
    }

    // Rewrite every src/href that names one of our own files.
    //
    // This is attribute-driven rather than markup-matching on purpose. The
    // earlier version required exactly `href="./styles.css"`, and the model
    // rewrites index.html freely: `href="styles.css"`, single quotes, a
    // different attribute order all failed to match. An unrewritten relative
    // URL then resolves against the PARENT page (a srcdoc iframe inherits the
    // host's base URL), 404s, and the app renders blank with no clue why.
    let page = html;
    const resolveLocal = (raw: string): string | null => {
      const name = baseName(raw.trim().replace(/^\.\//, "").split(/[?#]/)[0]);
      return own[name] !== undefined ? name : null;
    };

    // Stylesheets are inlined: one fewer request, no flash of unstyled content.
    page = page.replace(/<link\b[^>]*>/gi, (tag) => {
      const href = /href\s*=\s*(["'])([^"']+)\1/i.exec(tag)?.[2];
      if (!href) return tag;
      const name = resolveLocal(href);
      if (!name || !name.endsWith(".css")) return tag;
      return `<style>\n${own[name]}\n</style>`;
    });

    // Scripts point at the module's data: URL.
    page = page.replace(/<script\b[^>]*>/gi, (tag) => {
      const m = /src\s*=\s*(["'])([^"']+)\1/i.exec(tag);
      if (!m) return tag;
      const name = resolveLocal(m[2]);
      const target = name ? urlFor.get(name) : undefined;
      return target ? tag.replace(m[0], `src="${target}"`) : tag;
    });

    // Anything still pointing at a file we hold would 404 against the host
    // page. Fail loudly here rather than shipping a blank preview.
    const leftover = [...page.matchAll(/(?:src|href)\s*=\s*(["'])([^"']+)\1/gi)]
      .map((m) => m[2])
      .filter((v) => !/^(https?:|data:|blob:|#|\/\/)/i.test(v))
      .filter((v) => resolveLocal(v) !== null);
    if (leftover.length > 0) {
      throw new Error(
        `Could not rewrite these references for the preview: ${[...new Set(leftover)].join(", ")}.`,
      );
    }

    // Error reporter first, so it catches failures in the app's own modules.
    page = page.includes("</head>")
      ? page.replace("</head>", `${ERROR_REPORTER}\n</head>`)
      : `${ERROR_REPORTER}\n${page}`;

    return { srcdoc: page, revoke };
  }
}
