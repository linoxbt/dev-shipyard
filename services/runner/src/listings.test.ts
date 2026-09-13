import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleHash } from "../../../src/lib/marketplace/bundle";
import { readListingFiles, storeListingFiles, type ListingChain } from "./listings";

// The chain decides, this module obeys. Each case below is a way a paid file
// could leak or be swapped, checked against a fake chain.

const CREATOR = "0x1111111111111111111111111111111111111111";
const BUYER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";
const FILES = { "SKILL.md": "# Review\nRead every changed file." };

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});
function scratch() {
  const root = mkdtempSync(join(tmpdir(), "listings-"));
  roots.push(root);
  return root;
}

async function fakeChain(opts: { hidden?: boolean; hash?: string } = {}): Promise<ListingChain> {
  const contentHash = opts.hash ?? (await bundleHash(FILES));
  return {
    facts: async (_chainId, id) =>
      id === 0 ? { creator: CREATOR, contentHash, hidden: opts.hidden ?? false } : null,
    hasAccess: async (_chainId, id, wallet) =>
      id === 0 &&
      (wallet.toLowerCase() === CREATOR.toLowerCase() ||
        (!opts.hidden && wallet.toLowerCase() === BUYER.toLowerCase())),
  };
}

describe("uploading a listing's files", () => {
  it("accepts the creator's files when they match the on-chain hash", async () => {
    const root = scratch();
    const r = await storeListingFiles({
      chain: await fakeChain(),
      chainId: 1990,
      id: 0,
      owner: CREATOR,
      files: FILES,
      root,
    });
    expect(r.status).toBe(200);
  });

  it("refuses anyone but the creator", async () => {
    const r = await storeListingFiles({
      chain: await fakeChain(),
      chainId: 1990,
      id: 0,
      owner: STRANGER,
      files: FILES,
      root: scratch(),
    });
    expect(r.status).toBe(403);
  });

  it("refuses files that differ from what was listed", async () => {
    const r = await storeListingFiles({
      chain: await fakeChain(),
      chainId: 1990,
      id: 0,
      owner: CREATOR,
      files: { "SKILL.md": "something else" },
      root: scratch(),
    });
    expect(r.status).toBe(409);
  });

  it("refuses unsafe paths before touching the chain", async () => {
    const r = await storeListingFiles({
      chain: await fakeChain(),
      chainId: 1990,
      id: 0,
      owner: CREATOR,
      files: { "../x": "y" },
      root: scratch(),
    });
    expect(r.status).toBe(400);
  });

  it("refuses a listing that does not exist", async () => {
    const r = await storeListingFiles({
      chain: await fakeChain(),
      chainId: 1990,
      id: 7,
      owner: CREATOR,
      files: FILES,
      root: scratch(),
    });
    expect(r.status).toBe(404);
  });
});

describe("downloading a listing's files", () => {
  it("serves a buyer exactly the uploaded files", async () => {
    const root = scratch();
    const chain = await fakeChain();
    await storeListingFiles({ chain, chainId: 1990, id: 0, owner: CREATOR, files: FILES, root });
    const r = await readListingFiles({ chain, chainId: 1990, id: 0, wallet: BUYER, root });
    expect(r.status).toBe(200);
    expect(r.body.files).toEqual(FILES);
  });

  it("refuses a wallet that has not paid", async () => {
    const root = scratch();
    const chain = await fakeChain();
    await storeListingFiles({ chain, chainId: 1990, id: 0, owner: CREATOR, files: FILES, root });
    const r = await readListingFiles({ chain, chainId: 1990, id: 0, wallet: STRANGER, root });
    expect(r.status).toBe(403);
    expect(r.body.files).toBeUndefined();
  });

  it("refuses a buyer once the listing is hidden", async () => {
    const root = scratch();
    await storeListingFiles({
      chain: await fakeChain(),
      chainId: 1990,
      id: 0,
      owner: CREATOR,
      files: FILES,
      root,
    });
    const r = await readListingFiles({
      chain: await fakeChain({ hidden: true }),
      chainId: 1990,
      id: 0,
      wallet: BUYER,
      root,
    });
    expect(r.status).toBe(403);
  });

  it("says so when the creator has not uploaded yet", async () => {
    const r = await readListingFiles({
      chain: await fakeChain(),
      chainId: 1990,
      id: 0,
      wallet: BUYER,
      root: scratch(),
    });
    expect(r.status).toBe(404);
  });

  it("requires a wallet", async () => {
    const r = await readListingFiles({
      chain: await fakeChain(),
      chainId: 1990,
      id: 0,
      wallet: "",
      root: scratch(),
    });
    expect(r.status).toBe(401);
  });
});
