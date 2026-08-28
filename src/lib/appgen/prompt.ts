// Building an app from a description, with no contract required.
//
// The contract-driven path generates deterministically because an ABI fully
// describes what the UI must do. A free-form prompt does not, so this path is
// model-authored — but it starts from a fixed scaffold so the parts that are
// easy to get wrong (the import map, the mount point, the no-build setup) are
// correct before the model touches anything. The model rewrites files; it does
// not invent the project's shape.

import { CDN_VERSIONS } from "./generate";

/** Files the model is allowed to write. Anything else is ignored, so a
 *  confused response cannot scatter files across the workspace. */
const ALLOWED_EXT = /\.(html|js|css|json|md)$/i;
const MAX_FILES = 12;
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

/** A runnable, empty starting point. The model edits these rather than
 *  inventing a project layout, so the import map and mount point are always
 *  right even if the response is partial. */
export function blankScaffold(dir = "app"): Record<string, string> {
  const prefix = dir ? `${dir}/` : "";
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

/** System prompt for free-form app building. */
export function appBuilderSystemPrompt(ctx: PromptContext = {}): string {
  const { preact, htm, viem } = CDN_VERSIONS;
  const base = `You build small, complete web apps that run with NO build step.

# Output format
Return ONE fenced code block per file, with the filename in the fence info string:

\`\`\`html index.html
<!doctype html> ...
\`\`\`

\`\`\`js app.js
...
\`\`\`

Rules:
- Always return the COMPLETE contents of every file you change. Never diffs, never fragments, never "// rest unchanged".
- Only these files: index.html, app.js, styles.css (plus extra .js modules if you genuinely need them).
- Keep it to a handful of files.
- Say what you built in one or two sentences BEFORE the code blocks. No commentary after them.

# The environment (this is fixed — do not fight it)
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
