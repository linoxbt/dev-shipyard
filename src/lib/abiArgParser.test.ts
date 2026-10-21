import { describe, expect, test } from "bun:test";
import { argKey, parseArg, parseArgs } from "./abiArgParser";

const A1 = "0x00000000000000000000000000000000000000a1";
const A2 = "0x00000000000000000000000000000000000000b2";

describe("parseArg", () => {
  test("scalar uint/int/address/bool/bytes", () => {
    expect(parseArg("42", "uint256")).toBe(42n);
    expect(parseArg("-5", "int128")).toBe(-5n);
    expect(parseArg(A1, "address")).toBe(A1);
    expect(parseArg("true", "bool")).toBe(true);
    expect(parseArg("false", "bool")).toBe(false);
    expect(parseArg("0x1234", "bytes")).toBe("0x1234");
    expect(parseArg("0x12345678", "bytes4")).toBe("0x12345678");
  });

  test("an empty or fractional integer is an error, not 0", () => {
    expect(() => parseArg("", "uint256", undefined, "supply")).toThrow(/supply.*required/);
    expect(() => parseArg("1.5", "uint256")).toThrow(/whole number/);
    expect(() => parseArg("-1", "uint8")).toThrow(/negative/);
    expect(() => parseArg("256", "uint8")).toThrow(/out of range/);
    expect(() => parseArg("-129", "int8")).toThrow(/out of range/);
  });

  test("bool accepts any case and 1/0, and rejects anything else", () => {
    expect(parseArg("TRUE", "bool")).toBe(true);
    expect(parseArg("1", "bool")).toBe(true);
    expect(parseArg("False", "bool")).toBe(false);
    expect(parseArg("0", "bool")).toBe(false);
    expect(() => parseArg("yes", "bool")).toThrow(/true or false/);
    expect(() => parseArg("", "bool", undefined, "paused")).toThrow(/paused.*required/);
  });

  test("addresses must be well formed", () => {
    expect(() => parseArg("0xabc", "address")).toThrow(/40 hex/);
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
    expect(parseArg(`["${A1}","${A2}"]`, "address[]")).toEqual([A1, A2]);
    expect(parseArg(`${A1},${A2}`, "address[]")).toEqual([A1, A2]);
  });

  test("fixed-size arrays check their length", () => {
    expect(parseArg("[1,2]", "uint256[2]")).toEqual([1n, 2n]);
    expect(() => parseArg("[1]", "uint256[2]")).toThrow(/exactly 2/);
    expect(parseArg("[[1,2],[3,4]]", "uint8[2][]")).toEqual([
      [1n, 2n],
      [3n, 4n],
    ]);
  });

  test("tuples from a JSON array or a named object", () => {
    const components = [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ];
    expect(parseArg(`["${A1}", "7"]`, "tuple", components)).toEqual([A1, 7n]);
    expect(parseArg(`{"to":"${A1}","amount":7}`, "tuple", components)).toEqual({
      to: A1,
      amount: 7n,
    });
    expect(() => parseArg(`["${A1}"]`, "tuple", components)).toThrow(/2 fields/);
    expect(parseArg(`[["${A1}", "1"],["${A2}", "2"]]`, "tuple[]", components)).toEqual([
      [A1, 1n],
      [A2, 2n],
    ]);
  });

  test("bytes32 encodes a short string, pads hex, and refuses anything too long", () => {
    expect(parseArg("0xdead", "bytes32")).toBe("0xdead" + "0".repeat(60));
    const encoded = parseArg("hi", "bytes32") as string;
    expect(encoded.startsWith("0x6869")).toBe(true);
    expect(encoded.length).toBe(66); // 0x + 64 hex chars
    expect(() => parseArg("x".repeat(33), "bytes32")).toThrow(/at most 32/);
    expect(() => parseArg("0x" + "ab".repeat(33), "bytes32")).toThrow(/at most 32/);
  });

  test("dynamic bytes must be even-length hex", () => {
    expect(() => parseArg("0x123", "bytes")).toThrow(/even/);
    expect(() => parseArg("hello", "bytes")).toThrow(/hex/);
  });

  test("falls back to the raw string for unrecognized types", () => {
    expect(parseArg("hello", "string")).toBe("hello");
  });
});

describe("exact numbers inside JSON", () => {
  test("array and tuple elements above 2^53 are not rounded", () => {
    expect(parseArg("[1234567890123456789, 2]", "uint256[]")).toEqual([1234567890123456789n, 2n]);
    expect(parseArg("[9007199254740993]", "uint256[1]")).toEqual([9007199254740993n]);
    const comps = [
      { name: "amount", type: "uint256" },
      { name: "to", type: "address" },
    ];
    expect(
      parseArg(
        `[115792089237316195423570985008687907853269984665640564039457584007913129639935, "${A1}"]`,
        "tuple",
        comps,
      ),
    ).toEqual([(1n << 256n) - 1n, A1]);
    expect(parseArg(`{"amount": 10000000000000000001, "to": "${A1}"}`, "tuple", comps)).toEqual({
      amount: 10000000000000000001n,
      to: A1,
    });
  });

  test("numbers inside strings and fractional elements keep their meaning", () => {
    expect(parseArg('["12", 3]', "uint256[]")).toEqual([12n, 3n]);
    expect(parseArg('["a,1"]', "string[]")).toEqual(["a,1"]);
    expect(() => parseArg("[1.5]", "uint256[]")).toThrow(/whole number/);
  });

  test("a mixed-case address with a wrong checksum is refused", () => {
    const good = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
    expect(parseArg(good, "address")).toBe(good);
    expect(() => parseArg("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAeD", "address")).toThrow(
      /checksum/,
    );
  });
});

describe("parseArgs", () => {
  test("maps positional inputs in order, using arg{i} for unnamed params", () => {
    const inputs = [
      { name: "to", type: "address" },
      { name: "", type: "uint256" },
    ];
    const result = parseArgs(inputs, { to: A1, arg1: "5" });
    expect(result).toEqual([A1, 5n]);
    expect(argKey(inputs[1], 1)).toBe("arg1");
  });
});
