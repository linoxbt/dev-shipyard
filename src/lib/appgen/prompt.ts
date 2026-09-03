// Building an app from a description, with no contract required.
//
// The contract-driven path generates deterministically because an ABI fully
// describes what the UI must do. A free-form prompt does not, so this path is
// model-authored — but it starts from a fixed scaffold so the parts that are
// easy to get wrong (the import map, the mount point, the no-build setup) are
// correct before the model touches anything. The model rewrites files; it does
// not invent the project's shape.

import { CDN_VERSIONS, viteShell, type BuildTarget } from "./generate";
import { STATUS_PROTOCOL } from "./intent";

/** Files the model is allowed to write. Anything else is ignored, so a
 *  confused response cannot scatter files across the workspace. */
const ALLOWED_EXT = /\.(html|js|css|json|md)$/i;
// A real multi-service app (services/, hooks/, components/) is well over a
// dozen files; at 12 the tail of a good reply was silently dropped.
const MAX_FILES = 28;
const MAX_FILE_BYTES = 120_000;

export interface ParsedFile {
  path: string;
  content: string;
}

/**
 * Pull files out of a model response.
 *
 * Accepts a fenced block whose info string names a path — `js app.js`,
 * `html path=index.html`, or just the bare filename. Models are inconsistent
 * about this, and rejecting a response over punctuation would be a poor
 * trade, so the parser is deliberately tolerant about WHERE the name appears
 * and strict about WHAT is accepted as a name.
 */
