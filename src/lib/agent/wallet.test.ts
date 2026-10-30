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
