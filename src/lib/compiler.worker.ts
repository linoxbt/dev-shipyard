// Web Worker that loads solc from binaries.soliditylang.org and exposes a
// compile() method via postMessage. Format: postMessage({id, sources, version,
// optimize, mainFile}); the worker responds with {id, ...CompileResult}.
// The first compile after a version change downloads + initialises that
// soljson bundle (~8s for cold cache, ~2s warm); subsequent compiles of the
// same version are fast (~100-400ms).

type WorkerRequest = {
  id: number;
  sources: Record<string, string>;
  version: string;
  mainFile?: string;
  optimize: boolean;
  optimizerRuns: number;
};

type ResolvedImport = { path: string; via: "cdn" };

type WorkerResponse =
  | {
      id: number;
      type: "compiled";
      status: "success" | "error";
      output: Record<string, unknown>;
      warnings: unknown[];
      errors: unknown[];
    }
  | { id: number; type: "progress"; message: string }
  | { id: number; type: "error"; message: string };

declare function importScripts(...urls: string[]): void;

let cachedVersion = "";
let solc: unknown = null;

// solc builds on binaries.soliditylang.org are named with a commit hash, e.g.
// `soljson-v0.8.20+commit.a1b79de6.js` — there is NO `soljson-v0.8.20.js` or
// `+commit.latest.js`. The canonical bin/list.json maps each version to its
// exact filename, so we resolve through it (cached) before importScripts.
let releaseMap: Record<string, string> | null = null;

async function resolveSolcUrl(version: string): Promise<string> {
  if (!releaseMap) {
    const resp = await fetch("https://binaries.soliditylang.org/bin/list.json");
    if (!resp.ok) throw new Error(`Could not load solc version list (${resp.status})`);
    const data = (await resp.json()) as { releases?: Record<string, string> };
    releaseMap = data.releases ?? {};
  }
  const file = releaseMap[version];
  if (!file) {
    throw new Error(
      `solc ${version} is not available on binaries.soliditylang.org. Pick another version.`,
    );
  }
  return `https://binaries.soliditylang.org/bin/${file}`;
}

// ─── Import resolution ──────────────────────────────────────────────────────
// The browser worker has no filesystem/node_modules, so external imports
// (notably @openzeppelin/contracts) are fetched from a CDN. Resolved files are
// cached in-memory across compiles, and ALL imports are pre-resolved
// recursively into solc's `sources` map before compiling — so solc never needs
// a (synchronous) import callback.
const OZ_VERSION = "5.0.2";
const importCache = new Map<string, string>();

// Pin @openzeppelin/contracts to a known version on jsDelivr (serves npm
// packages and resolves intra-package relative paths cleanly).
function cdnUrlFor(importPath: string): string | null {
  if (importPath.startsWith("@openzeppelin/contracts/")) {
    const sub = importPath.replace("@openzeppelin/contracts/", "");
    return `https://cdn.jsdelivr.net/npm/@openzeppelin/contracts@${OZ_VERSION}/${sub}`;
  }
  if (importPath.startsWith("@openzeppelin/contracts-upgradeable/")) {
    const sub = importPath.replace("@openzeppelin/contracts-upgradeable/", "");
    return `https://cdn.jsdelivr.net/npm/@openzeppelin/contracts-upgradeable@${OZ_VERSION}/${sub}`;
  }
  return null;
}

// Normalize a relative import (e.g. "../utils/Context.sol") against the
// importing file's path into an absolute in-package path.
function resolveRelative(fromPath: string, importPath: string): string {
  if (!importPath.startsWith(".")) return importPath;
  const baseParts = fromPath.split("/").slice(0, -1);
  for (const seg of importPath.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") baseParts.pop();
    else baseParts.push(seg);
  }
  return baseParts.join("/");
}

async function fetchSource(importPath: string): Promise<string | null> {
  if (importCache.has(importPath)) return importCache.get(importPath)!;
  const url = cdnUrlFor(importPath);
  if (!url) return null;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const text = await resp.text();
    importCache.set(importPath, text);
    return text;
  } catch {
    return null;
  }
}

const IMPORT_RE = /import\s+(?:(?:\{[^}]*\}|[\w*]+(?:\s+as\s+\w+)?)\s+from\s+)?["']([^"']+)["']/g;

function extractImports(content: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(content)) !== null) out.push(m[1]);
  return out;
}

