// Making a multi-file ES-module app runnable inside a sandboxed iframe.
//
// The generated app imports its own files by relative path ("./contract.js"),
// which cannot resolve without a real directory to resolve against. Each
// module is therefore turned into a data: URL and every relative import is
// rewritten to point at it, deepest dependency first.
//
// data: URLs rather than blob: URLs, and srcdoc rather than src, because the
// preview iframe runs sandboxed WITHOUT allow-same-origin — it gets an opaque
// origin, and Chrome refuses to load a blob: URL there ("Not allowed to load
// local resource"). Granting allow-same-origin would fix that by making the
// frame same-origin with DevStation, which would let generated code — some of
// it written by the AI — read DevStation's localStorage, including AI provider
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
        send({ kind: "module", message: "The app loaded but rendered nothing — the entry module probably threw before mounting." });
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
          `Could not resolve the module graph in "${dir}" — check for a circular import between ${remaining.join(", ")}.`,
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

    // Inline the CSS: one fewer request, and no chance of the stylesheet
    // racing the first paint.
    let page = html;
    const css = own["styles.css"];
    if (css) {
      page = page.replace(/<link[^>]+href="\.\/styles\.css"[^>]*>/, `<style>\n${css}\n</style>`);
    }
    // Point the entry script (and any other module src) at its data: URL.
    page = page.replace(/src="\.\/([^"]+\.js)"/g, (whole, file: string) => {
      const target = urlFor.get(file);
      return target ? `src="${target}"` : whole;
    });

    // Error reporter first, so it catches failures in the app's own modules.
    page = page.includes("</head>")
      ? page.replace("</head>", `${ERROR_REPORTER}\n</head>`)
      : `${ERROR_REPORTER}\n${page}`;

    return { srcdoc: page, revoke };
  }
}
