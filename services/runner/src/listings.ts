// Locked marketplace files: stored here, released only to wallets that paid.
//
// DevStationMarketplace is the source of truth for who may download what. This
// module never decides access itself: it asks the chain. An upload is accepted
// only from the listing's on-chain creator, and only when the files hash to the
// listing's on-chain `contentHash`, so nobody can swap in different files
// behind a listing people have paid for. A download is served only when
// `hasAccess(id, wallet)` is true, and the wallet comes from DevStation's
// server, which verified it with a signature before calling this.

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { stateDir } from "./state-dir";
import { createPublicClient, fallback, http } from "viem";
import { bundleHash, bundleProblem, type Bundle } from "../../../src/lib/marketplace/bundle";
import { devStationMarketplaceAbi } from "../../../src/lib/abis/devStationMarketplace";
import { isContractConfigured, marketplaceAddress } from "../../../src/lib/contracts";
import { SUPPORTED_CHAINS } from "../../../src/lib/chains";

export interface ListingFacts {
  creator: string;
  contentHash: string;
  hidden: boolean;
}

/** What this module needs from the chain. Injected so tests run without RPC. */
export interface ListingChain {
  facts(chainId: number, id: number): Promise<ListingFacts | null>;
  hasAccess(chainId: number, id: number, wallet: string): Promise<boolean>;
}

export interface ListingResult {
  status: number;
  body: Record<string, unknown>;
}

const ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

/** Under the service's StateDirectory: the unit mounts /root read-only. */
export function listingsDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.LISTINGS_DIR ?? join(stateDir(env), "listings");
}

function fail(status: number, message: string): ListingResult {
  return { status, body: { ok: false, message } };
}

function validIds(chainId: number, id: number): boolean {
  return (
    Number.isInteger(chainId) && chainId > 0 && chainId < 2 ** 32 && Number.isInteger(id) && id >= 0
  );
}

/** Earlier uploads kept per listing, newest first, so a creator replacing the
 *  files after a sale cannot take away what a buyer paid for. Bounded, so a
 *  creator re-uploading in a loop cannot fill the disk. */
export const KEEP_VERSIONS = 5;

function fileFor(root: string, chainId: number, id: number, hash: string): string {
  // Every segment is validated as an integer or a 32-byte hex hash before it
  // gets here, so none can climb out of the listings directory.
  return join(root, String(chainId), String(id), `${hash.toLowerCase()}.json`);
}

export async function storeListingFiles(input: {
  chain: ListingChain;
  chainId: number;
  id: number;
  owner: string;
  files: unknown;
  root?: string;
}): Promise<ListingResult> {
  const { chain, chainId, id, owner } = input;
  if (!validIds(chainId, id)) return fail(400, "Unknown listing.");
  if (!ADDRESS.test(owner)) return fail(400, "A wallet address is required.");
  const problem = bundleProblem(input.files);
  if (problem) return fail(400, problem);

  const facts = await chain.facts(chainId, id);
  if (!facts) return fail(404, "There is no such listing on this network.");
  if (facts.creator.toLowerCase() !== owner.toLowerCase()) {
    return fail(403, "Only the listing's creator can upload its files.");
  }
  const files = input.files as Bundle;
  const hash = await bundleHash(files);
  if (!HASH.test(facts.contentHash) || hash.toLowerCase() !== facts.contentHash.toLowerCase()) {
    return fail(409, "These files do not match the content hash recorded for the listing.");
  }

  const target = fileFor(input.root ?? listingsDir(), chainId, id, hash);
  mkdirSync(join(target, ".."), { recursive: true });
  // Written aside and renamed, so a crash mid-write never leaves a buyer a
  // truncated bundle that fails its hash check.
  const temporary = `${target}.tmp`;
  writeFileSync(temporary, JSON.stringify(files));
  renameSync(temporary, target);
  pruneVersions(join(target, ".."));
  return { status: 200, body: { ok: true, contentHash: hash } };
}

