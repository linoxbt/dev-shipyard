import { describe, expect, it } from "bun:test";
import { explorerPathAllowed } from "./explorer.functions";

describe("explorerPathAllowed", () => {
  it("allows the Blockscout namespaces the explorer uses", () => {
    expect(explorerPathAllowed("/stats")).toBe(true);
    expect(explorerPathAllowed("/blocks?type=block")).toBe(true);
    expect(explorerPathAllowed("/addresses/0xabc/transactions")).toBe(true);
    expect(explorerPathAllowed("/search?q=foo..bar")).toBe(true);
  });

  it("refuses literal and percent-encoded dot segments", () => {
    expect(explorerPathAllowed("/blocks/../../admin")).toBe(false);
    expect(explorerPathAllowed("/blocks/%2e%2e/%2E%2e/%2e%2e/admin")).toBe(false);
    expect(explorerPathAllowed("/blocks/.%2e/x")).toBe(false);
    expect(explorerPathAllowed("/blocks/./x")).toBe(false);
  });

  it("refuses other namespaces and host tricks", () => {
    expect(explorerPathAllowed("/admin")).toBe(false);
    expect(explorerPathAllowed("//evil.example/stats")).toBe(false);
    expect(explorerPathAllowed("/stats\\..\\x")).toBe(false);
    expect(explorerPathAllowed("stats")).toBe(false);
  });
});
