import { describe, expect, it } from "bun:test";
import { TEMPLATES, getTemplate } from "@/lib/data/templates";
import { PAID_BUILTINS, paidListingFor } from "./paid";

// A template that is sold must not also be given away: not in the free list,
// not in the client bundle's template data, not deployable by id.
describe("paid built-in templates", () => {
  it("are gone from the free built-in set", () => {
    for (const id of Object.keys(PAID_BUILTINS)) {
      expect(getTemplate(id)).toBeUndefined();
      expect(TEMPLATES.some((t) => t.id === id)).toBe(false);
    }
    const sources = TEMPLATES.map((t) => t.solidity).join("\n");
    expect(sources).not.toContain("contract StablecoinInvoices");
    expect(sources).not.toContain("contract TokenVesting");
  });

  it("send old links to their marketplace listing", () => {
    expect(paidListingFor("stablecoin-invoices")).toBe("m-1");
    expect(paidListingFor("token-vesting")).toBe("m-2");
    expect(paidListingFor("simple-erc20")).toBeNull();
    expect(paidListingFor(undefined)).toBeNull();
  });
});
