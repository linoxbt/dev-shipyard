// Checks a generated app before it is previewed.
//
// What is worth checking depends entirely on how the app will run, and getting
// that wrong is worse than not checking at all.
//
// For the no-build target this is the closest honest equivalent to "run the
// tests": the app runs straight in the browser, so there is no bundler to
// catch anything, and these three failures all end as a silent white frame -
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
// rewriting working code to satisfy a rule that does not apply, which is
// exactly what happened the first time an app was generated with a runner
// attached. So the Vite path checks only what a bundler cannot tell you
// earlier, and leaves the rest to install, lint, build and test, which say it
// far better.

import { Parser, type Node } from "acorn";
import jsx from "acorn-jsx";
import type { BuildTarget } from "./generate";

export interface ValidationIssue {
  path: string;
  message: string;
  /** Fatal issues would leave a blank preview; warnings would not. */
  fatal: boolean;
}

const JsxParser = Parser.extend(jsx());

/** Files the browser or Vite will load as JavaScript modules. */
const MODULE_FILE = /\.(js|mjs|jsx)$/;

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

interface Parsed {
  error: string | null;
  /** Every module specifier: static imports, re-exports, and literal dynamic imports. */
  specifiers: string[];
}

/**
 * Parse as what it is: an ES module.
 *
 * This used to strip import and export lines with regexes and hand the rest to
 * `new Function`, which is a script parser. Top-level `await` and
 * `import.meta`, both normal in a module, were then reported as fatal syntax
 * errors and spent the repair budget on code that was fine; and an import split
 * across lines without a semicolon took the code after it with it, so a real
 * error went unreported. acorn parses modules properly, and the specifiers come
 * from the tree rather than from a pattern.
 */
function parseModule(source: string, allowJsx: boolean): Parsed {
  let ast: Node;
  try {
    ast = (allowJsx ? JsxParser : Parser).parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), specifiers: [] };
  }
  const specifiers: string[] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const n = node as { type?: string; source?: { type?: string; value?: unknown } };
    if (
      (n.type === "ImportDeclaration" ||
        n.type === "ExportNamedDeclaration" ||
        n.type === "ExportAllDeclaration" ||
        n.type === "ImportExpression") &&
      n.source?.type === "Literal" &&
      typeof n.source.value === "string"
    ) {
      specifiers.push(n.source.value);
    }
    for (const [key, value] of Object.entries(node)) {
      if (key !== "loc" && value && typeof value === "object") visit(value);
    }
  };
  visit(ast);
  return { error: null, specifiers };
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
  // yet, not a broken one, and after a purely conversational turn, reporting
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
      if (!MODULE_FILE.test(name)) continue;
      const parsed = parseModule(source, true);
      if (parsed.error) {
        issues.push({
          path: prefix + name,
          message: `Invalid JavaScript: ${parsed.error}`,
          fatal: true,
        });
        continue;
      }
      for (const spec of parsed.specifiers) {
        if (!spec.startsWith("./") && !spec.startsWith("../")) continue;
        const target_ = resolveRelative(name, spec);
        // Vite resolves an extensionless import against several extensions.
        const found = [
          target_,
          `${target_}.js`,
          `${target_}.jsx`,
          `${target_}.mjs`,
          `${target_}/index.js`,
          `${target_}/index.jsx`,
        ].some((candidate) => own[candidate] !== undefined);
        if (!found) {
          issues.push({
            path: prefix + name,
            message: `Imports "${spec}", which does not exist.`,
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
    if (!MODULE_FILE.test(name)) continue;
    const path = prefix + name;

    // No build step here, so JSX never parses, in a .jsx file or any other.
    const parsed = parseModule(source, false);
    if (parsed.error) {
      issues.push({
        path,
        message:
          `Invalid JavaScript: ${parsed.error}` +
          (name.endsWith(".jsx") || (/[<>]/.test(source) && /return\s*\(?\s*</.test(source))
            ? ": this looks like JSX, which cannot run without a build step. Use htm tagged templates."
            : ""),
        fatal: true,
      });
      continue; // an unparseable file makes its imports meaningless
    }

    for (const spec of parsed.specifiers) {
      if (/^https?:/.test(spec) || spec.startsWith("data:")) continue;
      if (spec.startsWith("./") || spec.startsWith("../")) {
        const target = resolveRelative(name, spec);
        if (own[target] === undefined) {
          issues.push({ path, message: `Imports "${spec}", which does not exist.`, fatal: true });
        }
        continue;
      }
      if (spec.startsWith("/")) continue;
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
