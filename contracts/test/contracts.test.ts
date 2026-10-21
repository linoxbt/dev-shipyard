// Behaviour tests for the committed contract artifacts (contracts/out/*.json),
// run in an in-memory EVM at the Shanghai fork the contracts are compiled for.
//
// These exercise the deployed bytecode's rules directly: the fee split the
// README promises creators, the exact-payment checks, the pull-payment
// withdraw, and the label registry's auto-label restriction. They test the
// artifacts rather than a fresh compile on purpose: the artifacts are what the
// app deploys and calls, and scripts/check-contracts.ts separately proves the
// artifacts match the source.
import { beforeEach, describe, expect, it } from "bun:test";
import { decodeFunctionResult, encodeDeployData, encodeFunctionData, type Abi } from "viem";
import { EVM } from "@ethereumjs/evm";
import { Chain, Common, Hardfork } from "@ethereumjs/common";
import { Account, Address, hexToBytes } from "@ethereumjs/util";
import marketplaceArtifact from "../out/DevStationMarketplace.json";
import labelArtifact from "../out/ContractLabelRegistry.json";
import { stripMetadata } from "../../scripts/lib/compile-contracts";

const OWNER = "0x1111111111111111111111111111111111111111";
const TREASURY = "0x2222222222222222222222222222222222222222";
const CREATOR = "0x3333333333333333333333333333333333333333";
const BUYER = "0x4444444444444444444444444444444444444444";
const LABELER = "0x5555555555555555555555555555555555555555";
const ETHER = 10n ** 18n;
const GAS = 30_000_000n;
const HASH = `0x${"ab".repeat(32)}` as const;

const toHex = (u: Uint8Array): `0x${string}` =>
  `0x${Array.from(u, (b) => b.toString(16).padStart(2, "0")).join("")}`;

