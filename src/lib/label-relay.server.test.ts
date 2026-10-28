import { afterEach, describe, expect, it } from "bun:test";
import {
  RELAY_WINDOW_SECONDS,
  isRelayConfigured,
  relayAutoLabel,
  reservedName,
  type Creation,
  type ExistingLabel,
} from "./label-relay.server";
import { qieMainnet } from "@/lib/chains";

const OWNER = "0x00000000000000000000000000000000000000aa";
const OTHER = "0x00000000000000000000000000000000000000cc";
const TARGET = "0x00000000000000000000000000000000000000bb" as const;
const KEY = `0x${"42".repeat(32)}`;
const NOW = 1_800_000_000_000;

afterEach(() => {
  delete process.env.AUTOLABELER_PRIVATE_KEY;
});

const input = (
  creation: Creation | null,
  opts: { name?: string; existing?: ExistingLabel | null } = {},
) => ({
  chainId: qieMainnet.id,
  owner: OWNER,
  contractAddress: TARGET,
  name: opts.name ?? "My Token",
  category: "token",
  description: "",
  creationOf: async () => creation,
  existingLabel: async () => opts.existing ?? null,
  now: () => NOW,
});

const fresh = (from = OWNER): Creation => ({ from, timestamp: NOW / 1000 - 60 });

describe("relayAutoLabel", () => {
  it("is off without a key, so the app falls back to a community label", async () => {
    expect(isRelayConfigured(qieMainnet.id)).toBe(false);
    const r = await relayAutoLabel(input(fresh()));
    expect(r).toMatchObject({ ok: false, reason: "not_configured", status: 501 });
  });

  it("refuses to label a contract this wallet did not create", async () => {
    process.env.AUTOLABELER_PRIVATE_KEY = KEY;
    const r = await relayAutoLabel(input(fresh(OTHER)));
    expect(r).toMatchObject({ ok: false, reason: "not_creator", status: 403 });
  });

  it("waits for the chain rather than trusting a claim it cannot check", async () => {
    process.env.AUTOLABELER_PRIVATE_KEY = KEY;
    const r = await relayAutoLabel(input(null));
    expect(r).toMatchObject({ ok: false, reason: "unknown_contract", status: 409 });
  });

  it("only labels contracts created in the last day", async () => {
    process.env.AUTOLABELER_PRIVATE_KEY = KEY;
    const old = { from: OWNER, timestamp: NOW / 1000 - RELAY_WINDOW_SECONDS - 1 };
    const r = await relayAutoLabel(input(old));
    expect(r).toMatchObject({ ok: false, reason: "not_recent", status: 409 });
  });

  it("refuses reserved names before touching the chain", async () => {
    process.env.AUTOLABELER_PRIVATE_KEY = KEY;
    let asked = false;
    const r = await relayAutoLabel({
      ...input(fresh(), { name: "U.S.D.C" }),
      creationOf: async () => {
        asked = true;
        return fresh();
      },
    });
    expect(r).toMatchObject({ ok: false, reason: "reserved_name", status: 409 });
    expect(asked).toBe(false);
  });

  it("labels a contract once, and never over another wallet's label", async () => {
    process.env.AUTOLABELER_PRIVATE_KEY = KEY;
    const auto = await relayAutoLabel(
      input(fresh(), { existing: { name: "X", submitter: OTHER, autoLabeled: true } }),
    );
    expect(auto).toMatchObject({ ok: false, reason: "already_labelled" });
    const squat = await relayAutoLabel(
      input(fresh(), { existing: { name: "X", submitter: OTHER, autoLabeled: false } }),
    );
    expect(squat).toMatchObject({ ok: false, reason: "labelled_by_someone_else" });
  });

  it("ignores a key that is not a private key", async () => {
    process.env.AUTOLABELER_PRIVATE_KEY = "not-a-key";
    expect(isRelayConfigured(qieMainnet.id)).toBe(false);
  });
});

describe("reservedName", () => {
  it("catches look-alikes of well-known names and official claims", () => {
    for (const n of [
      "USDC",
      "usdt",
      "W-QIE",
      "Official Airdrop",
      "DevStation Rewards",
      "Uniswap V2",
    ])
      expect(reservedName(n)).toBe(true);
  });
  it("leaves ordinary project names alone", () => {
    for (const n of ["My Token", "USDC Vault Helper", "Ethan's NFT", "Bridgewater"])
      expect(reservedName(n)).toBe(false);
  });
});
