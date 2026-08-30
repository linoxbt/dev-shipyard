import { describe, expect, it } from "bun:test";
import { publishGasFor } from "./useTemplateRegistry";

// QIE's eth_estimateGas returns ~24k for storage-writing calls that need far
// more (observed live: a publish estimated at 24,924 ran out of gas and stored
// nothing). Every write therefore carries an explicit limit.
describe("publishGasFor", () => {
  it("always clears the observed bad estimate by a wide margin", () => {
    for (const bytes of [0, 100, 2_000, 6_000]) {
      expect(publishGasFor(bytes)).toBeGreaterThan(24_924n * 10n);
    }
  });

  it("covers the 20k-per-word storage floor for a large template", () => {
    // The largest built-in template is ~5.6 KB.
    const bytes = 5_600;
    const floor = BigInt(Math.ceil(bytes / 32)) * 20_000n;
    expect(publishGasFor(bytes)).toBeGreaterThan(floor);
  });

  it("scales with source size", () => {
    expect(publishGasFor(4_000)).toBeGreaterThan(publishGasFor(400));
  });
});
