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
  optimize: boolean;
  optimizerRuns: number;
};

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

async function loadVersion(version: string): Promise<unknown> {
  if (version === cachedVersion && solc) return solc;

  const url = `https://binaries.soliditylang.org/wasm/soljson-v${version}+commit.latest.js`;
  try {
    importScripts(url);
  } catch {
    // Version may use different commit hash format; try the direct version
    importScripts(`https://binaries.soliditylang.org/wasm/soljson-v${version}.js`);
  }

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
  const m = await loadVersion(req.version);
  const compile = (m as Record<string, CallableFunction>).cwrap!("solidity_compile", "string", [
    "string",
    "number",
    "number",
  ]);

  const input = {
    language: "Solidity",
    sources: Object.fromEntries(
      Object.entries(req.sources).map(([name, content]) => [name, { content }]),
    ),
    settings: {
      optimizer: { enabled: req.optimize, runs: req.optimizerRuns },
      outputSelection: {
        "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"], "": ["ast"] },
      },
    },
  };

  const raw = compile(JSON.stringify(input), 0, 0) as string;
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
    timeMs: Date.now() - start,
  } satisfies WorkerResponse & { timeMs: number });
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
