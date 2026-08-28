import { describe, expect, it } from "bun:test";
import { DEFAULT_EVM_VERSION, DEFAULT_SOLC_VERSION, SOLC_VERSIONS } from "./compiler";

describe("compiler defaults", () => {
  it("pins evmVersion to shanghai", () => {
    // This is load-bearing, not cosmetic. QIE's EVM has no MCOPY (0x5e), and
    // solc >= 0.8.25 emits it by default for things like a struct-with-string
    // return. Shipped templates DO contain that pattern — StablecoinInvoices
    // compiles to MCOPY-containing bytecode at solc's default evmVersion — so
    // changing this silently produces contracts whose views revert on QIE.
    // If this test fails, do not "fix" it by updating the expectation.
    expect(DEFAULT_EVM_VERSION).toBe("shanghai");
  });

  it("offers a solc version list with the default present", () => {
    expect(SOLC_VERSIONS).toContain(DEFAULT_SOLC_VERSION);
    expect(SOLC_VERSIONS.length).toBeGreaterThan(0);
  });

  it("keeps the version list newest-first", () => {
    const parse = (v: string) => v.split(".").map(Number);
    for (let i = 1; i < SOLC_VERSIONS.length; i++) {
      const [aMaj, aMin, aPat] = parse(SOLC_VERSIONS[i - 1]);
      const [bMaj, bMin, bPat] = parse(SOLC_VERSIONS[i]);
      const newer =
        aMaj > bMaj || (aMaj === bMaj && (aMin > bMin || (aMin === bMin && aPat > bPat)));
      expect(`${SOLC_VERSIONS[i - 1]} > ${SOLC_VERSIONS[i]}: ${newer}`).toBe(
        `${SOLC_VERSIONS[i - 1]} > ${SOLC_VERSIONS[i]}: true`,
      );
    }
  });
});