export function parseGeneratedFiles(text: string, dir = "app"): ParsedFile[] {
  const out: ParsedFile[] = [];
  const seen = new Set<string>();
  const fence = /```([^\n]*)\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;

  while ((m = fence.exec(text)) !== null) {
    const info = m[1] ?? "";
    const body = m[2] ?? "";
    // A path anywhere in the info string: "js app.js", "path=app/app.js", "index.html".
    const nameMatch = /([A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)/.exec(info);
    if (!nameMatch) continue;

    let name = nameMatch[1].replace(/^\.\//, "").replace(/^\/+/, "");
    if (!ALLOWED_EXT.test(name)) continue;
    // Refuse traversal outright rather than trying to normalise it.
    if (name.includes("..")) continue;

    const prefix = dir ? `${dir}/` : "";
    if (name.startsWith(prefix)) name = name.slice(prefix.length);
    const path = prefix + name;

    if (seen.has(path)) {
      // A later block for the same file wins — models often correct themselves.
      const idx = out.findIndex((f) => f.path === path);
      if (idx >= 0) out[idx] = { path, content: body.replace(/\s+$/, "") };
      continue;
    }
    if (out.length >= MAX_FILES) break;
    const content = body.replace(/\s+$/, "");
    if (content.length > MAX_FILE_BYTES) continue;
    seen.add(path);
    out.push({ path, content });
  }
  return out;
}

/** A file the model asked to remove.
 *
 *  Deletion is a marker rather than a fence because a fence carries content and
 *  a deletion has none — an empty ```delete block would be indistinguishable
 *  from a file the model truncated. The shape matches the <status> protocol the
 *  model already emits, so this is one convention rather than a second one.
 *
 *  Every rule parseGeneratedFiles enforces on a path applies here too, and for
 *  a stronger reason: a write outside the workspace creates a file, whereas a
 *  delete outside it destroys one. */
const DELETE_MARKER = /<delete\s+path=("|')([^"']+)\1\s*\/?>/gi;

export function parseDeletions(text: string, dir = "app"): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(DELETE_MARKER.source, "gi");
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    let name = (m[2] ?? "").trim().replace(/^\.\//, "");
    if (!name) continue;
    // Refuse traversal outright rather than trying to normalise it.
    if (name.includes("..")) continue;
    // And refuse an absolute path rather than stripping the slash, which is
    // what the write parser does. Rewriting "/etc/hosts.js" into
    // "app/etc/hosts.js" is harmless when it CREATES that file and is not
    // harmless when it deletes it: a malformed path must not resolve to some
    // other real file.
    if (name.startsWith("/")) continue;
    if (!ALLOWED_EXT.test(name)) continue;
    // contract.js is generated from the deployed contract. applyFiles already
    // refuses to overwrite it; removing it would repoint the app just as
    // effectively.
    if (/(^|\/)contract\.js$/.test(name)) continue;

    const prefix = dir ? `${dir}/` : "";
    if (name.startsWith(prefix)) name = name.slice(prefix.length);
    const path = prefix + name;
    if (seen.has(path)) continue;
    seen.add(path);
    out.push(path);
    if (out.length >= MAX_FILES) break;
  }
  return out;
}

/** Remove the markers from prose, including one the stream cut off mid-tag.
 *  A half-arrived marker must never render as text in the transcript. */
export function stripDeleteMarkers(text: string): string {
  return text
    .replace(new RegExp(DELETE_MARKER.source, "gi"), "")
    .replace(/<delete\b[^>]*$/i, "")
    .replace(/[ \t]+$/gm, "");
}

/** A runnable, empty starting point. The model edits these rather than
 *  inventing a project layout, so the import map and mount point are always
 *  right even if the response is partial. */
export function blankScaffold(dir = "app", target: BuildTarget = "esm"): Record<string, string> {
  const prefix = dir ? `${dir}/` : "";
  if (target === "vite") {
    // A real project from the first keystroke, so the very first prompt can
    // add a package, and so the lint and test steps have something to run.
    // The project files come from viteShell, which the generated app uses too.
    return {
      ...viteShell("App", { dir, description: "Generated by DevStation" }),
      [`${prefix}src/app.js`]: `import { html, render } from "htm/preact";

function App() {
  return html\`<main><h1>New app</h1><p>Describe what you want and it will be built here.</p></main>\`;
}

render(html\`<\${App} />\`, document.getElementById("root"));
`,
      [`${prefix}src/styles.css`]: `body { margin: 0; font-family: system-ui, sans-serif; }\n`,
    };
  }
  const { preact, htm, viem } = CDN_VERSIONS;
  return {
    [`${prefix}index.html`]: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>App</title>
    <link rel="stylesheet" href="./styles.css" />
    <script type="importmap">
      {
        "imports": {
          "preact": "https://esm.sh/preact@${preact}",
          "preact/hooks": "https://esm.sh/preact@${preact}/hooks",
          "htm/preact": "https://esm.sh/htm@${htm}/preact?deps=preact@${preact}",
          "viem": "https://esm.sh/viem@${viem}"
        }
      }
    </script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./app.js"></script>
  </body>
</html>
`,
    [`${prefix}app.js`]: `import { html, render } from "htm/preact";

function App() {
  return html\`<main><h1>New app</h1><p>Describe what you want and it will be built here.</p></main>\`;
}

render(html\`<\${App} />\`, document.getElementById("root"));
`,
    [`${prefix}styles.css`]: `body { margin: 0; font-family: system-ui, sans-serif; }\n`,
  };
}

export interface PromptContext {
  /** Which environment the app is being built for. "vite" unlocks npm
   *  packages and JSX; "esm" is the no-build browser environment. */
  target?: BuildTarget;
  /** Optional contract to wire the app up to. */
  contract?: {
    address: string;
    chainId: number;
    chainName: string;
    rpcUrl: string;
    explorerUrl: string;
    nativeSymbol: string;
    abi: unknown[];
  } | null;
}

/** Reviewing the app instead of changing it.
 *
 *  A separate mode because the two jobs pull in opposite directions: building
 *  rewards acting on a half-clear request, reviewing rewards saying plainly
 *  that something is wrong and leaving it alone. Asked to "check this over"
 *  while in build mode, a model edits — which is precisely what you did not
 *  ask for. */
export function reviewSystemPrompt(ctx: PromptContext = {}): string {
  const c = ctx.contract;
  return `You are reviewing a web app that has already been built. You are NOT changing it.

# Absolute rule
Output NO code blocks and NO files. Not one. If you find something worth fixing,
describe it and say which file and roughly where. The user will ask you to fix it
if they want it fixed.

# What to report
Go through the current code and report what you actually find, worst first:

1. **Bugs** — things that are wrong now: unhandled errors, state that can go out
   of sync, race conditions, off-by-one, values that can be null when used.
2. **Web3 correctness**${c ? "" : " (only if the app touches a wallet or chain)"} — amounts assumed to be 18 decimals, missing
   decimals() reads, unchecked transaction results, a wallet on the wrong chain,
   anything that could move funds incorrectly.
3. **Robustness** — what happens with empty input, a rejected wallet prompt, an
   RPC that times out, a very large number.
4. **Accessibility and UX** — unlabelled controls, colour as the only signal,
   focus traps, anything unusable by keyboard.
5. **Dead weight** — unused variables, unreachable branches, duplicated logic.

# How to report it
- Lead with a one-line verdict: is this sound, or does it need work?
- Then a short list. Each item: what is wrong, which file, why it matters.
- Be specific and quote the offending line inline where it helps — INLINE, in
  backticks, never as a fenced block.
- If something is genuinely fine, say so briefly rather than inventing faults.
  A clean review is a useful review.
- No preamble, no summary paragraph at the end.${
    c
      ? `\n\nThe app talks to ${c.address} on ${c.chainName} (chain ${c.chainId}), native token ${c.nativeSymbol}.`
      : ""
  }

${STATUS_PROTOCOL}`;
}

/** System prompt for free-form app building. */
export function appBuilderSystemPrompt(ctx: PromptContext = {}): string {
  const { preact, htm, viem } = CDN_VERSIONS;
  const vite = ctx.target === "vite";

  // The two environments differ in what is allowed, and the difference has to
  // be stated plainly. Telling a model "NO npm install" in a project that is
  // about to run npm install produces apps far worse than they need to be;
  // telling it packages are available when nothing will install them produces
  // an app that cannot load at all.
  const environment = vite
    ? `# The environment
- A real Vite project. Source lives in \`src/\`. \`npm install\` runs before every build, so you MAY add dependencies — add them to package.json and return the whole file.
- Preact is the framework. \`htm\` tagged templates and JSX both work (\`@preact/preset-vite\` is configured); the existing files use htm.
    import { html, render } from "htm/preact";
    import { useState } from "preact/hooks";
    function App() { return html\`<div class="x">\${value}</div>\`; }
- Already installed: preact ${preact}, htm ${htm}, viem ${viem}. Pin an exact version for anything you add.
- \`npm run lint\` (eslint) and \`npm test\` (Playwright, against the built site) run after every build, and you will be shown anything they report. Keep \`tests/app.spec.js\` passing; add tests when they are worth having.
- index.html loads \`/src/app.js\` and \`/src/styles.css\`.
- Mount into <div id="root">.
- Style in src/styles.css. Support light and dark via prefers-color-scheme. Make it look considered, not default-browser.
- The preview runs the BUILT site inside a sandboxed iframe: no cookies, no server, and no network during tests. Keep state in memory unless asked otherwise.`
    : `# The environment (this is fixed — do not fight it)
- Plain ES modules in the browser. NO bundler, NO build step, NO npm install, NO JSX.
- index.html already contains an import map. Keep it exactly as it is. It provides:
    "preact"        -> preact ${preact}
    "preact/hooks"  -> hooks
    "htm/preact"    -> htm ${htm} bound to preact (exports \`html\` and \`render\`)
    "viem"          -> viem ${viem}
- Write components with htm's tagged templates, NOT JSX:
    import { html, render } from "htm/preact";
    import { useState } from "preact/hooks";
    function App() { return html\`<div class="x">\${value}</div>\`; }
    render(html\`<\${App} />\`, document.getElementById("root"));
- Any other library must be imported by full URL from https://esm.sh/<pkg>@<version>. Always pin a version.
- Mount into <div id="root">.
- Style in styles.css. Support light and dark via prefers-color-scheme. Make it look considered, not default-browser.
- The app runs inside a sandboxed iframe: no cookies, no localStorage guarantees, no server. Keep state in memory unless asked otherwise.`;

  const base = `You build small, complete web apps${vite ? "" : " that run with NO build step"}.

# Output format
Return ONE fenced code block per file, with the filename in the fence info string:

\`\`\`html index.html
<!doctype html> ...
\`\`\`

\`\`\`js app.js
...
\`\`\`

Rules:
- Change as LITTLE as possible. Make the smallest edit that satisfies the request, and leave everything else exactly as it is.
- Output ONLY the files you actually changed. A file you did not need to touch must not appear in your reply at all — re-emitting an unchanged file is a mistake, not a courtesy.
- For each file you DO change, return its COMPLETE new contents. Never diffs, never fragments, never "// rest unchanged" — the file is written verbatim from your reply, so anything you leave out is deleted.
- Never rebuild the app from scratch on a follow-up. The current code is given to you above; work from it. Start over only if explicitly asked to.
- When fixing an error, fix THAT error. Do not restructure, rename, restyle or "improve" code that has nothing to do with it.
- Only these files: ${vite ? "index.html, src/app.js, src/styles.css, package.json (plus extra modules under src/ if you genuinely need them)" : "index.html, app.js, styles.css (plus extra .js modules if you genuinely need them)"}.
- Prefer few files, but use as many as the app genuinely needs (services/, hooks/ and components/ modules are fine).
- To REMOVE a file, emit \`<delete path="app.js" />\` on its own line. That is the only way a file is ever removed; leaving a file out of your reply keeps it exactly as it is. Removing a file needs the user's permission, so expect it to pause and ask.
- Say what you built in one or two sentences BEFORE the code blocks. No commentary after them.
- ALWAYS BUILD. Never reply with only a question, a plan, or a refusal. A long, detailed request is over-specified, not ambiguous — build it.
- If the request is too large for one reply, build the most valuable COMPLETE slice now (it must run), then name what you will do next in one sentence. Never ask permission before starting.
- Never say you "cannot" build something because credentials, network access or an API key are missing. Build the real integration behind an env var and render a clear "not configured" state when it is absent. That is what the user asked for.
- Ask a question ONLY when you have also shipped working code in the same reply, and only when a genuine either/or would send the next pass in the wrong direction.

${environment}

${STATUS_PROTOCOL}`;

  if (!ctx.contract) {
    return `${base}

# No contract
This app is not wired to a smart contract. Build exactly what the user asks for as a self-contained frontend. Do not invent a wallet connection or contract calls unless they ask for them.`;
  }

  const c = ctx.contract;
  return `${base}

# This app talks to a deployed contract
A file \`contract.js\` already exists and is GENERATED — do not output it, and do not redefine its values. Import from it:

    import { CHAIN, CONTRACT } from "./contract.js";
    // CHAIN   = { id, name, symbol, rpcUrl, explorerUrl }
    // CONTRACT = { name, address, abi }

There is also \`wallet.js\` with: hasWallet(), connect(), currentAccount(), currentChainId(), switchToAppChain(), request(method, params), onWalletChange(fn). Use it for anything wallet-related; it works both standalone and inside DevStation's preview.

Reads: createPublicClient({ chain, transport: http(CHAIN.rpcUrl) }) — these work with no wallet.
Writes: createWalletClient({ account, chain, transport: custom({ request: (a) => wallet.request(a.method, a.params) }) }).

Contract: ${c.address} on ${c.chainName} (chain id ${c.chainId}), native token ${c.nativeSymbol}.
Functions available: ${abiSummary(c.abi)}

Amounts are in the smallest unit. Do not assume 18 decimals — if the contract exposes decimals(), read it.`;
}

/** Compact function list, so the model sees the surface without the full ABI
 *  eating the context window. */
function abiSummary(abi: unknown[]): string {
  const fns = abi.filter(
    (
      e,
    ): e is {
      type: string;
      name?: string;
      inputs?: { type: string }[];
      stateMutability?: string;
    } => typeof e === "object" && e !== null && (e as { type?: string }).type === "function",
  );
  if (fns.length === 0) return "(none)";
  return fns
    .slice(0, 40)
    .map(
      (f) =>
        `${f.name}(${(f.inputs ?? []).map((i) => i.type).join(",")})${
          f.stateMutability === "view" || f.stateMutability === "pure" ? " [read]" : " [write]"
        }`,
    )
    .join(", ");
}
