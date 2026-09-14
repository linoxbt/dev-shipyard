import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { buildPreview } from "@/lib/appgen/preview";
import { WALLET_JS } from "@/lib/appgen/runtime";
import { parseSkill } from "@/lib/agent/cli/skills";
import { bundleProblem, type Bundle } from "@/lib/marketplace/bundle";
import { parsePrice, serializeMetadata, MAX_METADATA_BYTES } from "@/lib/marketplace/listing";
import { skillNameFromPaths } from "@/lib/marketplace/skill-install";
import { OFFICIAL_LISTINGS } from "./official";

// The marketplace's own listings are real software, so they are held to what a
// buyer would expect: every app and kit previews, every script parses, every
// skill loads, and every listing says how to get started.

const OFFICIAL = join(import.meta.dirname, "official");
const PAID = join(import.meta.dirname, "..", "..", "..", "..", "marketplace-content", "paid");

function readBundle(dir: string): Bundle {
  const files: Bundle = {};
  const walk = (current: string) => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[relative(dir, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return files;
}

interface Item {
  source: "official" | "paid";
  slug: string;
  kind: string;
  files: Bundle;
}

const official: Item[] = readdirSync(OFFICIAL).map((slug) => ({
  source: "official",
  slug,
  kind: OFFICIAL_LISTINGS.find((l) => l.slug === slug)?.kind ?? "missing",
  files: readBundle(join(OFFICIAL, slug, "files")),
}));
const paid: Item[] = readdirSync(PAID)
  .filter((slug) => existsSync(join(PAID, slug, "manifest.json")))
  .map((slug) => ({
    source: "paid",
    slug,
    kind: (JSON.parse(readFileSync(join(PAID, slug, "manifest.json"), "utf8")) as { kind: string })
      .kind,
    files: readBundle(join(PAID, slug, "files")),
  }));
const items = [...official, ...paid];
const transpiler = new Bun.Transpiler({ loader: "js" });

describe("the marketplace's own listings", () => {
  it("are two official and two paid of each kind", () => {
    for (const kind of ["app", "skill", "ui-kit"]) {
      expect(`${kind}: ${official.filter((i) => i.kind === kind).length} official`).toBe(
        `${kind}: 2 official`,
      );
      expect(`${kind}: ${paid.filter((i) => i.kind === kind).length} paid`).toBe(`${kind}: 2 paid`);
    }
    expect(OFFICIAL_LISTINGS.map((l) => l.slug).sort()).toEqual(official.map((i) => i.slug).sort());
  });

  for (const item of items) {
    describe(`${item.source} ${item.kind} ${item.slug}`, () => {
      it("is a valid bundle", () => {
        expect(bundleProblem(item.files)).toBeNull();
      });

      it("has JavaScript that parses", () => {
        for (const [path, content] of Object.entries(item.files)) {
          if (!path.endsWith(".js")) continue;
          expect(() => transpiler.transformSync(content)).not.toThrow();
        }
      });

      if (item.kind === "app" || item.kind === "ui-kit") {
        it("previews in the App Builder, with DevStation's own wallet bridge", () => {
          expect(item.files["app/index.html"]).toContain('src="./app.js"');
          expect(item.files["app/wallet.js"]).toBe(WALLET_JS);
          expect(item.files["app/contract.js"]).toContain("id: 1990");
          const { srcdoc } = buildPreview(item.files, "app");
          expect(srcdoc).toMatch(/src="data:text\/javascript/);
        });
      }

      if (item.kind === "skill") {
        it("is a skill the CLI loads by its folder name", () => {
          const name = skillNameFromPaths(Object.keys(item.files));
          expect(name).toBe(item.slug);
          const { meta, body } = parseSkill(item.files[`${name}/SKILL.md`]);
          expect(meta.name).toBe(item.slug);
          expect((meta.description ?? "").length).toBeGreaterThan(40);
          expect(body).toContain("## Steps");
          expect(body).toContain("## Done means");
        });
      }
    });
  }
});

describe("official listings", () => {
  it("each say how to get started, and a skill names its folder", () => {
    for (const listing of OFFICIAL_LISTINGS) {
      expect(listing.gettingStarted.length).toBeGreaterThan(0);
      expect(listing.readme.length).toBeGreaterThan(100);
      if (listing.kind === "skill") expect(listing.skillName).toBe(listing.slug);
    }
  });
});

describe("paid listing manifests", () => {
  for (const item of paid) {
    it(`${item.slug} fits the contract and keeps its whole readme`, () => {
      const manifest = JSON.parse(readFileSync(join(PAID, item.slug, "manifest.json"), "utf8")) as {
        name: string;
        description: string;
        currency: "QIE" | "QUSDC";
        price: string;
        readme: string;
        category: string;
        tags: string[];
        version: string;
      };
      expect(new TextEncoder().encode(manifest.name).length).toBeLessThanOrEqual(80);
      expect(new TextEncoder().encode(manifest.description).length).toBeLessThanOrEqual(1000);
      expect(parsePrice(manifest.price, manifest.currency)).toBeGreaterThan(0n);
      expect(manifest.readme).toContain("Getting started");
      const json = serializeMetadata({
        category: manifest.category,
        tags: manifest.tags,
        readme: manifest.readme,
        files: Object.keys(item.files).sort(),
        version: manifest.version,
      });
      expect(new TextEncoder().encode(json).length).toBeLessThanOrEqual(MAX_METADATA_BYTES);
      expect((JSON.parse(json) as { readme: string }).readme).toBe(manifest.readme);
    });
  }
});
