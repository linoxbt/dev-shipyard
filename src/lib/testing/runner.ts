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
/** Balance seeded on both test accounts so payable calls can send value. */
const SEED_BALANCE = 10n ** 21n; // 1000 ether

function resolveAddress(v: unknown): unknown {
  if (v === OWNER_PLACEHOLDER || v === WALLET_PLACEHOLDER) return TEST_OWNER;
  if (v === OTHER_PLACEHOLDER) return TEST_OTHER;
  if (Array.isArray(v)) return v.map(resolveAddress);
  return v;
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
): unknown[] {
  const resolved = rawArgs.map(resolveAddress);
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

export interface RunSuiteParams {
  abi: Abi;
  bytecode: `0x${string}`;
  suite: TestSuite;
}

export async function runSuite({ abi, bytecode, suite }: RunSuiteParams): Promise<SuiteResult> {
  const { EVM } = await import("@ethereumjs/evm");
  const { Common, Chain, Hardfork } = await import("@ethereumjs/common");
  const { Address, hexToBytes, Account } = await import("@ethereumjs/util");

  // Shanghai, matching what DevStation compiles for — QIE has no MCOPY, so
  // testing under a later hardfork could pass code that cannot run on-chain.
  const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai });
  const evm = await EVM.create({ common });

  const owner = new Address(hexToBytes(TEST_OWNER));
  const other = new Address(hexToBytes(TEST_OTHER));
  for (const a of [owner, other]) {
    await evm.stateManager.putAccount(a, new Account(0n, SEED_BALANCE));
  }

  // --- deploy -------------------------------------------------------------
  let deployData: `0x${string}`;
  try {
    deployData = encodeDeployData({
      abi,
      bytecode,
      args: coerce(constructorInputs(abi), suite.deployArgs) as never,
    });
  } catch (e) {
    return {
      deployed: false,
      deployError: `Could not encode constructor arguments: ${msg(e)}`,
      outcomes: [],
      passed: 0,
      failed: 0,
      ok: false,
    };
  }

  const deployRes = await evm.runCall({
    data: hexToBytes(deployData),
    gasLimit: GAS_LIMIT,
    caller: owner,
    origin: owner,
  });
  if (deployRes.execResult.exceptionError || !deployRes.createdAddress) {
    const reason = decodeRevertData(toHex(deployRes.execResult.returnValue));
    return {
      deployed: false,
      deployError: reason
        ? `Constructor reverted: ${reason}`
        : `Constructor failed: ${deployRes.execResult.exceptionError?.error ?? "unknown error"}`,
      outcomes: [],
      passed: 0,
      failed: 0,
      ok: false,
    };
  }
  const contract = deployRes.createdAddress;

  // --- tests --------------------------------------------------------------
  const outcomes: TestOutcome[] = [];
  for (const t of suite.tests) {
    outcomes.push(await runOne(evm, { abi, contract, owner, other, hexToBytes, Address }, t));
  }

  const passed = outcomes.filter((o) => o.passed).length;
  return {
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

  let data: `0x${string}`;
  try {
    const inputs = ("inputs" in fn ? fn.inputs : []) as ReadonlyArray<{
      name?: string;
      type: string;
    }>;
    data = encodeFunctionData({
      abi: ctx.abi,
      functionName: t.call,
      args: coerce(inputs, t.args) as never,
    });
  } catch (e) {
    return { name: t.name, passed: false, detail: `Could not encode arguments: ${msg(e)}` };
  }

  const from = t.from === OTHER_PLACEHOLDER ? ctx.other : ctx.owner;
  let res;
  try {
    res = await evm.runCall({
      to: ctx.contract,
      data: ctx.hexToBytes(data),
      gasLimit: GAS_LIMIT,
      caller: from,
      origin: from,
      value: t.value ? BigInt(t.value) : 0n,
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
    const b = normalise(resolveAddress(t.expect.equals));
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
