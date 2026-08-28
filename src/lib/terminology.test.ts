import { describe, expect, it } from "bun:test";
import {
  applyTerminology,
  tokenStandard,
  technicalStandard,
  tokenStandardWithTechnical,
  nftNoun,
  contractNoun,
  gasNoun,
} from "./terminology";

const QIE_MAINNET = 1990;
const QIE_TESTNET = 1983;
const BOT_MAINNET = 677;
const BOT_TESTNET = 968;
const UNKNOWN = 999999;

describe("tokenStandard", () => {
  it("renames the EVM standards on both QIE networks", () => {
    for (const id of [QIE_MAINNET, QIE_TESTNET]) {
      expect(tokenStandard("ERC-20", id)).toBe("QIE-20");
      expect(tokenStandard("ERC-721", id)).toBe("QIE-721");
      expect(tokenStandard("ERC-1155", id)).toBe("QIE-1155");
    }
  });

  it("matches unhyphenated and mixed-case spellings", () => {
    // Blockscout returns "ERC-20"; our own copy and ABIs use "ERC20".
    expect(tokenStandard("ERC20", QIE_MAINNET)).toBe("QIE-20");
    expect(tokenStandard("erc721", QIE_MAINNET)).toBe("QIE-721");
  });

  it("leaves BOT Chain untouched", () => {
    for (const id of [BOT_MAINNET, BOT_TESTNET]) {
      expect(tokenStandard("ERC-20", id)).toBe("ERC-20");
      expect(tokenStandard("ERC-721", id)).toBe("ERC-721");
    }
  });

  it("passes through unknown standards rather than blanking them", () => {
    // A token type Blockscout adds later must still render.
    expect(tokenStandard("ERC-4626", QIE_MAINNET)).toBe("ERC-4626");
    expect(tokenStandard("", QIE_MAINNET)).toBe("");
  });

  it("treats an unmapped chain id as non-QIE", () => {
    expect(tokenStandard("ERC-20", UNKNOWN)).toBe("ERC-20");
  });
});

describe("technicalStandard", () => {
  it("always returns the real EVM name, whatever the chain", () => {
    expect(technicalStandard("ERC20")).toBe("ERC-20");
    expect(technicalStandard("ERC-721")).toBe("ERC-721");
  });

  it("never invents a QIE name", () => {
    expect(technicalStandard("ERC-20")).not.toContain("QIE");
  });
});

describe("tokenStandardWithTechnical", () => {
  it("shows both names on QIE so the real standard stays discoverable", () => {
    expect(tokenStandardWithTechnical("ERC-20", QIE_MAINNET)).toBe("QIE-20 (ERC-20)");
  });

  it("does not duplicate the name when they are the same", () => {
    expect(tokenStandardWithTechnical("ERC-20", BOT_MAINNET)).toBe("ERC-20");
    expect(tokenStandardWithTechnical("ERC-4626", QIE_MAINNET)).toBe("ERC-4626");
  });
});

describe("nouns", () => {
  it("is QIE-native on QIE and neutral elsewhere", () => {
    expect(nftNoun(QIE_MAINNET)).toBe("QIE NFT");
    expect(nftNoun(BOT_MAINNET)).toBe("NFT");
    expect(contractNoun(QIE_MAINNET)).toBe("QIE Contract");
    expect(contractNoun(BOT_MAINNET)).toBe("Contract");
  });

  it("uses the chain's own token for gas off QIE", () => {
    expect(gasNoun(QIE_MAINNET, "QIE")).toBe("QIE Gas");
    expect(gasNoun(BOT_MAINNET, "BOT")).toBe("BOT Gas");
  });
});

describe("applyTerminology (prose)", () => {
  const SRC = "A standard ERC-20 fungible token with owner-only minting.";

  it("rewrites standards in prose on QIE", () => {
    expect(applyTerminology(SRC, QIE_MAINNET)).toBe(
      "A standard QIE-20 fungible token with owner-only minting.",
    );
  });

  it("leaves prose untouched on BOT Chain — the whole point of the fix", () => {
    expect(applyTerminology(SRC, BOT_MAINNET)).toBe(SRC);
    expect(applyTerminology("A standard ERC-721 collection", BOT_TESTNET)).toBe(
      "A standard ERC-721 collection",
    );
    expect(applyTerminology("Soulbound NFT", BOT_MAINNET)).toBe("Soulbound NFT");
  });

  it("handles NFT nouns", () => {
    expect(applyTerminology("Soulbound NFT", QIE_MAINNET)).toBe("Soulbound QIE NFT");
    expect(applyTerminology("NFT Collection", QIE_MAINNET)).toBe("QIE NFT Collection");
    expect(applyTerminology("tokens, NFTs, staking", QIE_MAINNET)).toBe(
      "tokens, QIE NFTs, staking",
    );
  });

  it("never double-substitutes in a single pass", () => {
    // "NFT" appears inside the replacement "QIE NFT"; one pass must not re-match it.
    expect(applyTerminology("NFT", QIE_MAINNET)).toBe("QIE NFT");
    expect(applyTerminology("NFT and NFT", QIE_MAINNET)).toBe("QIE NFT and QIE NFT");
  });

  it("does not match inside longer words", () => {
    expect(applyTerminology("NFTs are MINTED", QIE_MAINNET)).toBe("QIE NFTs are MINTED");
    expect(applyTerminology("SoulboundNFT", QIE_MAINNET)).toBe("SoulboundNFT");
  });

  it("handles the longest standard first", () => {
    expect(applyTerminology("ERC-1155 multi-token", QIE_MAINNET)).toBe("QIE-1155 multi-token");
  });

  it("passes through empty and unmapped text", () => {
    expect(applyTerminology("", QIE_MAINNET)).toBe("");
    expect(applyTerminology("ERC-4626 vault", QIE_MAINNET)).toBe("ERC-4626 vault");
  });
});
