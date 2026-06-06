// Thin main-thread wrapper around the solc Web Worker. Call compile() with
// Solidity sources and get back typed ABI + bytecode + errors/warnings.

export interface CompileError {
  severity: "error" | "warning";
  message: string;
  formattedMessage: string;
  sourceLocation?: { file: string; start: number; end: number };
}

export interface ResolvedImport {
  path: string;
  via: "cdn";
}

export interface CompileOutput {
  status: "success" | "error";
  contracts: Record<
    string,
    { abi: unknown[]; bytecode: `0x${string}`; deployedBytecode: `0x${string}` }
  >;
  errors: CompileError[];
  warnings: CompileError[];
  /** External imports (e.g. OpenZeppelin) resolved before compiling. */
  resolvedImports: ResolvedImport[];
  /** Import paths that could not be resolved. */
  importErrors: string[];
  timeMs: number;
}

interface CompileRequest {
  sources: Record<string, string>;
  version: string;
  mainFile: string;
  optimize?: boolean;
  optimizerRuns?: number;
}

let nextId = 0;
let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    // CLASSIC worker (not module): solc's soljson bundle is loaded with
    // importScripts(), which is only available in classic workers. A module
    // worker throws "Module scripts don't support importScripts()".
    worker = new Worker(new URL("./compiler.worker.ts", import.meta.url), { type: "classic" });
  }
  return worker;
}

export function compile({
  sources,
  version,
  optimize = false,
  optimizerRuns = 200,
}: CompileRequest): Promise<CompileOutput> {
  const id = ++nextId;
  const w = getWorker();

  return new Promise((resolve, reject) => {
    const handler = (
      e: MessageEvent<{
        id: number;
        type: string;
        status?: string;
        output?: Record<string, unknown>;
        errors?: CompileError[];
        warnings?: CompileError[];
        resolvedImports?: ResolvedImport[];
        importErrors?: string[];
        timeMs?: number;
        message?: string;
      }>,
    ) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", handler);

      if (e.data.type === "error") {
        reject(new Error(e.data.message ?? "Compile failed"));
        return;
      }
      if (e.data.type !== "compiled") {
        reject(new Error("Unexpected worker message"));
        return;
      }

      const output = e.data.output ?? {};
      const contracts: CompileOutput["contracts"] = {};
      const rawContracts = output.contracts as
        | Record<
            string,
            Record<
              string,
              {
                abi: unknown[];
                evm: { bytecode: { object: string }; deployedBytecode: { object: string } };
              }
            >
          >
        | undefined;
      if (rawContracts) {
        for (const [, fileContracts] of Object.entries(rawContracts)) {
          for (const [name, data] of Object.entries(fileContracts)) {
            contracts[name] = {
              abi: data.abi ?? [],
              bytecode: `0x${data.evm.bytecode.object}`,
              deployedBytecode: `0x${data.evm.deployedBytecode.object}`,
            };
          }
        }
      }

      resolve({
        status: (e.data.status as "success" | "error") ?? "error",
        contracts,
        errors: e.data.errors ?? [],
        warnings: e.data.warnings ?? [],
        resolvedImports: e.data.resolvedImports ?? [],
        importErrors: e.data.importErrors ?? [],
        timeMs: e.data.timeMs ?? 0,
      });
    };

    w.addEventListener("message", handler);
    w.postMessage({ id, sources, version, optimize, optimizerRuns });
  });
}

// Versions known to be available on binaries.soliditylang.org. Keep sorted
// newest-first.
export const SOLC_VERSIONS = [
  "0.8.26",
  "0.8.25",
  "0.8.24",
  "0.8.23",
  "0.8.22",
  "0.8.21",
  "0.8.20",
  "0.8.19",
  "0.8.18",
  "0.8.17",
  "0.8.16",
  "0.8.15",
  "0.8.14",
  "0.8.13",
  "0.8.12",
  "0.8.11",
  "0.8.10",
  "0.8.9",
  "0.8.8",
  "0.8.7",
  "0.8.6",
  "0.8.4",
  "0.8.2",
  "0.8.0",
  "0.7.6",
  "0.7.5",
  "0.7.4",
  "0.7.3",
  "0.7.2",
  "0.7.1",
  "0.7.0",
] as const;

export const DEFAULT_SOLC_VERSION = "0.8.20";
