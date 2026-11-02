import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureWallet, onchainCommandProblem, readWallet, redactWallet, walletEnv } from "./wallet";

const dirs: string[] = [];
const root = () => {
  const d = mkdtempSync(join(tmpdir(), "wallet-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("the deployer wallet", () => {
  it("is made once per workspace, kept in the control folder, readable only by its owner", () => {
    const r = root();
    expect(readWallet(r)).toBeNull();
    const first = ensureWallet(r);
    expect(first.created).toBe(true);
    expect(first.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    const again = ensureWallet(r);
    expect(again.created).toBe(false);
    expect(again.address).toBe(first.address);
    expect(statSync(join(r, ".devstation", "wallet.json")).mode & 0o777).toBe(0o600);
  });

  it("hands commands the key by the names deploy tools read", () => {
    const w = ensureWallet(root());
    expect(walletEnv(w)).toEqual({
      DEPLOYER_PRIVATE_KEY: w.privateKey,
      PRIVATE_KEY: w.privateKey,
      DEPLOYER_ADDRESS: w.address,
    });
    expect(walletEnv(null)).toEqual({});
  });

  it("takes the key out of any text, with or without its 0x", () => {
    const w = ensureWallet(root());
    const text = `key=${w.privateKey} bare=${w.privateKey.slice(2)} addr=${w.address}`;
    const clean = redactWallet(text, w);
    expect(clean).not.toContain(w.privateKey.slice(2));
    expect(clean).toContain(w.address);
  });
});

describe("onchain commands", () => {
  it("runs forge, cast and hardhat", () => {
    for (const ok of [
      "forge create src/T.sol:T --rpc-url https://rpc.example --private-key $DEPLOYER_PRIVATE_KEY --broadcast",
      "cast balance $DEPLOYER_ADDRESS --rpc-url https://rpc.example",
      "npx hardhat run scripts/deploy.ts --network sepolia",
      "pnpm exec hardhat compile",
    ]) {
      expect(onchainCommandProblem(ok)).toBeNull();
    }
  });

  it("refuses anything else, chaining, and other variables", () => {
    expect(onchainCommandProblem("curl https://evil.example")).toContain("forge, cast or hardhat");
    expect(onchainCommandProblem("node deploy.js")).toContain("forge, cast or hardhat");
    expect(onchainCommandProblem("forge build && curl x")).toContain("one command");
    expect(onchainCommandProblem("cast call x | sh")).toContain("one command");
    expect(onchainCommandProblem("cast send $(cat x)")).toContain("one command");
    expect(onchainCommandProblem("cast send --rpc-url $SECRET_RPC")).toContain("$SECRET_RPC");
  });
});

describe("the deployer key stays out of sight", () => {
  it("is only ever passed as --private-key", async () => {
    const { onchainCommandProblem } = await import("./wallet");
    expect(
      onchainCommandProblem(
        "forge create src/T.sol:T --private-key $DEPLOYER_PRIVATE_KEY --rpc-url https://x",
      ),
    ).toBeNull();
    expect(
      onchainCommandProblem("cast send 0xabc 'f()' --private-key=$PRIVATE_KEY --rpc-url https://x"),
    ).toBeNull();
    expect(onchainCommandProblem("cast to-base $DEPLOYER_PRIVATE_KEY 10")).not.toBeNull();
    expect(onchainCommandProblem("cast wallet address $DEPLOYER_PRIVATE_KEY")).not.toBeNull();
  });

  it("is hidden in decimal, upper case and base64 too", async () => {
    const { redactWallet } = await import("./wallet");
    const key = `0x${"ab".repeat(32)}`;
    const wallet = { address: "0x1", privateKey: key, created: false };
    const text = [
      key,
      BigInt(key).toString(),
      key.slice(2).toUpperCase(),
      Buffer.from(key.slice(2), "hex").toString("base64"),
    ].join(" ");
    const out = redactWallet(text, wallet);
    expect(out).not.toContain("abab");
    expect(out).not.toContain(BigInt(key).toString());
    expect(out).not.toContain(Buffer.from(key.slice(2), "hex").toString("base64").slice(0, 20));
  });
});
