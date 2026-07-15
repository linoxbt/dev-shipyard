import { describe, expect, test } from "bun:test";
import { decodeRevertData } from "./decode-abi";

function panicData(code: number): `0x${string}` {
  return `0x4e487b71${code.toString(16).padStart(64, "0")}`;
}

describe("decodeRevertData", () => {
  test("decodes known Panic(uint256) codes without needing the contract's ABI", () => {
    expect(decodeRevertData(panicData(0x11))).toBe("Arithmetic overflow or underflow");
    expect(decodeRevertData(panicData(0x12))).toBe("Division or modulo by zero");
    expect(decodeRevertData(panicData(0x32))).toBe("Array index out of bounds");
    expect(decodeRevertData(panicData(0x01))).toBe("Assertion failed");
  });

  test("labels an unrecognized panic code instead of guessing", () => {
    expect(decodeRevertData(panicData(0x99))).toBe("Panic (unrecognized code 0x99)");
  });

  test("returns undefined for empty, short, or unrecognized revert data", () => {
    expect(decodeRevertData(undefined)).toBeUndefined();
    expect(decodeRevertData("0x")).toBeUndefined();
    expect(decodeRevertData("0xdeadbeef")).toBeUndefined();
  });
});
