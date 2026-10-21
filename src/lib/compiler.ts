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
    {
      abi: unknown[];
      bytecode: `0x${string}`;
      deployedBytecode: `0x${string}`;
      /** Fully-qualified "File.sol:Name": what Blockscout standard-input
       *  verification expects as the contract_name. */
      qualifiedName: string;
    }
  >;
  errors: CompileError[];
  warnings: CompileError[];
  /** External imports (e.g. OpenZeppelin) resolved before compiling. */
  resolvedImports: ResolvedImport[];
  /** Import paths that could not be resolved. */
  importErrors: string[];
  /** The exact solc standard-JSON input string the worker compiled, byte for
   *  byte. Reused verbatim for standard-input source verification so the
   *  explorer reproduces identical bytecode (metadata hash included). */
  standardJsonInput: string;
  timeMs: number;
}

interface CompileRequest {
  sources: Record<string, string>;
  version: string;
  mainFile: string;
  optimize?: boolean;
  optimizerRuns?: number;
  /** Target EVM version. Defaults to DEFAULT_EVM_VERSION: see the note there
   *  for why leaving this to solc's default is not safe on QIE. */
  evmVersion?: string;
}

// QIE's EVM does not implement MCOPY (0x5e). solc >= 0.8.25 emits it by
// default (its default evmVersion moved to "cancun"), and any contract that
// does will revert on QIE the moment it hits that opcode: typically in a
// string-returning view, which is how ContractLabelRegistry.getLabel() ended
// up unusable in production. "shanghai" is the newest target that predates
// MCOPY, and bytecode built for it runs fine on cancun chains too, so pinning
// it is safe for every chain DevStation supports rather than only QIE.
// scripts/compile.ts pins the same value for the registry contracts.
export const DEFAULT_EVM_VERSION = "shanghai";

type RawContracts = Record<
  string,
  Record<
    string,
    {
      abi: unknown[];
      evm: { bytecode: { object: string }; deployedBytecode: { object: string } };
    }
  >
>;

/**
 * solc's output, flattened to one map.
 *
 * Keyed by the bare contract name, which is what every caller looks up
 * ("MyToken"). Two files can define the same name, though (an OpenZeppelin
 * import and the user's own file both declaring `Ownable`, say), and keying by
 * name alone let the later file silently replace the earlier one. A name that
 * occurs in more than one file is therefore keyed by its qualified
 * "File.sol:Name" instead, for every file it occurs in.
 */
