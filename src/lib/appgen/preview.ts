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

    return { srcdoc: page, revoke };
  }
}