// Recursively resolve every external import reachable from the user's sources.
// Returns the merged source map plus bookkeeping for terminal output.
async function collectImports(userSources: Record<string, string>): Promise<{
  sources: Record<string, string>;
  resolved: ResolvedImport[];
  failed: string[];
}> {
  const sources: Record<string, string> = { ...userSources };
  const resolved: ResolvedImport[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();

  // Work queue of [importPath, importingFile].
  const queue: Array<[string, string]> = [];
  for (const [file, content] of Object.entries(userSources)) {
    for (const imp of extractImports(content)) queue.push([imp, file]);
  }

  while (queue.length > 0) {
    const [rawImport, fromFile] = queue.shift()!;
    // Relative imports resolve against their importer; if that importer is a
    // user/local file already in sources, skip (solc resolves it directly).
    const key = rawImport.startsWith(".") ? resolveRelative(fromFile, rawImport) : rawImport;
    if (seen.has(key) || sources[key] || sources[rawImport]) continue;
    seen.add(key);

    // Only fetch things we know how to (CDN-backed packages). Bare relative
    // paths that aren't already present and aren't CDN-resolvable are left for
    // solc to report as missing.
    const fetchPath = cdnUrlFor(key) ? key : null;
    if (!fetchPath) {
      if (!rawImport.startsWith(".") && cdnUrlFor(rawImport)) {
        // handled by key path above
      } else if (
        !sources[rawImport] &&
        (rawImport.startsWith("@") || rawImport.startsWith("http"))
      ) {
        failed.push(rawImport);
      }
      continue;
    }

    const src = await fetchSource(fetchPath);
    if (src == null) {
      failed.push(rawImport);
      continue;
    }
    sources[key] = src;
    resolved.push({ path: key, via: "cdn" });
    for (const imp of extractImports(src)) queue.push([imp, key]);
  }

  return { sources, resolved, failed };
}

async function loadVersion(version: string): Promise<unknown> {
  if (version === cachedVersion && solc) return solc;

  const url = await resolveSolcUrl(version);
  importScripts(url);

  // soljson registers Module globally; Vite bundler may shadow this so we
  // access via the global scope.
  const mod = (self as unknown as Record<string, unknown>).Module as
    | (Record<string, unknown> & {
        cwrap?: (a: string, b: string, c: string[]) => CallableFunction;
      })
    | undefined;
  if (!mod || !mod.cwrap) {
    // Emscripten may have compiled synchronously — wait one tick
    await new Promise((r) => setTimeout(r, 50));
  }
  const m =
    mod ??
    ((self as unknown as Record<string, unknown>).Module as
      | (Record<string, unknown> & {
          cwrap?: (a: string, b: string, c: string[]) => CallableFunction;
        })
      | undefined);
  if (!m) throw new Error("solc Module not found after import");
  solc = m;
  cachedVersion = version;
  return solc;
}

async function doCompile(req: WorkerRequest) {
  const start = Date.now();

  // Resolve external imports (OpenZeppelin, etc.) BEFORE loading solc so the
  // network fetches and the (slow) solc load happen back to back.
  const { sources: allSources, resolved, failed } = await collectImports(req.sources);

  const m = await loadVersion(req.version);
  const compile = (m as Record<string, CallableFunction>).cwrap!("solidity_compile", "string", [
    "string",
    "number",
    "number",
  ]);

  const input = {
    language: "Solidity",
    sources: Object.fromEntries(
      Object.entries(allSources).map(([name, content]) => [name, { content }]),
    ),
    settings: {
      optimizer: { enabled: req.optimize, runs: req.optimizerRuns },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"], "": ["ast"] },
      },
    },
  };

  // Stringify ONCE and reuse for both the compile and the response. Source
  // verification (standard-input) resubmits this exact string so the explorer
  // reproduces byte-identical bytecode, including the trailing metadata hash.
  const standardJsonInput = JSON.stringify(input);
  const raw = compile(standardJsonInput, 0, 0) as string;
  const output = JSON.parse(raw) as {
    errors?: Array<{
      severity: string;
      message: string;
      formattedMessage: string;
      sourceLocation?: { file: string; start: number; end: number };
    }>;
    contracts?: Record<
      string,
      Record<
        string,
        {
          abi: unknown[];
          evm: { bytecode: { object: string }; deployedBytecode: { object: string } };
        }
      >
    >;
  };

  const errors = (output.errors ?? []).filter((e) => e.severity === "error");
  const warnings = (output.errors ?? []).filter((e) => e.severity !== "error");

  self.postMessage({
    id: req.id,
    type: "compiled",
    status: errors.length > 0 ? "error" : "success",
    output,
    warnings,
    errors,
    resolvedImports: resolved,
    importErrors: failed,
    standardJsonInput,
    timeMs: Date.now() - start,
  } satisfies WorkerResponse & {
    timeMs: number;
    resolvedImports: ResolvedImport[];
    importErrors: string[];
    standardJsonInput: string;
  });
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  doCompile(e.data).catch((err) => {
    self.postMessage({
      id: e.data.id,
      type: "error",
      message: err instanceof Error ? err.message : "Compiler worker failed",
    } satisfies WorkerResponse);
  });
};
