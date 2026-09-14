// Publishes the paid listings in marketplace-content/paid to DevStationMarketplace
// on QIE Mainnet from DevStation's wallet, then stores their files on the runner
// so buyers can download them.
//
// For each listing: hash the files, publish (unless a listing with the same
// files is already live under this wallet), upload the files to the runner,
// then download them back and check the hash, so what buyers get is exactly
// what the chain lists.
//
// Usage:
//   bun run scripts/publish-marketplace.ts --dry-run          show what would happen
//   bun run scripts/publish-marketplace.ts [slug ...]          publish all, or the named ones
//
// Reads PRIVATE_KEY from .env.local and RUNNER_TOKEN from /etc/devstation-runner.env
// (or the environment). Never prints either.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  formatUnits,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { devStationMarketplaceAbi } from "../src/lib/abis/devStationMarketplace";
import { bundleHash, bundleProblem, type Bundle } from "../src/lib/marketplace/bundle";
import {
  currencyCode,
  kindCode,
  modelCode,
  parsePrice,
  serializeMetadata,
  type Currency,
  type ListingKind,
} from "../src/lib/marketplace/listing";

const ROOT = resolve(import.meta.dirname, "..");
const PAID = join(ROOT, "marketplace-content", "paid");
/** DevStationMarketplace on QIE Mainnet (src/lib/contracts.ts). */
const MARKETPLACE = "0xeeae4de6198cbcc837240115e86554c6968ba51d" as const;

const qieMainnet = defineChain({
  id: 1990,
  name: "QIE Mainnet",
  nativeCurrency: { name: "QIE", symbol: "QIE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc1mainnet.qie.digital/"] } },
});

interface Manifest {
  kind: ListingKind;
  name: string;
  description: string;
  currency: Currency;
  price: string;
  category: string;
  tags: string[];
  version: string;
  readme: string;
}

function envFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) out[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return out;
}

