// Checks a generated app before it is previewed.
//
// What is worth checking depends entirely on how the app will run, and getting
// that wrong is worse than not checking at all.
//
// For the no-build target this is the closest honest equivalent to "run the
// tests": the app runs straight in the browser, so there is no bundler to
// catch anything, and these three failures all end as a silent white frame —
// the module never evaluates, nothing mounts, and "it's blank" is the only
// available bug report:
//
//   1. Invalid JavaScript (a model writing JSX is the usual cause).
//   2. An import of something the import map does not define.
//   3. A relative import of a file that was never written.
//
// For a real Vite project every one of those is wrong. There is no import map;
// bare imports are the normal way to use a dependency; JSX compiles. Applying
// the no-build rules there rejects perfectly good apps and sends the model
// rewriting working code to satisfy a rule that does not apply — which is
// exactly what happened the first time an app was generated with a runner
// attached. So the Vite path checks only what a bundler cannot tell you
// earlier, and leaves the rest to install, lint, build and test, which say it
// far better.

import type { BuildTarget } from "./generate";

export interface ValidationIssue {
  path: string;
  message: string;
  /** Fatal issues would leave a blank preview; warnings would not. */
  fatal: boolean;
}

const BARE_IMPORT = /(?:^|\n)\s*import\s[^;]*?from\s*["']([^"'./][^"']*)["']/g;
const SIDE_EFFECT_IMPORT = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const RELATIVE_IMPORT = /from\s*["'](\.\/[^"']+)["']/g;
/** Also matches "../", which only the Vite layout can produce — its source
 *  sits in src/, so a module can legitimately reach above itself. */
const RELATIVE_IMPORT_ANY = /from\s*["'](\.\.?\/[^"']+)["']/g;

function importMapSpecifiers(html: string): Set<string> {
  const out = new Set<string>();
  const block = /<script[^>]*type=["']importmap["'][^>]*>([\s\S]*?)<\/script>/i.exec(html);
  if (!block) return out;
  try {
    const parsed = JSON.parse(block[1]) as { imports?: Record<string, string> };
    for (const key of Object.keys(parsed.imports ?? {})) out.add(key);
  } catch {
    /* a malformed import map is reported separately below */
  }
  return out;
}

/** Does this JavaScript actually parse? */
function syntaxError(source: string): string | null {
  try {
    // Function() parses without executing. Module syntax is not valid inside a
    // function body, so strip the statements that only appear at module scope
    // before checking — we are looking for JSX and broken expressions, which
    // is what models actually get wrong here.
    const stripped = source
      .replace(/^\s*import\s[^;]*;?\s*$/gm, "")
      .replace(/^\s*import\s*["'][^"']+["'];?\s*$/gm, "")
      .replace(/^\s*export\s+default\s+/gm, "")
      .replace(/^\s*export\s+/gm, "");
    new Function(stripped);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** Resolve a relative specifier against the file that imports it. */
function resolveRelative(fromPath: string, spec: string): string {
  const parts = fromPath.split("/").slice(0, -1);
  for (const segment of spec.split("/")) {
    if (segment === "." || segment === "") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

export function validateApp(
  files: Record<string, string>,
  dir = "app",
  target: BuildTarget = "esm",
): ValidationIssue[] {
  const prefix = dir ? `${dir}/` : "";
  const issues: ValidationIssue[] = [];

  // Nothing to validate. An empty workspace is an app that has not been built
  // yet, not a broken one — and after a purely conversational turn, reporting
  // "There is no index.html." offered a fix for something nobody had asked to
  // exist.
  if (Object.keys(files).length === 0) return issues;
  const own = Object.fromEntries(
    Object.entries(files)
      .filter(([p]) => p.startsWith(prefix))
      .map(([p, c]) => [p.slice(prefix.length), c]),
  );

  const html = own["index.html"];
  if (!html) {
    issues.push({ path: `${prefix}index.html`, message: "There is no index.html.", fatal: true });
    return issues;
  }
  if (!/id=["']root["']/.test(html)) {
    issues.push({
      path: `${prefix}index.html`,
      message: 'index.html has no <div id="root"> to mount into.',
      fatal: true,
    });
  }

  if (target === "vite") {
    // Only what the toolchain cannot report sooner or more clearly. A missing
    // module does surface in the build, but a hundred lines later and phrased
    // as a rollup resolution failure.
    for (const [name, source] of Object.entries(own)) {
      if (!/\.(js|jsx|mjs)$/.test(name)) continue;
      RELATIVE_IMPORT_ANY.lastIndex = 0;
      let rel: RegExpExecArray | null;
      while ((rel = RELATIVE_IMPORT_ANY.exec(source)) !== null) {
        const target_ = resolveRelative(name, rel[1]);
        // Vite resolves an extensionless import against several extensions.
        const found = [target_, `${target_}.js`, `${target_}.jsx`, `${target_}/index.js`].some(
          (candidate) => own[candidate] !== undefined,
        );
        if (!found) {
          issues.push({
            path: prefix + name,
            message: `Imports "${rel[1]}", which does not exist.`,
            fatal: true,
          });
        }
      }
    }
    return issues;
  }

  const known = importMapSpecifiers(html);
  if (known.size === 0) {
    issues.push({
      path: `${prefix}index.html`,
      message: "The import map is missing or unparseable, so bare imports will not resolve.",
      fatal: true,
    });
  }

  for (const [name, source] of Object.entries(own)) {
    if (!name.endsWith(".js")) continue;
    const path = prefix + name;

    const syntax = syntaxError(source);
    if (syntax) {
      issues.push({
        path,
        message:
          `Invalid JavaScript: ${syntax}` +
          (/[<>]/.test(source) && /return\s*\(?\s*</.test(source)
            ? " — this looks like JSX, which cannot run without a build step. Use htm tagged templates."
            : ""),
        fatal: true,
      });
      continue; // an unparseable file makes its imports meaningless
    }

    for (const re of [BARE_IMPORT, SIDE_EFFECT_IMPORT]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        const spec = m[1];
        if (
          spec.startsWith("./") ||
          spec.startsWith("../") ||
          /^https?:/.test(spec) ||
          spec.startsWith("data:")
        ) {
          continue;
        }
        // Sub-paths resolve if their prefix is mapped ("preact/hooks").
        const mapped = [...known].some(
          (k) => spec === k || spec.startsWith(k.replace(/\/$/, "") + "/"),
        );
        if (!mapped) {
          issues.push({
            path,
            message: `Imports "${spec}", which is not in the import map. Add it there, or import it by full https://esm.sh URL.`,
            fatal: true,
          });
        }
      }
    }

    RELATIVE_IMPORT.lastIndex = 0;
    let rel: RegExpExecArray | null;
    while ((rel = RELATIVE_IMPORT.exec(source)) !== null) {
      const target = rel[1].replace(/^\.\//, "");
      if (own[target] === undefined) {
        issues.push({
          path,
          message: `Imports "./${target}", which does not exist.`,
          fatal: true,
        });
      }
    }
  }

  return issues;
}

/** One paragraph the model can act on, or null when everything checks out. */
export function issuesForModel(issues: ValidationIssue[]): string | null {
  const fatal = issues.filter((i) => i.fatal);
  if (fatal.length === 0) return null;
  return (
    "The app you produced will not run. Fix these and return the COMPLETE corrected files:\n" +
    fatal.map((i) => `  - ${i.path}: ${i.message}`).join("\n")
  );
}
