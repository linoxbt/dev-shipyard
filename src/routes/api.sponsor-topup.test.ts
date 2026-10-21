import { afterEach, describe, expect, it } from "bun:test";
import { parseEther } from "viem";
import { maxTopupWei, serialised } from "./api.sponsor-topup";

afterEach(() => {
  delete process.env.SPONSOR_MAX_TOPUP_NATIVE;
});

describe("maxTopupWei", () => {
  it("defaults, reads the env, and ignores nonsense", () => {
    expect(maxTopupWei()).toBe(parseEther("0.3"));
    process.env.SPONSOR_MAX_TOPUP_NATIVE = "0.01";
    expect(maxTopupWei()).toBe(parseEther("0.01"));
    process.env.SPONSOR_MAX_TOPUP_NATIVE = "lots";
    expect(maxTopupWei()).toBe(parseEther("0.3"));
  });
});

describe("serialised", () => {
  it("runs one send at a time per chain, even when one fails", async () => {
    const order: string[] = [];
    const slow =
      (tag: string, ms: number, fail = false) =>
      async () => {
        order.push(`start ${tag}`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`end ${tag}`);
        if (fail) throw new Error(tag);
        return tag;
      };
    const a = serialised(1, slow("a", 20, true));
    const b = serialised(1, slow("b", 1));
    await expect(a).rejects.toThrow("a");
    expect(await b).toBe("b");
    expect(order).toEqual(["start a", "end a", "start b", "end b"]);
  });
});
