// Runs a declarative test suite against a freshly compiled contract, inside an
// in-browser EVM.
//
// Why a local EVM rather than a testnet: tests must be instant, free, and
// available even when a network is unreachable — QIE testnet has been down for
// long stretches and BOT testnet has no funded faucet wallet. Running locally
// also means a failing test costs nothing and can be retried in the agent's
// fix loop as fast as a compile.
//
// The EVM packages are imported dynamically so they stay out of the main
// bundle; only a user who actually runs tests pays to download them.

import { decodeFunctionResult, encodeDeployData, encodeFunctionData, type Abi } from "viem";
import { decodeRevertData } from "@/lib/decode-abi";
import { parseArgs } from "@/lib/abiArgParser";
import {
  OTHER_PLACEHOLDER,
  OWNER_PLACEHOLDER,
  WALLET_PLACEHOLDER,
  type SuiteResult,
  type TestCase,
  type TestOutcome,
  type TestSuite,
} from "./types";

/** Deterministic accounts, so a suite never needs a real address and results
 *  are reproducible run to run. */
export const TEST_OWNER = "0x1111111111111111111111111111111111111111" as const;
export const TEST_OTHER = "0x2222222222222222222222222222222222222222" as const;

const GAS_LIMIT = 30_000_000n;
/** Starting block context for a run.
 *
 *  The EVM defaults every block field to zero, which is not a realistic chain:
 *  `block.timestamp == 0` makes every cliff, vesting schedule, timelock and
 *  deadline behave as though no time has ever passed, so those tests pass or
 *  fail for reasons that have nothing to do with the contract. Starting from a
 *  real wall-clock time — and letting a suite advance it with `warpSeconds` —
 *  is what makes time-dependent contracts genuinely testable. */
const START_BLOCK = 1_000_000n;
/** Balance seeded on both test accounts so payable calls can send value. */
const SEED_BALANCE = 10n ** 21n; // 1000 ether

/** Placeholder -> address for one run. Seeded with the two test accounts and
 *  extended with each helper contract as it is deployed. */
type Placeholders = Record<string, string>;

function basePlaceholders(): Placeholders {
  return {
    [OWNER_PLACEHOLDER]: TEST_OWNER,
    [WALLET_PLACEHOLDER]: TEST_OWNER,
    [OTHER_PLACEHOLDER]: TEST_OTHER,
  };
}

function resolveAddress(v: unknown, ph: Placeholders): unknown {
  if (typeof v === "string" && v.startsWith("$")) return ph[v] ?? v;
  if (Array.isArray(v)) return v.map((x) => resolveAddress(x, ph));
  return v;
}

/** Any $PLACEHOLDER in `values` that nothing has bound.
 *  Without this an unknown name falls through to viem as the literal string
 *  "$FOO" and surfaces as "Address must be a hex value of 20 bytes… viem@x",
 *  which tells the reader nothing about the actual mistake. */
function unknownPlaceholders(values: unknown[], ph: Placeholders): string[] {
  const found = new Set<string>();
  const walk = (v: unknown) => {
    if (typeof v === "string" && v.startsWith("$") && !(v in ph)) found.add(v);
    else if (Array.isArray(v)) v.forEach(walk);
  };
  values.forEach(walk);
  return [...found];
}

function placeholderHint(unknown_: string[], ph: Placeholders): string {
  return (
    `Unknown placeholder${unknown_.length > 1 ? "s" : ""} ${unknown_.join(", ")}. ` +
    `Declare it in "deploy", or use one of: ${Object.keys(ph).join(", ")}.`
  );
}

/** Map the suite's JSON args onto the ABI's real types (uint256 -> bigint etc).
 *  Reuses the same parser the deploy forms use, so tests and deploys coerce
 *  arguments identically — a value that works in a test works in a deploy.
 *
 *  Known limit, shared with the deploy wizard: abiArgParser handles address,
 *  uint/int, bool, bytes, string and one level of array, but NOT tuples or
 *  structs. A struct constructor/function argument will fail to encode and be
 *  reported as an encoding error rather than silently mis-run. */
function coerce(
  inputs: ReadonlyArray<{ name?: string; type: string }>,
  rawArgs: unknown[],
  ph: Placeholders,
): unknown[] {
  const resolved = rawArgs.map((a) => resolveAddress(a, ph));
  const values: Record<string, string> = {};
  inputs.forEach((inp, i) => {
    const v = resolved[i];
    values[inp.name || `arg${i}`] =
      v === undefined || v === null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
  });
  return parseArgs(
    inputs.map((inp, i) => ({ name: inp.name || `arg${i}`, type: inp.type })),
    values,
  );
}

