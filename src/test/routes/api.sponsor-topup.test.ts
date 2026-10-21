import { afterEach, describe, expect, it } from "bun:test";
import { parseEther } from "viem";
import { maxTopupWei, serialised } from "@/routes/api.sponsor-topup";

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

describe("POST /api/sponsor-topup", () => {
  type Handler = (ctx: { request: Request }) => Promise<Response> | Response;

  it("refuses a correctly signed request that carries no wallet grant", async () => {
    const { Route } = await import("@/routes/api.sponsor-topup");
    const { privateKeyToAccount } = await import("viem/accounts");
    const { topupMessage } = await import("@/lib/sponsor/request-auth");
    const handlers = (Route.options as unknown as { server: { handlers: Record<string, Handler> } })
      .server.handlers;
    const account = privateKeyToAccount(`0x${"22".repeat(32)}`);
    const issuedAt = Date.now();
    const chainId = 1990;
    const signature = await account.signMessage({
      message: topupMessage({ address: account.address, chainId, issuedAt }),
    });
    const res = await handlers.POST({
      request: new Request("https://devstation.online/api/sponsor-topup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId,
          requesterAddress: account.address,
          abi: [{ type: "constructor", inputs: [] }],
          bytecode: "0x00",
          args: [],
          signature,
          issuedAt,
        }),
      }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { reason: string }).reason).toBe("no_grant");
  });
});
