// An in-memory EVM at the Shanghai fork the contracts are compiled for, with
// funded accounts and helpers to deploy and call. Shared by the contract tests.
import { decodeFunctionResult, encodeDeployData, encodeFunctionData, type Abi } from "viem";
import { EVM } from "@ethereumjs/evm";
import { Chain, Common, Hardfork } from "@ethereumjs/common";
import { Account, Address, hexToBytes } from "@ethereumjs/util";

export const OWNER = "0x1111111111111111111111111111111111111111";
export const TREASURY = "0x2222222222222222222222222222222222222222";
export const CREATOR = "0x3333333333333333333333333333333333333333";
export const BUYER = "0x4444444444444444444444444444444444444444";
export const LABELER = "0x5555555555555555555555555555555555555555";
export const ETHER = 10n ** 18n;
export const GAS = 30_000_000n;
export const HASH = `0x${"ab".repeat(32)}` as const;

const toHex = (u: Uint8Array): `0x${string}` =>
  `0x${Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("")}`;

export interface Chainlet {
  evm: EVM;
  deploy(abi: Abi, bytecode: `0x${string}`, args: unknown[], from?: string): Promise<string>;
  call(
    to: string,
    abi: Abi,
    fn: string,
    args: unknown[],
    opts?: { from?: string; value?: bigint },
  ): Promise<{ ok: boolean; result: unknown; revert: string }>;
  balance(addr: string): Promise<bigint>;
}

export async function chainlet(): Promise<Chainlet> {
  const common = new Common({ chain: Chain.Mainnet, hardfork: Hardfork.Shanghai });
  const evm = await EVM.create({ common });
  for (const a of [OWNER, TREASURY, CREATOR, BUYER, LABELER]) {
    await evm.stateManager.putAccount(Address.fromString(a), new Account(0n, 1000n * ETHER));
  }
  const block = {
    header: {
      number: 1_000_000n,
      timestamp: BigInt(Math.floor(Date.now() / 1000)),
      cliffordTimestamp: BigInt(Math.floor(Date.now() / 1000)),
      difficulty: 0n,
      prevRandao: new Uint8Array(32),
      gasLimit: GAS,
      baseFeePerGas: 0n,
      coinbase: Address.zero(),
      getBlobGasPrice: () => 0n,
    },
  };
  // runCall does not advance nonces, so CREATE addresses would collide.
  const nonces = new Map<string, bigint>();

  return {
    evm,
    async deploy(abi, bytecode, args, from = OWNER) {
      const nonce = nonces.get(from) ?? 0n;
      nonces.set(from, nonce + 1n);
      await evm.stateManager.putAccount(
        Address.fromString(from),
        new Account(nonce, (await evm.stateManager.getAccount(Address.fromString(from)))!.balance),
      );
      const res = await evm.runCall({
        caller: Address.fromString(from),
        origin: Address.fromString(from),
        data: hexToBytes(encodeDeployData({ abi, bytecode, args })),
        gasLimit: GAS,
        block: block as never,
      });
      if (res.execResult.exceptionError || !res.createdAddress) {
        throw new Error(`deploy failed: ${res.execResult.exceptionError?.error}`);
      }
      return res.createdAddress.toString();
    },
    async call(to, abi, fn, args, opts = {}) {
      const from = opts.from ?? OWNER;
      const res = await evm.runCall({
        caller: Address.fromString(from),
        origin: Address.fromString(from),
        to: Address.fromString(to),
        value: opts.value ?? 0n,
        data: hexToBytes(encodeFunctionData({ abi, functionName: fn, args } as never)),
        gasLimit: GAS,
        block: block as never,
      });
      const out = toHex(res.execResult.returnValue);
      if (res.execResult.exceptionError) {
        // Error(string): selector 0x08c379a0, then an ABI-encoded string.
        let revert = "";
        if (out.startsWith("0x08c379a0")) {
          const len = Number(BigInt(`0x${out.slice(74, 138)}`));
          revert = Buffer.from(out.slice(138, 138 + len * 2), "hex").toString("utf8");
        }
        return { ok: false, result: undefined, revert };
      }
      const result = decodeFunctionResult({ abi, functionName: fn, data: out } as never);
      return { ok: true, result, revert: "" };
    },
    async balance(addr) {
      return (await evm.stateManager.getAccount(Address.fromString(addr)))?.balance ?? 0n;
    },
  };
}