function readBundle(dir: string): Bundle {
  const files: Bundle = {};
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(dir, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return files;
}

/** Same allowance as the site's publish (useMarketplace.publishGas). */
function publishGas(textBytes: number): bigint {
  return 900_000n + BigInt(Math.ceil(textBytes / 32)) * 25_000n;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const only = args.filter((a) => !a.startsWith("--"));

  const local = envFile(join(ROOT, ".env.local"));
  const runnerEnv = envFile("/etc/devstation-runner.env");
  const key = process.env.PRIVATE_KEY || local.PRIVATE_KEY;
  const runnerToken = process.env.RUNNER_TOKEN || runnerEnv.RUNNER_TOKEN;
  const runnerUrl = (process.env.RUNNER_URL || "http://127.0.0.1:8792").replace(/\/+$/, "");
  if (!key) throw new Error("PRIVATE_KEY is not set in the environment or .env.local.");
  if (!runnerToken && !dryRun) throw new Error("RUNNER_TOKEN is not set.");

  const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as `0x${string}`);
  const publicClient = createPublicClient({ chain: qieMainnet, transport: http() });
  const wallet = createWalletClient({ account, chain: qieMainnet, transport: http() });
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(`publisher ${account.address}, ${formatUnits(balance, 18)} QIE`);

  // What this wallet already has listed, by content hash.
  const mine = (await publicClient.readContract({
    address: MARKETPLACE,
    abi: devStationMarketplaceAbi,
    functionName: "listingsByCreator",
    args: [account.address],
  })) as readonly bigint[];
  const existing = new Map<string, { id: number; active: boolean }>();
  for (const id of mine) {
    const listing = (await publicClient.readContract({
      address: MARKETPLACE,
      abi: devStationMarketplaceAbi,
      functionName: "getListing",
      args: [id],
    })) as { contentHash: string; active: boolean; hidden: boolean };
    if (!listing.hidden) {
      existing.set(listing.contentHash.toLowerCase(), { id: Number(id), active: listing.active });
    }
  }

  const slugs = readdirSync(PAID)
    .filter((name) => existsSync(join(PAID, name, "manifest.json")))
    .filter((name) => only.length === 0 || only.includes(name))
    .sort();
  const results: Record<string, unknown> = existsSync(join(PAID, "published.json"))
    ? (JSON.parse(readFileSync(join(PAID, "published.json"), "utf8")) as Record<string, unknown>)
    : {};

  for (const slug of slugs) {
    const manifest = JSON.parse(
      readFileSync(join(PAID, slug, "manifest.json"), "utf8"),
    ) as Manifest;
    const files = readBundle(join(PAID, slug, "files"));
    const problem = bundleProblem(files);
    if (problem) throw new Error(`${slug}: ${problem}`);
    const price = parsePrice(manifest.price, manifest.currency);
    if (price === null || price === 0n)
      throw new Error(`${slug}: price "${manifest.price}" is not a paid price.`);
    const contentHash = await bundleHash(files);
    const metadataJson = serializeMetadata({
      category: manifest.category,
      tags: manifest.tags,
      readme: manifest.readme,
      files: Object.keys(files).sort(),
      version: manifest.version,
    });
    const textBytes = new TextEncoder().encode(
      manifest.name + manifest.description + metadataJson,
    ).length;
    const already = existing.get(contentHash.toLowerCase());

    console.log(
      `\n${slug}: ${manifest.kind} "${manifest.name}", ${manifest.price} ${manifest.currency}, ${Object.keys(files).length} files, ${contentHash}`,
    );
    if (dryRun) {
      console.log(
        already
          ? `  already listed as m-${already.id}`
          : `  would publish with gas ${publishGas(textBytes)}`,
      );
      continue;
    }

    let id: number;
    let txHash: string | null = null;
    if (already) {
      id = already.id;
      console.log(`  already listed as m-${id}; not publishing again`);
    } else {
      txHash = await wallet.writeContract({
        address: MARKETPLACE,
        abi: devStationMarketplaceAbi,
        functionName: "publish",
        args: [
          kindCode(manifest.kind),
          currencyCode(manifest.currency),
          modelCode("one-time"),
          price,
          manifest.name,
          manifest.description,
          metadataJson,
          contentHash,
        ],
        gas: publishGas(textBytes),
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: txHash as `0x${string}`,
      });
      if (receipt.status !== "success") throw new Error(`${slug}: publish reverted (${txHash}).`);
      let found: number | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== MARKETPLACE) continue;
        try {
          const event = decodeEventLog({
            abi: devStationMarketplaceAbi,
            data: log.data,
            topics: log.topics,
          });
          if (event.eventName === "ListingPublished")
            found = Number((event.args as { id: bigint }).id);
        } catch {
          // Not a marketplace event.
        }
      }
      if (found === null)
        throw new Error(`${slug}: published in ${txHash}, but no ListingPublished event.`);
      id = found;
      console.log(`  published as m-${id} in ${txHash}`);
    }

    const headers = {
      authorization: `Bearer ${runnerToken}`,
      "content-type": "application/json",
      "x-devstation-owner": account.address,
      "x-devstation-caller": "publish-marketplace",
    };
    const put = await fetch(`${runnerUrl}/listings/${qieMainnet.id}/${id}`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ files }),
    });
    const putBody = (await put.json().catch(() => ({}))) as { ok?: boolean; message?: string };
    if (!put.ok || putBody.ok === false)
      throw new Error(`${slug}: upload refused: ${putBody.message ?? put.status}`);

    const get = await fetch(`${runnerUrl}/listings/${qieMainnet.id}/${id}`, { headers });
    const got = (await get.json().catch(() => ({}))) as { files?: Bundle };
    if (!got.files || (await bundleHash(got.files)).toLowerCase() !== contentHash.toLowerCase()) {
      throw new Error(`${slug}: the stored files do not hash to the listing's content hash.`);
    }
    console.log(`  files stored on the runner and verified against the chain`);
    results[slug] = {
      id,
      listing: `m-${id}`,
      contentHash,
      txHash,
      price: manifest.price,
      currency: manifest.currency,
    };
  }

  if (!dryRun) writeFileSync(join(PAID, "published.json"), `${JSON.stringify(results, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