/** Drops all but the newest KEEP_VERSIONS bundles in one listing's directory. */
function pruneVersions(dir: string): void {
  try {
    const versions = readdirSync(dir)
      .filter((name) => /^0x[0-9a-f]{64}\.json$/.test(name))
      .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    for (const old of versions.slice(KEEP_VERSIONS)) rmSync(join(dir, old.name), { force: true });
  } catch {
    // Pruning is housekeeping; a failure here must not fail the upload.
  }
}

export async function readListingFiles(input: {
  chain: ListingChain;
  chainId: number;
  id: number;
  wallet: string;
  /** A specific earlier version, by content hash. Defaults to the one the
   *  listing records now. Only versions the creator uploaded and the chain
   *  recorded at the time exist to be served. */
  version?: string;
  root?: string;
}): Promise<ListingResult> {
  const { chain, chainId, id, wallet } = input;
  if (input.version !== undefined && !HASH.test(input.version)) {
    return fail(400, "That is not a content hash.");
  }
  if (!validIds(chainId, id)) return fail(400, "Unknown listing.");
  if (!ADDRESS.test(wallet)) return fail(401, "Connect a wallet to download.");

  const facts = await chain.facts(chainId, id);
  if (!facts) return fail(404, "There is no such listing on this network.");
  if (!(await chain.hasAccess(chainId, id, wallet))) {
    return fail(403, "Buy this listing to download its files.");
  }
  const wanted = input.version ?? facts.contentHash;
  if (!HASH.test(wanted)) return fail(404, "This listing has no files.");

  const path = fileFor(input.root ?? listingsDir(), chainId, id, wanted);
  if (!existsSync(path)) {
    return fail(
      404,
      input.version
        ? "That version of this listing is not stored."
        : "The creator has not uploaded the files for this listing yet.",
    );
  }
  let files: Bundle;
  try {
    files = JSON.parse(readFileSync(path, "utf8")) as Bundle;
  } catch {
    return fail(500, "The stored files could not be read.");
  }
  return { status: 200, body: { ok: true, contentHash: wanted.toLowerCase(), files } };
}

/** Reads DevStationMarketplace over each chain's public RPC. */
export function rpcListingChain(): ListingChain {
  const clients = new Map<number, ReturnType<typeof createPublicClient>>();
  const clientFor = (chainId: number) => {
    const chain = SUPPORTED_CHAINS.find((c) => c.id === chainId);
    if (!chain) return null;
    let client = clients.get(chainId);
    if (!client) {
      client = createPublicClient({
        chain,
        transport: fallback(chain.rpcUrls.default.http.map((url) => http(url))),
      });
      clients.set(chainId, client);
    }
    return client;
  };
  const addressFor = (chainId: number) => {
    const address = marketplaceAddress(chainId);
    return isContractConfigured(address) ? address : null;
  };

  return {
    async facts(chainId, id) {
      const client = clientFor(chainId);
      const address = addressFor(chainId);
      if (!client || !address) return null;
      try {
        const listing = (await client.readContract({
          address,
          abi: devStationMarketplaceAbi,
          functionName: "getListing",
          args: [BigInt(id)],
        })) as { creator: string; contentHash: string; hidden: boolean };
        return {
          creator: listing.creator,
          contentHash: listing.contentHash,
          hidden: listing.hidden,
        };
      } catch {
        // "No such listing" reverts; so does an unreachable RPC. Both mean
        // nothing can be served, which is the safe reading.
        return null;
      }
    },
    async hasAccess(chainId, id, wallet) {
      const client = clientFor(chainId);
      const address = addressFor(chainId);
      if (!client || !address) return false;
      try {
        return (await client.readContract({
          address,
          abi: devStationMarketplaceAbi,
          functionName: "hasAccess",
          args: [BigInt(id), wallet as `0x${string}`],
        })) as boolean;
      } catch {
        return false;
      }
    },
  };
}
