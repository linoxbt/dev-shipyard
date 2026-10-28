import { afterEach, describe, expect, it } from "bun:test";
import { isRelayConfigured, relayAutoLabel } from "./label-relay.server";
import { qieMainnet } from "@/lib/chains";

const OWNER = "0x00000000000000000000000000000000000000aa";
const TARGET = "0x00000000000000000000000000000000000000bb" as const;
const KEY = `0x${"42".repeat(32)}`;

afterEach(() => {
  delete process.env.AUTOLABELER_PRIVATE_KEY;
});

const input = (creator: string | null) => ({
  chainId: qieMainnet.id,
  owner: OWNER,
  contractAddress: TARGET,
  name: "My Token",
  category: "token",
  description: "",
  creatorOf: async () => creator,
});

describe("relayAutoLabel", () => {
  it("is off without a key, so the app falls back to a community label", async () => {
    expect(isRelayConfigured(qieMainnet.id)).toBe(false);
    const r = await relayAutoLabel(input(OWNER));
    expect(r).toMatchObject({ ok: false, reason: "not_configured", status: 501 });
  });

  it("refuses to label a contract this wallet did not create", async () => {
    process.env.AUTOLABELER_PRIVATE_KEY = KEY;
    const r = await relayAutoLabel(input("0x00000000000000000000000000000000000000cc"));
    expect(r).toMatchObject({ ok: false, reason: "not_creator", status: 403 });
  });

  it("waits for the explorer rather than trusting a claim it cannot check", async () => {
    process.env.AUTOLABELER_PRIVATE_KEY = KEY;
    const r = await relayAutoLabel(input(null));
    expect(r).toMatchObject({ ok: false, reason: "unknown_contract", status: 409 });
  });

  it("ignores a key that is not a private key", async () => {
    process.env.AUTOLABELER_PRIVATE_KEY = "not-a-key";
    expect(isRelayConfigured(qieMainnet.id)).toBe(false);
  });
});
