import { afterEach, describe, expect, it } from "bun:test";
import { getSponsorSpendLast24hWei } from "./spend.server";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

const SPONSOR = "0x00000000000000000000000000000000000000bb" as const;

describe("getSponsorSpendLast24hWei", () => {
  it("fails closed when the explorer answers with an error instead of a list", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        status: "0",
        message: "NOTOK",
        result: "Max rate limit reached",
      })) as unknown as typeof fetch;
    await expect(getSponsorSpendLast24hWei(1990, SPONSOR)).rejects.toThrow(/not a list/);
  });

  it("sums value and gas of recent sends", async () => {
    const now = Math.floor(Date.now() / 1000);
    globalThis.fetch = (async () =>
      Response.json({
        result: [
          { from: SPONSOR, timeStamp: String(now), value: "100", gasUsed: "2", gasPrice: "5" },
          {
            from: SPONSOR,
            timeStamp: String(now - 90_000),
            value: "999",
            gasUsed: "0",
            gasPrice: "0",
          },
        ],
      })) as unknown as typeof fetch;
    expect(await getSponsorSpendLast24hWei(1990, SPONSOR)).toBe(110n);
  });
});