export function resolveContracts(
  raw: RawContracts,
  out: CompileOutput["contracts"] = {},
): CompileOutput["contracts"] {
  const seen = new Map<string, number>();
  for (const fileContracts of Object.values(raw)) {
    for (const name of Object.keys(fileContracts)) seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  for (const [file, fileContracts] of Object.entries(raw)) {
    for (const [name, data] of Object.entries(fileContracts)) {
      const qualifiedName = `${file}:${name}`;
      out[(seen.get(name) ?? 0) > 1 ? qualifiedName : name] = {
        abi: data.abi ?? [],
        bytecode: `0x${data.evm.bytecode.object}`,
        deployedBytecode: `0x${data.evm.deployedBytecode.object}`,
        qualifiedName,
      };
    }
  }
  return out;
}

/** Library code (dependencies), as opposed to the user's own files. */
export function isLibraryPath(file: string): boolean {
  return file.startsWith("@") || file.startsWith("lib/") || file.includes("node_modules/");
}

/**
 * The contract a deploy form should start on: deployable (an abstract
 * contract or interface compiles to empty bytecode), and from the user's own
 * files before any imported library. solc sorts its output, so with an
 * OpenZeppelin import the first entry was routinely an abstract ERC20.
 */
export function defaultDeployable(contracts: CompileOutput["contracts"]): string {
  const entries = Object.entries(contracts).filter(([, c]) => c.bytecode.length > 2);
  const own = entries.filter(([, c]) => !isLibraryPath(c.qualifiedName.split(":")[0]));
  return (own[own.length - 1] ?? entries[entries.length - 1])?.[0] ?? "";
}

let nextId = 0;

/** A cold soljson download plus init is ~8s; a compile that has not answered
 *  in two minutes has hung or crashed, and waiting longer helps nobody. */
export const COMPILE_TIMEOUT_MS = 120_000;

interface Pending {
  resolve: (out: CompileOutput) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// One worker per solc version. A worker can hold only one soljson (each one is
// an Emscripten Module in the global scope), so switching versions terminates
// the old worker and starts a new one rather than loading a second Module on
// top of the first.
let worker: { version: string; w: Worker; pending: Map<number, Pending> } | null = null;

function failAll(pending: Map<number, Pending>, err: Error) {
  for (const p of pending.values()) {
    clearTimeout(p.timer);
    p.reject(err);
  }
  pending.clear();
}

function dropWorker(err: Error) {
  if (!worker) return;
  const { w, pending } = worker;
  worker = null;
  w.terminate();
  failAll(pending, err);
}

function getWorker(version: string) {
  if (worker && worker.version === version) return worker;
  if (worker) dropWorker(new Error(`Superseded by a compile with solc ${version}.`));
  // CLASSIC worker (not module): solc's soljson bundle is loaded with
  // importScripts(), which is only available in classic workers. A module
  // worker throws "Module scripts don't support importScripts()".
  const w = new Worker(new URL("./compiler.worker.ts", import.meta.url), { type: "classic" });
  const entry = { version, w, pending: new Map<number, Pending>() };
  // A crash (out of memory in soljson, a failed script load) fires `error`,
  // not a message. Without this every pending compile waited forever.
  w.addEventListener("error", (e) => {
    if (worker === entry) {
      dropWorker(new Error(`The compiler crashed: ${e.message || "unknown error"}. Try again.`));
    }
  });
  w.addEventListener("messageerror", () => {
    if (worker === entry) dropWorker(new Error("The compiler sent an unreadable reply."));
  });
  w.addEventListener("message", (e) => handleMessage(entry.pending, e));
  worker = entry;
  return entry;
}

type WorkerMessage = {
  id: number;
  type: string;
  status?: string;
  output?: Record<string, unknown>;
  errors?: CompileError[];
  warnings?: CompileError[];
  resolvedImports?: ResolvedImport[];
  importErrors?: string[];
  standardJsonInput?: string;
  timeMs?: number;
  message?: string;
};

function handleMessage(pending: Map<number, Pending>, e: MessageEvent<WorkerMessage>) {
  const p = pending.get(e.data.id);
  if (!p) return;
  if (e.data.type === "progress") return;
  pending.delete(e.data.id);
  clearTimeout(p.timer);

  if (e.data.type === "error") {
    p.reject(new Error(e.data.message ?? "Compile failed"));
    return;
  }
  if (e.data.type !== "compiled") {
    p.reject(new Error("Unexpected worker message"));
    return;
  }

  const output = e.data.output ?? {};
  const rawContracts = output.contracts as RawContracts | undefined;
  const contracts: CompileOutput["contracts"] = rawContracts ? resolveContracts(rawContracts) : {};

  p.resolve({
    status: (e.data.status as "success" | "error") ?? "error",
    contracts,
    errors: e.data.errors ?? [],
    warnings: e.data.warnings ?? [],
    resolvedImports: e.data.resolvedImports ?? [],
    importErrors: e.data.importErrors ?? [],
    standardJsonInput: e.data.standardJsonInput ?? "",
    timeMs: e.data.timeMs ?? 0,
  });
}

export function compile({
  sources,
  version,
  mainFile,
  optimize = false,
  optimizerRuns = 200,
  evmVersion = DEFAULT_EVM_VERSION,
}: CompileRequest): Promise<CompileOutput> {
  const id = ++nextId;
  const entry = getWorker(version);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // A hung soljson cannot be interrupted, only discarded.
      if (worker === entry) {
        dropWorker(new Error("The compiler did not answer in time and was restarted."));
      } else {
        entry.pending.delete(id);
        reject(new Error("The compiler did not answer in time."));
      }
    }, COMPILE_TIMEOUT_MS);
    entry.pending.set(id, { resolve, reject, timer });
    entry.w.postMessage({ id, sources, version, mainFile, optimize, optimizerRuns, evmVersion });
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
