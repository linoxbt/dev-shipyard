import { describe, expect, it } from "bun:test";
import {
  decodeRegistrationStrings,
  formatWalletAge,
  isPlausibleLabel,
  labelsFromStrings,
  matchNamesToTokens,
  registrationIsFree,
} from "./identity";

// The real calldata from registration tx 0x3e3c4496…fe12 on QIE mainnet,
// reduced to its string-bearing words. Decoding this correctly is the whole
// basis for showing a name, so it is tested against the actual bytes.
const word = (s: string) => Buffer.from(s, "utf8").toString("hex").padEnd(64, "0");
const num = (n: number) => n.toString(16).padStart(64, "0");
const realish =
  "0xbc96db3f" + num(3) + word("qie") + num(9) + word("oepeo3512") + num(3) + word("qie");

describe("decodeRegistrationStrings", () => {
  it("recovers the strings from real registration calldata", () => {
    expect(decodeRegistrationStrings(realish)).toEqual(["qie", "oepeo3512", "qie"]);
  });

  it("ignores numeric words rather than reading them as text", () => {
    expect(decodeRegistrationStrings("0xbc96db3f" + num(256) + num(1))).toEqual([]);
  });

  it("survives empty or malformed input", () => {
    expect(decodeRegistrationStrings("")).toEqual([]);
    expect(decodeRegistrationStrings("0x")).toEqual([]);
  });
});

describe("registrationIsFree", () => {
  // The calldata of two real QIE Mainnet registrations, word for word:
  //   0xbaa0b904…2bd3  ykhli97464.qie  handed out by QIE's backend, isFree true
  //   0x28672d93…0b22  qieidui.qie     registered,                  isFree false
  const registration = (free: number, owner: string, label: string) =>
    "0xbc96db3f" +
    num(0x40) +
    num(free) +
    owner.padStart(64, "0") +
    num(0x80) +
    num(0xc0) +
    num(0x100) +
    num(3) +
    word("qie") +
    num(label.length) +
    word(label) +
    num(3) +
    word("qie");
  const handedOut = registration(1, "8d4f87fcf811df24ca33bf4b68b3bbe4eee91e88", "ykhli97464");
  const registered = registration(0, "4c52da0c72865d6ab21f16ff1a8ee9cbcb754681", "qieidui");

  it("tells a free name QIE handed out from one somebody registered", () => {
    expect(registrationIsFree(handedOut)).toBe(true);
    expect(registrationIsFree(registered)).toBe(false);
    // The label still decodes either way; whether to show it is the caller's call.
    expect(labelsFromStrings(decodeRegistrationStrings(handedOut))).toEqual(["ykhli97464"]);
  });

  it("does not guess about calldata that is not that call", () => {
    expect(registrationIsFree("")).toBeNull();
    expect(registrationIsFree("0xa9059cbb" + num(0x40) + num(1))).toBeNull();
    expect(registrationIsFree("0xbc96db3f" + num(0x40))).toBeNull();
    expect(registrationIsFree("0xbc96db3f" + num(0x40) + num(7))).toBeNull();
  });
});

describe("labelsFromStrings", () => {
  it("drops the TLD that brackets every label", () => {
    expect(labelsFromStrings(["qie", "oepeo3512", "qie"])).toEqual(["oepeo3512"]);
  });

  it("keeps several labels from one registration", () => {
    expect(labelsFromStrings(["qie", "alice", "qie", "bob", "qie"])).toEqual(["alice", "bob"]);
  });
});

describe("matchNamesToTokens", () => {
  it("is exact when one name maps to one token", () => {
    const [n] = matchNamesToTokens(["oepeo3512"], ["31636"], "0xtx");
    expect(n.full).toBe("oepeo3512.qie");
    expect(n.tokenId).toBe("31636");
    expect(n.confidence).toBe("exact");
  });

  it("marks a multi-name registration as positional, not exact", () => {
    // Order is the only link available; saying "exact" here would overstate
    // what the transaction actually proves.
    const out = matchNamesToTokens(["alice", "bob"], ["1", "2"], "0xtx");
    expect(out.map((n) => n.confidence)).toEqual(["positional", "positional"]);
  });

  it("never invents a pairing when the counts disagree", () => {
    expect(matchNamesToTokens(["a", "b", "c"], ["1"], "0xtx")).toHaveLength(1);
    expect(matchNamesToTokens([], ["1", "2"], "0xtx")).toHaveLength(0);
  });
});

describe("formatWalletAge", () => {
  it("reads coarsely, because a first-tx timestamp is not precise", () => {
    expect(formatWalletAge(0)).toBe("today");
    expect(formatWalletAge(5 * 86_400_000)).toBe("5 days");
    expect(formatWalletAge(90 * 86_400_000)).toBe("3 months");
    expect(formatWalletAge(400 * 86_400_000)).toBe("1y 1m");
  });

  it("says unknown rather than guessing", () => {
    expect(formatWalletAge(null)).toBe("unknown");
    expect(formatWalletAge(-1)).toBe("unknown");
  });
});

describe("decoder rejects things that are not labels", () => {
  const num = (hex: string) => hex.padStart(64, "0");

  it("does not read a small integer as a name", () => {
    // 0x616263 is "abc" if you ignore alignment. ABI numbers are
    // right-aligned and strings are left-aligned, so the first byte settles it
    //, without that check this decoded to a registered name.
    expect(decodeRegistrationStrings("0xbc96db3f" + num("616263"))).toEqual([]);
  });

  it("does not read a token id or address as a name", () => {
    const tokenId = num("9057a81a0f83aeee4d5bebe78547960244d1409b48edb3707c70cce1fdf8d99f");
    const addr = num("67cd7d9f18b14d8a84fd5d3afbd40611c295ce38");
    expect(decodeRegistrationStrings("0xbc96db3f" + tokenId + addr)).toEqual([]);
  });

  it("still recovers a real label", () => {
    const word = Buffer.from("oepeo3512", "utf8").toString("hex").padEnd(64, "0");
    expect(decodeRegistrationStrings("0xbc96db3f" + word)).toEqual(["oepeo3512"]);
  });
});

describe("isPlausibleLabel", () => {
  it("accepts what a registry actually allows", () => {
    expect(isPlausibleLabel("oepeo3512")).toBe(true);
    expect(isPlausibleLabel("my-name")).toBe(true);
  });

  it("rejects shapes no label takes", () => {
    expect(isPlausibleLabel("A")).toBe(false);
    expect(isPlausibleLabel("Upper")).toBe(false);
    expect(isPlausibleLabel("has space")).toBe(false);
    expect(isPlausibleLabel("-lead")).toBe(false);
    expect(isPlausibleLabel("trail-")).toBe(false);
    expect(isPlausibleLabel("x".repeat(64))).toBe(false);
  });
});
