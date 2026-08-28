import { describe, expect, it } from "bun:test";
import { looksLikeAbi, fromPasted } from "./abi-source";

const ADDR = "0x31423638af5b8d2a9096b6ab58c62f07844bc461";
const REAL_ABI = [
  { type: "constructor", inputs: [{ name: "gateToken_", type: "address" }] },
  {
    type: "function",
    name: "holdsQieId",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ type: "bool" }],
  },
];

describe("looksLikeAbi", () => {
  it("accepts a real ABI", () => {
    expect(looksLikeAbi(REAL_ABI)).toBe(true);
  });

  it("rejects the shapes people actually paste by mistake", () => {
    expect(looksLikeAbi([])).toBe(false);
    expect(looksLikeAbi({})).toBe(false);
    expect(looksLikeAbi(null)).toBe(false);
    expect(looksLikeAbi("[]")).toBe(false);
    expect(looksLikeAbi([{ name: "noType" }])).toBe(false);
    expect(looksLikeAbi([1, 2, 3])).toBe(false);
  });
});

describe("fromPasted", () => {
  it("accepts a bare ABI array", () => {
    const r = fromPasted(ADDR, 1990, JSON.stringify(REAL_ABI));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.abi).toHaveLength(2);
      expect(r.value.source).toBe("pasted");
      expect(r.value.verified).toBe(false);
    }
  });

  it("accepts a full artifact object, since that is what people copy", () => {
    // Hardhat/Foundry artifacts are the usual clipboard content.
    const r = fromPasted(
      ADDR,
      1990,
      JSON.stringify({ contractName: "X", abi: REAL_ABI, bytecode: "0x" }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.abi).toHaveLength(2);
  });

  it("explains bad JSON rather than throwing", () => {
    const r = fromPasted(ADDR, 1990, "{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("not valid JSON");
  });

  it("rejects JSON that is valid but is not an ABI", () => {
    const r = fromPasted(ADDR, 1990, JSON.stringify({ hello: "world" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("does not look like an ABI");
  });

  it("validates the address", () => {
    const r = fromPasted("not-an-address", 1990, JSON.stringify(REAL_ABI));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("valid address");
  });
});