function abiEntry(abi: Abi, name: string) {
  return abi.find((e) => e.type === "function" && "name" in e && e.name === name);
}

function constructorInputs(abi: Abi): ReadonlyArray<{ name?: string; type: string }> {
  const ctor = abi.find((e) => e.type === "constructor");
  return ctor && "inputs" in ctor
    ? (ctor.inputs as ReadonlyArray<{ name?: string; type: string }>)
    : [];
}

const toHex = (u: Uint8Array): `0x${string}` =>
  `0x${Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** Compiles a helper contract's source for the test run. Injected rather than
 *  imported so the runner stays independent of HOW compilation happens — the
 *  app passes the in-browser solc worker, tests pass node solc. */
export type HelperCompiler = (source: string) => Promise<{
  contracts: Record<string, { abi: unknown[]; bytecode: `0x${string}` }>;
  errors: string[];
}>;

export interface RunSuiteParams {
  abi: Abi;
  bytecode: `0x${string}`;
  suite: TestSuite;
  /** Required only when the suite declares `deploy` helpers. */
  compileHelper?: HelperCompiler;
}

export async function runSuite({
  abi,
  bytecode,
  suite,
  compileHelper,
}: RunSuiteParams): Promise<SuiteResult> {
  const { EVM } = await import("@ethereumjs/evm");
  const { Common, Chain, Hardfork } = await import("@ethereumjs/common");
  const { Address, hexToBytes, Account } = await import("@ethereumjs/util");

  // Shanghai, matching what DevStation compiles for — QIE has no MCOPY, so
  // testing under a later hardfork could pass code that cannot run on-chain.
  const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai });
  const evm = await EVM.create({ common });

  // Mutable block context, advanced by warpSeconds. Passed to every call so
  // block.timestamp / block.number read like a live chain rather than zero.
  let now = BigInt(Math.floor(Date.now() / 1000));
  let height = START_BLOCK;
  const blockCtx = () => ({
    header: {
      number: height,
      cliffordTimestamp: now,
      timestamp: now,
      difficulty: 0n,
      prevRandao: new Uint8Array(32),
      gasLimit: GAS_LIMIT,
      baseFeePerGas: 0n,
      coinbase: owner,
      getBlobGasPrice: () => undefined,
    },
  });
  const advance = (seconds: number) => {
    now += BigInt(seconds);
    height += BigInt(Math.max(1, Math.floor(seconds / 12)));
  };

  const owner = new Address(hexToBytes(TEST_OWNER));
  const other = new Address(hexToBytes(TEST_OTHER));
  for (const a of [owner, other]) {
    await evm.stateManager.putAccount(a, new Account(0n, SEED_BALANCE));
  }

  // --- helper contracts ---------------------------------------------------
  // Deployed first, in order, so the contract under test has real code at the
  // addresses it depends on. Each helper can reference earlier placeholders.
  const ph = basePlaceholders();
  const helpers: Record<string, string> = {};
  const bail = (deployError: string): SuiteResult => ({
    helpers,
    deployed: false,
    deployError,
    outcomes: [],
    passed: 0,
    failed: 0,
    ok: false,
  });

  for (const h of suite.deploy) {
    if (!compileHelper) {
      return bail(
        `The suite declares helper contract ${h.as} but no compiler was provided to build it.`,
      );
    }
    let built;
    try {
      built = await compileHelper(h.solidity);
    } catch (e) {
      return bail(`Could not compile helper ${h.as}: ${msg(e)}`);
    }
    if (built.errors.length) {
      return bail(`Helper ${h.as} failed to compile: ${built.errors.slice(0, 3).join(" | ")}`);
    }
    const names = Object.keys(built.contracts);
    const pick = h.contract ?? (names.length === 1 ? names[0] : undefined);
    if (!pick) {
      return bail(
        `Helper ${h.as} has ${names.length} contracts (${names.join(", ")}); set "contract" to choose one.`,
      );
    }
    const art = built.contracts[pick];
    if (!art) return bail(`Helper ${h.as}: no contract named "${pick}" in that source.`);

    let hData: `0x${string}`;
    try {
      hData = encodeDeployData({
        abi: art.abi as Abi,
        bytecode: art.bytecode,
        args: coerce(constructorInputs(art.abi as Abi), h.args, ph) as never,
      });
    } catch (e) {
      return bail(`Helper ${h.as}: could not encode constructor arguments — ${msg(e)}`);
    }
    const hRes = await evm.runCall({
      data: hexToBytes(hData),
      gasLimit: GAS_LIMIT,
      caller: owner,
      origin: owner,
      block: blockCtx() as never,
    });
    if (hRes.execResult.exceptionError || !hRes.createdAddress) {
      const reason = decodeRevertData(toHex(hRes.execResult.returnValue));
      return bail(`Helper ${h.as} (${pick}) failed to deploy${reason ? `: ${reason}` : ""}.`);
    }
    const addr = hRes.createdAddress.toString();
    ph[h.as] = addr;
    helpers[h.as] = addr;
  }

  // --- deploy -------------------------------------------------------------
  const unknownInDeploy = unknownPlaceholders(suite.deployArgs, ph);
  if (unknownInDeploy.length) return bail(placeholderHint(unknownInDeploy, ph));

  let deployData: `0x${string}`;
  try {
    deployData = encodeDeployData({
      abi,
      bytecode,
      args: coerce(constructorInputs(abi), suite.deployArgs, ph) as never,
    });
  } catch (e) {
    return bail(`Could not encode constructor arguments: ${msg(e)}`);
  }

  const deployRes = await evm.runCall({
    data: hexToBytes(deployData),
    gasLimit: GAS_LIMIT,
    caller: owner,
    origin: owner,
    block: blockCtx() as never,
  });
  if (deployRes.execResult.exceptionError || !deployRes.createdAddress) {
    const reason = decodeRevertData(toHex(deployRes.execResult.returnValue));
    return bail(
      reason
        ? `Constructor reverted: ${reason}`
        : `Constructor failed: ${deployRes.execResult.exceptionError?.error ?? "unknown error"}`,
    );
  }
  const contract = deployRes.createdAddress;

  // --- tests --------------------------------------------------------------
  const outcomes: TestOutcome[] = [];
  for (const t of suite.tests) {
    if (t.warpSeconds) advance(t.warpSeconds);
    outcomes.push(
      await runOne(evm, { abi, contract, owner, other, hexToBytes, Address, ph, blockCtx }, t),
    );
  }

  const passed = outcomes.filter((o) => o.passed).length;
  return {
    helpers,
    deployed: true,
    outcomes,
    passed,
    failed: outcomes.length - passed,
    ok: passed === outcomes.length,
  };
}

type EvmCtx = {
  abi: Abi;
  contract: { toString(): string };
  owner: unknown;
  other: unknown;
  hexToBytes: (s: string) => Uint8Array;
  Address: new (b: Uint8Array) => unknown;
  ph: Placeholders;
  blockCtx: () => unknown;
};

async function runOne(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  evm: any,
  ctx: EvmCtx,
  t: TestCase,
): Promise<TestOutcome> {
  const fn = abiEntry(ctx.abi, t.call);
  if (!fn) {
    return { name: t.name, passed: false, detail: `No function "${t.call}" in the contract ABI.` };
  }

  const unknownArgs = unknownPlaceholders([...t.args, t.expect.equals, t.from], ctx.ph);
  if (unknownArgs.length) {
    return { name: t.name, passed: false, detail: placeholderHint(unknownArgs, ctx.ph) };
  }

  let data: `0x${string}`;
  try {
    const inputs = ("inputs" in fn ? fn.inputs : []) as ReadonlyArray<{
      name?: string;
      type: string;
    }>;
    data = encodeFunctionData({
      abi: ctx.abi,
      functionName: t.call,
      args: coerce(inputs, t.args, ctx.ph) as never,
    });
  } catch (e) {
    return { name: t.name, passed: false, detail: `Could not encode arguments: ${msg(e)}` };
  }

  // `from` accepts any placeholder; anything unrecognised falls back to the
  // owner rather than silently sending from address(0).
  const fromAddr = t.from ? (ctx.ph[t.from] ?? String(resolveAddress(t.from, ctx.ph))) : null;
  const from =
    fromAddr && /^0x[0-9a-fA-F]{40}$/.test(fromAddr)
      ? new ctx.Address(ctx.hexToBytes(fromAddr))
      : ctx.owner;
  let res;
  try {
    res = await evm.runCall({
      to: ctx.contract,
      data: ctx.hexToBytes(data),
      gasLimit: GAS_LIMIT,
      caller: from,
      origin: from,
      value: t.value ? BigInt(t.value) : 0n,
      block: ctx.blockCtx() as never,
    });
  } catch (e) {
    return { name: t.name, passed: false, detail: `Call could not be executed: ${msg(e)}` };
  }

  const reverted = Boolean(res.execResult.exceptionError);
  const returnHex = toHex(res.execResult.returnValue);
  const gasUsed = String(res.execResult.executionGasUsed ?? 0n);

  // --- reverts ------------------------------------------------------------
  if (t.expect.reverts !== undefined && t.expect.reverts !== false) {
    if (!reverted) {
      return {
        name: t.name,
        passed: false,
        detail: "Expected the call to revert, but it succeeded.",
        gasUsed,
      };
    }
    if (typeof t.expect.reverts === "string") {
      const reason = decodeRevertData(returnHex) ?? "";
      if (!reason.toLowerCase().includes(t.expect.reverts.toLowerCase())) {
        return {
          name: t.name,
          passed: false,
          detail: `Expected revert containing "${t.expect.reverts}" but got ${reason ? `"${reason}"` : "no reason string"}.`,
          gasUsed,
        };
      }
    }
    return { name: t.name, passed: true, gasUsed };
  }

  // Any other expectation implies the call must NOT revert.
  if (reverted) {
    const reason = decodeRevertData(returnHex);
    return {
      name: t.name,
      passed: false,
      detail: reason
        ? `Reverted: ${reason}`
        : `Reverted (${res.execResult.exceptionError?.error}).`,
      gasUsed,
    };
  }

  // --- emits --------------------------------------------------------------
  if (t.expect.emits) {
    const wanted = eventTopic(ctx.abi, t.expect.emits);
    if (!wanted) {
      return {
        name: t.name,
        passed: false,
        detail: `No event "${t.expect.emits}" in the ABI.`,
        gasUsed,
      };
    }
    const logs = (res.execResult.logs ?? []) as Array<[Uint8Array, Uint8Array[], Uint8Array]>;
    const found = logs.some(
      (l) => l[1]?.[0] && toHex(l[1][0]).toLowerCase() === wanted.toLowerCase(),
    );
    if (!found) {
      return {
        name: t.name,
        passed: false,
        detail: `Expected event "${t.expect.emits}" was not emitted.`,
        gasUsed,
      };
    }
  }

  // --- equals -------------------------------------------------------------
  if (t.expect.equals !== undefined) {
    let actual: unknown;
    try {
      actual = decodeFunctionResult({ abi: ctx.abi, functionName: t.call, data: returnHex });
    } catch (e) {
      return {
        name: t.name,
        passed: false,
        detail: `Could not decode the return value: ${msg(e)}`,
        gasUsed,
      };
    }
    const a = normalise(actual);
    // Resolve placeholders on the EXPECTED side too. They are resolved in
    // args via coerce(), and a suite that writes {"equals": "$OWNER"} — the
    // natural way to assert an owner/recipient — must compare against the
    // real test address, not the literal string.
    const b = normalise(resolveAddress(t.expect.equals, ctx.ph));
    if (a !== b) {
      return { name: t.name, passed: false, detail: `Expected ${b} but got ${a}.`, gasUsed };
    }
  }

  return { name: t.name, passed: true, gasUsed };
}

/** Compare by string so 1000n, "1000" and 1000 all match, and addresses
 *  compare case-insensitively. */
function normalise(v: unknown): string {
  if (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v)) return v.toLowerCase();
  if (Array.isArray(v)) return v.map(normalise).join(",");
  return String(v);
}

function eventTopic(abi: Abi, name: string): `0x${string}` | null {
  const ev = abi.find((e) => e.type === "event" && "name" in e && e.name === name);
  if (!ev || !("inputs" in ev)) return null;
  const sig = `${name}(${(ev.inputs as Array<{ type: string }>).map((i) => i.type).join(",")})`;
  return keccakTopic(sig);
}

// keccak256 of the event signature. viem exposes this; kept in one place so
// the runner has a single source of truth for topic derivation.
import { keccak256, toBytes } from "viem";
function keccakTopic(sig: string): `0x${string}` {
  return keccak256(toBytes(sig));
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
