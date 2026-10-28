import { describe, expect, it } from "bun:test";
import { paymentCall } from "./useMarketplace";
import { devStationMarketplaceV2Abi } from "@/lib/abis/devStationMarketplaceV2";

describe("paymentCall", () => {
  it("keeps v1 calls as they are", () => {
    expect(paymentCall(1, "buy", [3n], 5n)).toEqual({ v2: false, functionName: "buy", args: [3n] });
  });

  it("uses v2's price-protected variants, which exist in the v2 ABI", () => {
    for (const [fn, args] of [
      ["buy", [3n]],
      ["recordDeploy", [3n]],
      ["feature", [3n, 7n]],
    ] as const) {
      const call = paymentCall(2, fn, args, 5n);
      expect(call.v2).toBe(true);
      expect(call.args).toEqual([...args, 5n]);
      const entry = devStationMarketplaceV2Abi.find(
        (e) => e.type === "function" && e.name === call.functionName,
      ) as { inputs: unknown[] } | undefined;
      expect(entry?.inputs.length).toBe(call.args.length);
    }
  });

  it("tips stay as they are on v2: there is no price to protect", () => {
    expect(paymentCall(2, "tip", [3n, 5n], 5n).functionName).toBe("tip");
  });
});
