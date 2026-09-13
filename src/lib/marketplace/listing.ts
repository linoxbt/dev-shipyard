import { formatUnits, parseUnits } from "viem";
import { z } from "zod";

// The vocabulary of the marketplace, shared by every page and by the hook
// that talks to DevStationMarketplace. The numeric codes mirror the contract's
// constants exactly; nothing else in the app should know them.

export type ListingKind = "template" | "app" | "skill" | "ui-kit";
export type Currency = "QIE" | "QUSDC";
export type PricingModel = "one-time" | "per-deploy";

export const KINDS: ReadonlyArray<{
  kind: ListingKind;
  code: number;
  label: string;
  singular: string;
  blurb: string;
}> = [
  {
    kind: "template",
    code: 0,
    label: "Contracts",
    singular: "Contract template",
    blurb: "Solidity you configure and deploy.",
  },
  {
    kind: "app",
    code: 1,
    label: "Apps",
    singular: "App",
    blurb: "A whole dApp, cloned into your App Builder.",
  },
  {
    kind: "skill",
    code: 2,
    label: "Skills",
    singular: "Agent skill",
    blurb: "Instructions for the Coding Agent and the CLI.",
  },
  {
    kind: "ui-kit",
    code: 3,
    label: "UI Kits",
    singular: "UI kit",
    blurb: "Frontend components ready to drop in.",
  },
];

export function kindFromCode(code: number): ListingKind {
  return KINDS.find((k) => k.code === code)?.kind ?? "template";
}

export function kindCode(kind: ListingKind): number {
  return KINDS.find((k) => k.kind === kind)?.code ?? 0;
}

export function kindInfo(kind: ListingKind) {
  return KINDS.find((k) => k.kind === kind) ?? KINDS[0];
}

export const CURRENCIES: ReadonlyArray<{ currency: Currency; code: number; decimals: number }> = [
  { currency: "QIE", code: 0, decimals: 18 },
  // QUSDC has 6 decimals, not 18: verified against mainnet.
  { currency: "QUSDC", code: 1, decimals: 6 },
];

export function currencyFromCode(code: number): Currency {
  return code === 1 ? "QUSDC" : "QIE";
}

export function currencyCode(currency: Currency): number {
  return currency === "QUSDC" ? 1 : 0;
}

export function decimalsOf(currency: Currency): number {
  return currency === "QUSDC" ? 6 : 18;
}

export function modelFromCode(code: number): PricingModel {
  return code === 1 ? "per-deploy" : "one-time";
}

export function modelCode(model: PricingModel): number {
  return model === "per-deploy" ? 1 : 0;
}

/** Mirrors PROTOCOL_FEE_BPS in the contract. */
export const FEE_BPS = 500n;
const BPS = 10_000n;
const UINT96_MAX = (1n << 96n) - 1n;

/** How a sale divides, computed the way the contract computes it: the fee
 *  rounds down, so the creator never receives less than the contract pays. */
export function splitSale(amount: bigint): { fee: bigint; creator: bigint } {
  const fee = (amount * FEE_BPS) / BPS;
  return { fee, creator: amount - fee };
}

/** A price typed by a person, in whole units, as the contract's integer.
 *  Null when it is not a number, has too many decimals, or overflows uint96. */
export function parsePrice(input: string, currency: Currency): bigint | null {
  const text = input.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const decimals = decimalsOf(currency);
  const fraction = text.split(".")[1] ?? "";
  if (fraction.length > decimals) return null;
  const value = parseUnits(text, decimals);
  return value > UINT96_MAX ? null : value;
}

/** "Free", or the amount with its currency and no trailing zeros. */
export function formatPrice(amount: bigint, currency: Currency): string {
  if (amount === 0n) return "Free";
  return `${formatAmount(amount, currency)} ${currency}`;
}

export function formatAmount(amount: bigint, currency: Currency): string {
  const text = formatUnits(amount, decimalsOf(currency));
  const [whole, fraction = ""] = text.split(".");
  // At most 4 decimals on screen; exact amounts live in the transaction.
  const trimmed = fraction.slice(0, 4).replace(/0+$/, "");
  return trimmed
    ? `${Number(whole).toLocaleString("en-US")}.${trimmed}`
    : Number(whole).toLocaleString("en-US");
}

// --- ids --------------------------------------------------------------------
//
// One detail page serves three sources, so an id says which it came from:
// b-<slug>  a built-in template that ships with DevStation
// t-<n>     a listing in the older TemplateRegistry (source on-chain)
// m-<n>     a listing in DevStationMarketplace

export type ListingSource = "builtin" | "legacy" | "market";

export function listingId(source: ListingSource, key: string | number): string {
  const prefix = source === "builtin" ? "b" : source === "legacy" ? "t" : "m";
  return `${prefix}-${key}`;
}

export function parseListingId(
  id: string,
): { source: "builtin"; key: string } | { source: "legacy" | "market"; key: number } | null {
  const match = /^([btm])-(.+)$/.exec(id);
  if (!match) return null;
  const [, prefix, key] = match;
  if (prefix === "b") return /^[a-z0-9-]{1,80}$/.test(key) ? { source: "builtin", key } : null;
  if (!/^\d{1,9}$/.test(key)) return null;
  return { source: prefix === "t" ? "legacy" : "market", key: Number(key) };
}

// --- metadata ---------------------------------------------------------------

export const MAX_METADATA_BYTES = 4000;

const metadataSchema = z.object({
  category: z.string().max(40).optional(),
  tags: z.array(z.string().max(24)).max(8).optional(),
  /** Shown before purchase: what the listing is and does. */
  readme: z.string().max(2500).optional(),
  /** File paths, shown before purchase so a buyer sees what they get. */
  files: z.array(z.string().max(200)).max(60).optional(),
  /** http(s) only: `javascript:` is a valid URL too, and this ends up in an href. */
  demoUrl: z
    .string()
    .max(200)
    .regex(/^https?:\/\/[^\s]+$/i, "Must be an http(s) link")
    .optional(),
  version: z.string().max(20).optional(),
});

export type ListingMetadata = z.infer<typeof metadataSchema>;

/** Metadata is written by the creator and read from chain: anything that does
 *  not parse is shown as nothing rather than breaking the page. */
export function parseMetadata(json: string): ListingMetadata {
  try {
    const parsed = metadataSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Serialises metadata for the contract, dropping the file list and then
 *  shortening the readme until it fits the contract's 4000-byte limit. */
export function serializeMetadata(meta: ListingMetadata): string {
  const clean = metadataSchema.parse(meta);
  const size = (value: ListingMetadata) => new TextEncoder().encode(JSON.stringify(value)).length;
  let out: ListingMetadata = { ...clean };
  if (size(out) > MAX_METADATA_BYTES && out.files) out = { ...out, files: out.files.slice(0, 20) };
  while (size(out) > MAX_METADATA_BYTES && out.readme && out.readme.length > 0) {
    out = { ...out, readme: out.readme.slice(0, Math.floor(out.readme.length * 0.8)) };
  }
  return JSON.stringify(out);
}
