import { describe, expect, it } from "bun:test";
import { TEMPLATES, templateLabel, templateNeedsImage } from "./templates";

// These guard the invariants that silently break compile, verify or the deploy
// form if someone edits a template's Solidity without updating its metadata.
describe("template data integrity", () => {
  it("every template's `name` matches its Solidity contract identifier", () => {
    // name is the solc source key, the compiled-artifact lookup key AND the
    // verification contractName. A mismatch breaks deploy and verification.
    for (const t of TEMPLATES) {
      expect(new RegExp(`contract\\s+${t.name}\\b`).test(t.solidity)).toBe(true);
    }
  });

  it("declared `args` match the constructor inputs in the published `abi`", () => {
    // The deploy form is built from `args`; the published `abi` is what the
    // detail page shows. If they drift, the form asks for the wrong fields.
    for (const t of TEMPLATES) {
      const abi = JSON.parse(t.abi) as Array<{ type: string; inputs?: unknown[] }>;
      const ctor = abi.find((e) => e.type === "constructor");
      const abiInputs = ctor?.inputs?.length ?? 0;
      expect(`${t.id}:${t.args.length}`).toBe(`${t.id}:${abiInputs}`);
    }
  });

  it("has unique ids and non-empty required fields", () => {
    const ids = TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TEMPLATES) {
      expect(t.solidity.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
      expect(() => JSON.parse(t.abi)).not.toThrow();
    }
  });

  it("stores display copy in NEUTRAL EVM wording, never QIE-native", () => {
    // The QIE form is derived per-chain by templateLabel/applyTerminology.
    // Hardcoding it here is what leaked QIE naming onto BOT Chain before.
    for (const t of TEMPLATES) {
      const copy = [t.displayName ?? "", t.description, t.longDescription, ...t.tags].join(" ");
      expect(copy).not.toMatch(/QIE-\d|QIE NFT/);
    }
  });

  it("renders neutral names on BOT Chain and QIE names on QIE", () => {
    const named = TEMPLATES.filter((t) => t.displayName);
    expect(named.length).toBeGreaterThan(0);
    for (const t of named) {
      expect(templateLabel(t, 677)).toBe(t.displayName!);
      expect(templateLabel(t, 1990)).not.toMatch(/\bERC-\d/);
    }
  });

  it("templateNeedsImage defaults sensibly", () => {
    for (const t of TEMPLATES) {
      expect(typeof templateNeedsImage(t)).toBe("boolean");
    }
  });
});
