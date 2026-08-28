import { describe, expect, it } from "bun:test";
import {
  LABEL_CATEGORIES,
  labelCategoryForTemplate,
  normalizeLabelCategory,
} from "./categories";
import { CATEGORIES, type TemplateCategory } from "@/lib/data/templates";

describe("labelCategoryForTemplate", () => {
  it("maps every template category to a real registry category", () => {
    // The bug this prevents: "Token Standards" written onchain never matched
    // the registry's "Token" filter, so the label was unfindable.
    for (const c of CATEGORIES.filter((x) => x !== "All") as TemplateCategory[]) {
      expect(LABEL_CATEGORIES).toContain(labelCategoryForTemplate(c));
    }
  });

  it("maps the specific mismatches correctly", () => {
    expect(labelCategoryForTemplate("Token Standards")).toBe("Token");
    expect(labelCategoryForTemplate("Utility")).toBe("Infrastructure");
    expect(labelCategoryForTemplate("Custom")).toBe("Other");
    expect(labelCategoryForTemplate("NFT")).toBe("NFT");
    expect(labelCategoryForTemplate("DeFi")).toBe("DeFi");
    expect(labelCategoryForTemplate("Governance")).toBe("Governance");
  });
});

describe("normalizeLabelCategory", () => {
  it("always returns something the registry UI can filter", () => {
    for (const input of ["Token Standards", "erc20", "QIE-20", "staking", "dao",
                         "soulbound", "nonsense", "", "   ", "!!!"]) {
      expect(LABEL_CATEGORIES).toContain(normalizeLabelCategory(input));
    }
  });

  it("accepts exact categories unchanged", () => {
    for (const c of LABEL_CATEGORIES) expect(normalizeLabelCategory(c)).toBe(c);
  });

  it("resolves the aliases a model is likely to emit", () => {
    expect(normalizeLabelCategory("Token Standards")).toBe("Token");
    expect(normalizeLabelCategory("ERC-20")).toBe("Token");
    expect(normalizeLabelCategory("QIE-20")).toBe("Token");
    expect(normalizeLabelCategory("erc721")).toBe("NFT");
    expect(normalizeLabelCategory("staking")).toBe("DeFi");
    expect(normalizeLabelCategory("multisig")).toBe("Governance");
    expect(normalizeLabelCategory("Soulbound")).toBe("Identity");
    expect(normalizeLabelCategory("utility")).toBe("Infrastructure");
  });

  it("falls back to a REAL category, never an orphan string", () => {
    // Falling back to free text would put an unfilterable value onchain.
    expect(normalizeLabelCategory("completely made up")).toBe("Other");
    expect(normalizeLabelCategory(undefined)).toBe("Other");
    expect(normalizeLabelCategory(null)).toBe("Other");
  });

  it("is case- and punctuation-insensitive", () => {
    expect(normalizeLabelCategory("TOKEN-STANDARDS")).toBe("Token");
    expect(normalizeLabelCategory("  DeFi  ")).toBe("DeFi");
  });
});
