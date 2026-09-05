import { describe, expect, it } from "bun:test";
import {
  generateApp,
  regenerateContractFile,
  CDN_VERSIONS,
  VITE_DEPS,
  type GenerateSpec,
} from "./generate";
import { getTemplate } from "@/lib/data/templates";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The real ABI of the QieIdGatedAllowlist deployed to QIE mainnet in Phase 2.
const abi = JSON.parse(getTemplate("qie-id-gate")!.abi) as unknown[];

const spec: GenerateSpec = {
  abi,
  address: "0x31423638af5b8d2a9096b6ab58c62f07844bc461",
  contractName: "QIE ID Gated Allowlist",
  chainId: 1990,
  chainName: "QIE Mainnet",
  rpcUrl: "https://rpc1mainnet.qie.digital/",
  explorerUrl: "https://mainnet.qie.digital",
  nativeSymbol: "QIE",
};

describe("generateApp", () => {
  const files = generateApp(spec);

  it("emits a complete, runnable project", () => {
    for (const f of [
      "app/index.html",
      "app/app.js",
      "app/abi-ui.js",
      "app/wallet.js",
      "app/contract.js",
      "app/styles.css",
      "app/README.md",
      "app/package.json",
    ]) {
      expect(`${f}: ${typeof files[f]}`).toBe(`${f}: string`);
      expect(files[f].length).toBeGreaterThan(0);
    }
  });

  it("bakes the contract binding correctly: verified by EXECUTING it", async () => {
    // Importing the generated module proves two things a string check cannot:
    // that it is valid JavaScript, and that the values it exports are right.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appgen-"));
    const file = path.join(dir, "contract.js");
    fs.writeFileSync(file, files["app/contract.js"]);
    const mod = (await import(file)) as {
      CHAIN: { id: number; name: string; rpcUrl: string; symbol: string; explorerUrl: string };
      CONTRACT: { address: string; abi: unknown[]; name: string };
    };
    expect(mod.CHAIN.id).toBe(1990);
    expect(mod.CHAIN.name).toBe("QIE Mainnet");
    expect(mod.CHAIN.rpcUrl).toBe("https://rpc1mainnet.qie.digital/");
    expect(mod.CHAIN.symbol).toBe("QIE");
    expect(mod.CONTRACT.address).toBe(spec.address);
    // The ABI must survive intact, every call the app makes depends on it.
    expect(JSON.stringify(mod.CONTRACT.abi)).toBe(JSON.stringify(abi));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("marks contract.js as generated so nobody hand-edits it", () => {
    expect(files["app/contract.js"]).toContain("GENERATED");
    expect(files["app/contract.js"]).toContain("do not edit");
  });

  it("pins every CDN import so the app cannot rot", () => {
    const html = files["app/index.html"];
    expect(html).toContain(`preact@${CDN_VERSIONS.preact}`);
    expect(html).toContain(`htm@${CDN_VERSIONS.htm}`);
    expect(html).toContain(`viem@${CDN_VERSIONS.viem}`);
    // A bare, unpinned specifier would silently drift.
    expect(html).not.toMatch(/esm\.sh\/(preact|htm|viem)["/?]/);
  });

  it("declares an import map entry for every bare specifier app.js imports", () => {
    const html = files["app/index.html"];
    const imports = [...files["app/app.js"].matchAll(/from\s+"([^".][^"]*)"/g)].map((m) => m[1]);
    const bare = imports.filter((i) => !i.startsWith("./") && !i.startsWith("../"));
    expect(bare.length).toBeGreaterThan(0);
    for (const b of bare) expect(`${b}: ${html.includes(`"${b}":`)}`).toBe(`${b}: true`);
  });

  it("only uses relative imports that actually exist in the output", () => {
    for (const [path, content] of Object.entries(files)) {
      if (!path.endsWith(".js")) continue;
      for (const m of content.matchAll(/from\s+"(\.\/[^"]+)"/g)) {
        const target = `app/${m[1].slice(2)}`;
        expect(`${path} -> ${m[1]}: ${target in files}`).toBe(`${path} -> ${m[1]}: true`);
      }
    }
  });

  it("escapes </script> so inlined JSON cannot break out of the page", () => {
    const evil = generateApp({
      ...spec,
      abi: [
        { type: "function", name: "x</script><script>alert(1)</script>", inputs: [], outputs: [] },
      ],
    });
    expect(evil["app/contract.js"]).not.toContain("</script>");
    expect(evil["app/contract.js"]).toContain("\\u003c/script>");
  });

  it("survives a missing or hostile contract name", () => {
    expect(generateApp({ ...spec, contractName: null })["app/index.html"]).toContain("Contract");
    // The safety property is that no markup can be INJECTED: angle brackets,
    // quotes and equals are stripped. Surviving letters are inert text, so
    // asserting the absence of the word "onerror" would test the wrong thing.
    const weird = generateApp({ ...spec, contractName: '"><img src=x onerror=alert(1)>' });
    const title = /<title>([^<]*)<\/title>/.exec(weird["app/index.html"])?.[1] ?? "";
    expect(title).not.toMatch(/[<>"=]/);
    expect(weird["app/contract.js"]).not.toMatch(/name: "[^"]*[<>][^"]*"/);
  });

  it("honours a custom directory", () => {
    const f = generateApp({ ...spec, dir: "site" });
    expect(Object.keys(f).every((p) => p.startsWith("site/"))).toBe(true);
  });

  it("regenerates only the binding, for a redeploy", () => {
    const one = regenerateContractFile({
      ...spec,
      address: "0x0000000000000000000000000000000000000001",
    });
    expect(one.path).toBe("app/contract.js");
    expect(one.content).toContain("0x0000000000000000000000000000000000000001");
  });

  it("is deterministic", () => {
    expect(JSON.stringify(generateApp(spec))).toBe(JSON.stringify(generateApp(spec)));
  });
});

describe("generateApp, vite target", () => {
  const files = generateApp({ ...spec, target: "vite" });

  it("emits a real project, with the source under src/", () => {
    for (const f of [
      "app/index.html",
      "app/package.json",
      "app/vite.config.js",
      "app/README.md",
      "app/src/app.js",
      "app/src/abi-ui.js",
      "app/src/wallet.js",
      "app/src/contract.js",
      "app/src/styles.css",
    ]) {
      expect(files[f]).toBeTruthy();
    }
  });

  it("ships the same application as the no-build target", () => {
    // The whole design rests on this: only the packaging differs, so an app
    // cannot behave one way in the preview and another once it is built.
    const esm = generateApp(spec);
    for (const name of ["app.js", "abi-ui.js", "wallet.js", "contract.js", "styles.css"]) {
      expect(files[`app/src/${name}`]).toBe(esm[`app/${name}`]);
    }
  });

  it("has no import map, and loads the app as a module", () => {
    const html = files["app/index.html"];
    expect(html).not.toContain("importmap");
    expect(html).not.toContain("esm.sh");
    expect(html).toContain('src="/src/app.js"');
    expect(html).toContain('href="/src/styles.css"');
  });

  it("pins the same dependency versions the import map uses", () => {
    const pkg = JSON.parse(files["app/package.json"]) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
      scripts: Record<string, string>;
    };
    expect(pkg.dependencies.preact).toBe(CDN_VERSIONS.preact);
    expect(pkg.dependencies.htm).toBe(CDN_VERSIONS.htm);
    expect(pkg.dependencies.viem).toBe(CDN_VERSIONS.viem);
    expect(pkg.devDependencies).toEqual({ ...VITE_DEPS.devDependencies });
    expect(pkg.scripts.build).toBe("vite build");
  });

  it("keeps the runner's warm image in step with the pinned versions", () => {
    // The image pre-installs exactly this set. If they drift, every job pays
    // for a cold install, which took 175s against a 180s phase deadline.
    const warm = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "services/runner/warm-package.json"), "utf8"),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    expect(warm.dependencies).toEqual({ ...VITE_DEPS.dependencies });
    expect(warm.devDependencies).toEqual({ ...VITE_DEPS.devDependencies });
  });

  it("builds with relative asset paths, for the sandboxed preview", () => {
    // The preview iframe has an opaque origin, so an absolute /assets/… path
    // resolves against nothing and the page renders blank.
    expect(files["app/vite.config.js"]).toContain('base: "./"');
  });

  it("points the regenerated binding at src/", () => {
    const one = regenerateContractFile({ ...spec, target: "vite" });
    expect(one.path).toBe("app/src/contract.js");
  });
});
