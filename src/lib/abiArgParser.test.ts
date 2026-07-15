import { describe, expect, test } from "bun:test";
import { parseArg, parseArgs } from "./abiArgParser";

describe("parseArg", () => {
  test("scalar uint/int/address/bool/bytes", () => {
    expect(parseArg("42", "uint256")).toBe(42n);
    expect(parseArg("-5", "int128")).toBe(-5n);
    expect(parseArg("", "uint256")).toBe(0n);
    expect(parseArg("0xabc", "address")).toBe("0xabc");
    expect(parseArg("true", "bool")).toBe(true);
    expect(parseArg("false", "bool")).toBe(false);
    expect(parseArg("0x1234", "bytes")).toBe("0x1234");
    expect(parseArg("0x1234", "bytes4")).toBe("0x1234");
  });

  // Regression test: "uint256[]" and "int128[]" both start with "uint"/"int",
  // so a naive `type.startsWith("uint")` check (checked before the array
  // case) would route array input straight into BigInt(v) and throw. The
  // array branch must be checked first.
  test("numeric arrays are NOT coerced via BigInt(wholeString)", () => {
    expect(parseArg("[1,2,3]", "uint256[]")).toEqual([1n, 2n, 3n]);
    expect(parseArg("1,2,3", "uint256[]")).toEqual([1n, 2n, 3n]);
    expect(parseArg("[10,-20]", "int64[]")).toEqual([10n, -20n]);
    expect(parseArg("", "uint256[]")).toEqual([]);
  });

  test("address arrays", () => {
    expect(parseArg('["0xaaa","0xbbb"]', "address[]")).toEqual(["0xaaa", "0xbbb"]);
    expect(parseArg("0xaaa,0xbbb", "address[]")).toEqual(["0xaaa", "0xbbb"]);
  });

  test("bytes32 encodes a short string, passes through an existing hex value", () => {
    expect(parseArg("0xdead", "bytes32")).toBe("0xdead");
    const encoded = parseArg("hi", "bytes32") as string;
    expect(encoded.startsWith("0x")).toBe(true);
    expect(encoded.length).toBe(66); // 0x + 64 hex chars
  });

  test("falls back to the raw string for unrecognized types", () => {
    expect(parseArg("hello", "string")).toBe("hello");
  });
});

describe("parseArgs", () => {
  test("maps positional inputs in order, using arg{i} for unnamed params", () => {
    const inputs = [
      { name: "to", type: "address" },
      { name: "", type: "uint256" },
    ];
    const result = parseArgs(inputs, { to: "0xabc", arg1: "5" });
    expect(result).toEqual(["0xabc", 5n]);
  });
});
