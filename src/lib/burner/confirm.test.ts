import { afterEach, describe, expect, it, test } from "bun:test";
import {
  confirmSign,
  consumePreapproval,
  describeRequest,
  isPermitTypedData,
  preapprove,
  setSignConfirmer,
} from "./confirm";

const permit = JSON.stringify({
  primaryType: "Permit",
  domain: { name: "USD Coin", chainId: 1990, verifyingContract: "0xabc" },
  message: {
    spender: "0xevil",
    value: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
  },
});

describe("describeRequest", () => {
  test("a transaction shows destination, value and data size", () => {
    const req = describeRequest(
      "eth_sendTransaction",
      [
        {
          to: "0x00000000000000000000000000000000000000a1",
          value: "0xde0b6b3a7640000",
          data: "0xa9059cbb0000",
        },
      ],
      "QIE Mainnet",
      "preview",
    )!;
    expect(req.kind).toBe("transaction");
    expect(req.rows).toContainEqual(["Value", "1"]);
    expect(req.rows.find(([k]) => k === "Data")![1]).toContain("0xa9059cbb");
  });

  test("personal_sign shows readable text", () => {
    const hex = "0x" + Buffer.from("hello DevStation").toString("hex");
    const req = describeRequest("personal_sign", [hex, "0x1"], "QIE", "app")!;
    expect(req.rows).toContainEqual(["Message", "hello DevStation"]);
  });

  test("a permit is flagged", () => {
    expect(isPermitTypedData(permit)).toBe(true);
    expect(isPermitTypedData(JSON.stringify({ primaryType: "Mail" }))).toBe(false);
    const req = describeRequest("eth_signTypedData_v4", ["0x1", permit], "QIE", "preview")!;
    expect(req.warning).toMatch(/permit/i);
  });

  test("methods that do not sign are not described", () => {
    expect(describeRequest("eth_chainId", [], "QIE", "app")).toBeNull();
  });
});

describe("confirmSign", () => {
  afterEach(() => setSignConfirmer(null));

  test("with no dialog available the answer is no", async () => {
    const req = describeRequest("personal_sign", ["0x68"], "QIE", "app")!;
    expect(await confirmSign(req)).toBe(false);
  });

  test("uses the installed confirmer", async () => {
    setSignConfirmer(async () => true);
    const req = describeRequest("personal_sign", ["0x68"], "QIE", "app")!;
    expect(await confirmSign(req)).toBe(true);
  });
});

describe("preapproval", () => {
  test("approves exactly one identical request, once", () => {
    const params = [{ to: "0xAbC", value: "0x1" }];
    preapprove("eth_sendTransaction", params);
    expect(consumePreapproval("eth_sendTransaction", [{ to: "0xabc", value: "0x2" }])).toBe(false);
    preapprove("eth_sendTransaction", params);
    expect(consumePreapproval("eth_sendTransaction", [{ to: "0xabc", value: "0x1" }])).toBe(true);
    expect(consumePreapproval("eth_sendTransaction", params)).toBe(false);
  });
});

describe("describeRequest edge cases", () => {
  it("describes a network switch with where it goes from and to", () => {
    const req = describeRequest(
      "wallet_switchEthereumChain",
      [{ chainId: "0x7c6" }],
      "QIE Testnet",
      "preview",
    );
    expect(req?.kind).toBe("switchChain");
    expect(req?.rows).toContainEqual(["From", "QIE Testnet"]);
    expect(String(req?.rows.find((r) => r[0] === "To")?.[1])).toContain("QIE");
  });

  it("refuses to describe a transaction whose value is not a number", () => {
    expect(
      describeRequest("eth_sendTransaction", [{ to: "0x00", value: "lots" }], "QIE", "app"),
    ).toBeNull();
  });
});