interface Chainlet {
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

async function chainlet(): Promise<Chainlet> {
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

const mAbi = marketplaceArtifact.abi as Abi;
const mBin = marketplaceArtifact.bytecode as `0x${string}`;
const lAbi = labelArtifact.abi as Abi;
const lBin = labelArtifact.bytecode as `0x${string}`;

// kind, currency, model, price, name, description, metadataJson, contentHash
const publishArgs = (model: number, price: bigint, kind = 0) => [
  kind,
  0,
  model,
  price,
  "Token",
  "An ERC20",
  "{}",
  HASH,
];

describe("DevStationMarketplace", () => {
  let c: Chainlet;
  let market: string;

  beforeEach(async () => {
    c = await chainlet();
    // No QUSDC on this chain: native-only, which is what these tests cover.
    market = await c.deploy(mAbi, mBin, [TREASURY, "0x0000000000000000000000000000000000000000"]);
    const pub = await c.call(market, mAbi, "publish", publishArgs(0, ETHER), { from: CREATOR });
    expect(pub.ok).toBe(true);
  });

  it("splits a sale 95% to the creator and 5% to the treasury", async () => {
    const buy = await c.call(market, mAbi, "buy", [0n], { from: BUYER, value: ETHER });
    expect(buy.ok).toBe(true);
    const creator = await c.call(market, mAbi, "pending", [
      "0x0000000000000000000000000000000000000000",
      CREATOR,
    ]);
    const treasury = await c.call(market, mAbi, "pending", [
      "0x0000000000000000000000000000000000000000",
      TREASURY,
    ]);
    expect(creator.result).toBe((ETHER * 95n) / 100n);
    expect(treasury.result).toBe((ETHER * 5n) / 100n);
  });

  it("rounds the fee down, so a creator never keeps less than 95%", async () => {
    await c.call(market, mAbi, "publish", publishArgs(0, 19n), { from: CREATOR });
    await c.call(market, mAbi, "buy", [1n], { from: BUYER, value: 19n });
    const creator = await c.call(market, mAbi, "pending", [
      "0x0000000000000000000000000000000000000000",
      CREATOR,
    ]);
    // 5% of 19 is 0.95, floored to 0.
    expect(creator.result).toBe(19n);
  });

  it("refuses anything but the exact price", async () => {
    const under = await c.call(market, mAbi, "buy", [0n], { from: BUYER, value: ETHER - 1n });
    const over = await c.call(market, mAbi, "buy", [0n], { from: BUYER, value: ETHER + 1n });
    expect(under.ok).toBe(false);
    expect(over.ok).toBe(false);
    expect(under.revert).toBe("Send exactly the price in QIE");
  });

  it("grants access on purchase and refuses to charge the same wallet twice", async () => {
    const before = await c.call(market, mAbi, "hasAccess", [0n, BUYER]);
    expect(before.result).toBe(false);
    await c.call(market, mAbi, "buy", [0n], { from: BUYER, value: ETHER });
    const after = await c.call(market, mAbi, "hasAccess", [0n, BUYER]);
    expect(after.result).toBe(true);
    const again = await c.call(market, mAbi, "buy", [0n], { from: BUYER, value: ETHER });
    expect(again.ok).toBe(false);
    expect(again.revert).toBe("Already purchased");
  });

  it("does not let a creator buy their own listing", async () => {
    const own = await c.call(market, mAbi, "buy", [0n], { from: CREATOR, value: ETHER });
    expect(own.ok).toBe(false);
  });

  it("passes tips through with no fee", async () => {
    const tip = await c.call(market, mAbi, "tip", [0n, 1000n], { from: BUYER, value: 1000n });
    expect(tip.ok).toBe(true);
    const creator = await c.call(market, mAbi, "pending", [
      "0x0000000000000000000000000000000000000000",
      CREATOR,
    ]);
    expect(creator.result).toBe(1000n);
  });

  it("charges per-deploy listings on every deploy and the creator nothing", async () => {
    await c.call(market, mAbi, "publish", publishArgs(1, 100n), { from: CREATOR });
    expect(
      (await c.call(market, mAbi, "recordDeploy", [1n], { from: BUYER, value: 100n })).ok,
    ).toBe(true);
    expect(
      (await c.call(market, mAbi, "recordDeploy", [1n], { from: BUYER, value: 100n })).ok,
    ).toBe(true);
    expect(
      (await c.call(market, mAbi, "recordDeploy", [1n], { from: CREATOR, value: 0n })).ok,
    ).toBe(true);
    const creator = await c.call(market, mAbi, "pending", [
      "0x0000000000000000000000000000000000000000",
      CREATOR,
    ]);
    expect(creator.result).toBe(190n); // 2 x (100 - 5)
  });

  it("only lets templates use per-deploy pricing", async () => {
    const app = await c.call(market, mAbi, "publish", publishArgs(1, 100n, 1), { from: CREATOR });
    expect(app.ok).toBe(false);
  });

  it("withdraws the balance once and zeroes it", async () => {
    await c.call(market, mAbi, "buy", [0n], { from: BUYER, value: ETHER });
    const before = await c.balance(CREATOR);
    const w = await c.call(
      market,
      mAbi,
      "withdraw",
      ["0x0000000000000000000000000000000000000000"],
      {
        from: CREATOR,
      },
    );
    expect(w.ok).toBe(true);
    expect((await c.balance(CREATOR)) - before).toBe((ETHER * 95n) / 100n);
    const again = await c.call(
      market,
      mAbi,
      "withdraw",
      ["0x0000000000000000000000000000000000000000"],
      { from: CREATOR },
    );
    expect(again.ok).toBe(false);
    expect(again.revert).toBe("Nothing to withdraw");
  });

  it("refuses a QUSDC listing on a chain without QUSDC", async () => {
    const args = publishArgs(0, 1n);
    args[1] = 1;
    expect((await c.call(market, mAbi, "publish", args, { from: CREATOR })).ok).toBe(false);
  });
});

describe("ContractLabelRegistry", () => {
  const TARGET = "0x9999999999999999999999999999999999999999";

  it("refuses autoLabeled=true from anyone but the autoLabeler", async () => {
    const c = await chainlet();
    const reg = await c.deploy(lAbi, lBin, [LABELER]);
    const user = await c.call(reg, lAbi, "submitLabel", [TARGET, "Mine", "token", "", true], {
      from: BUYER,
    });
    expect(user.ok).toBe(false);
    expect(user.revert).toBe("Not authorized to auto-label");

    const labeler = await c.call(reg, lAbi, "submitLabel", [TARGET, "Real", "token", "", true], {
      from: LABELER,
    });
    expect(labeler.ok).toBe(true);
  });

  it("accepts a community label from any wallet, and only its submitter can change it", async () => {
    const c = await chainlet();
    const reg = await c.deploy(lAbi, lBin, [LABELER]);
    expect(
      (
        await c.call(reg, lAbi, "submitLabel", [TARGET, "Mine", "token", "", false], {
          from: BUYER,
        })
      ).ok,
    ).toBe(true);
    const other = await c.call(reg, lAbi, "submitLabel", [TARGET, "Squat", "token", "", false], {
      from: CREATOR,
    });
    expect(other.ok).toBe(false);
    const name = await c.call(reg, lAbi, "getLabelName", [TARGET]);
    expect(name.result).toBe("Mine");
  });
});

describe("stripMetadata", () => {
  it("drops only solc's trailing CBOR metadata", () => {
    // 0xa1 0x00 is a 2-byte "metadata", then its length 0x0002.
    expect(stripMetadata("0x6001a1000002")).toBe("6001");
    expect(stripMetadata("0x")).toBe("");
  });
});
