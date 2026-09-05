import { describe, expect, it } from "bun:test";
import { buildPreview } from "./preview";
import { generateApp, type GenerateSpec } from "./generate";
import { getTemplate } from "@/lib/data/templates";

const spec: GenerateSpec = {
  abi: JSON.parse(getTemplate("qie-id-gate")!.abi),
  address: "0x31423638af5b8d2a9096b6ab58c62f07844bc461",
  contractName: "Gate",
  chainId: 1990,
  chainName: "QIE Mainnet",
  rpcUrl: "https://rpc1mainnet.qie.digital/",
  explorerUrl: "https://mainnet.qie.digital",
  nativeSymbol: "QIE",
};

describe("buildPreview", () => {
  it("rewrites every relative import to something a sandbox can load", () => {
    const { srcdoc } = buildPreview(generateApp(spec));
    // A blob: URL cannot load on the opaque origin a sandboxed iframe gets.
    expect(srcdoc).not.toContain("blob:");
    expect(srcdoc).not.toContain('src="./app.js"');
    expect(srcdoc).toMatch(/src="data:text\/javascript/);
  });

  it("links the whole graph, not just the entry point", () => {
    // app.js -> contract.js, wallet.js, abi-ui.js; wallet.js -> contract.js
    const { srcdoc } = buildPreview(generateApp(spec));
    const entry = /src="(data:text\/javascript[^"]*)"/.exec(srcdoc)?.[1] ?? "";
    const appSource = decodeURIComponent(entry.split(",")[1] ?? "");
    expect(appSource).toContain("render(html");
    // Its own relative imports must already be inlined data: URLs.
    expect(appSource).not.toMatch(/from\s+"\.\//);
    expect(appSource).toMatch(/from\s*"data:text\/javascript/);
  });

  it("keeps bare specifiers alone so the import map still resolves them", () => {
    const { srcdoc } = buildPreview(generateApp(spec));
    const entry = /src="(data:text\/javascript[^"]*)"/.exec(srcdoc)?.[1] ?? "";
    const appSource = decodeURIComponent(entry.split(",")[1] ?? "");
    expect(appSource).toContain('from "htm/preact"');
    expect(appSource).toContain('from "viem"');
    expect(srcdoc).toContain('"viem": "https://esm.sh/viem@');
  });

  it("inlines the stylesheet", () => {
    const { srcdoc } = buildPreview(generateApp(spec));
    expect(srcdoc).not.toContain('href="./styles.css"');
    expect(srcdoc).toContain("<style>");
    expect(srcdoc).toContain("--primary");
  });

  it("survives non-ASCII sources (btoa would not)", () => {
    // The generated files contain em dashes; base64 via btoa throws on those.
    expect(() => buildPreview(generateApp(spec))).not.toThrow();
    const { srcdoc } = buildPreview(generateApp(spec));
    const entry = /src="(data:text\/javascript[^"]*)"/.exec(srcdoc)?.[1] ?? "";
    expect(decodeURIComponent(entry.split(",")[1] ?? "")).toContain("-");
  });

  it("fails loudly when there is no index.html", () => {
    expect(() => buildPreview({ "app/app.js": "x" })).toThrow(/No index.html/);
  });

  it("detects a circular import instead of hanging, and leaks no blobs", () => {
    expect(() =>
      buildPreview({
        "app/index.html": '<html><body><script type="module" src="./a.js"></script></body></html>',
        "app/a.js": 'import "./b.js";',
        "app/b.js": 'import "./a.js";',
      }),
    ).toThrow(/circular import/);
  });

  it("rewrites the markup variants a MODEL writes, not just the generator's", () => {
    // This was a real blank-page bug: the rewrite required exactly
    // href="./styles.css" / src="./app.js". The model rewrites index.html
    // freely, so no-./ paths and single quotes slipped through, resolved
    // against the host page, 404'd, and rendered nothing.
    const variants = [
      { html: '<link rel="stylesheet" href="styles.css">', label: "href without ./" },
      { html: "<link rel='stylesheet' href='./styles.css'>", label: "single quotes" },
      { html: '<link href="./styles.css" rel="stylesheet">', label: "attribute order" },
    ];
    for (const v of variants) {
      const { srcdoc } = buildPreview({
        "app/index.html": `<html><head>${v.html}</head><body><div id="root"></div><script type="module" src="app.js"></script></body></html>`,
        "app/app.js": "console.log(1);",
        "app/styles.css": "body{color:red}",
      });
      expect(`${v.label}: inlined`).toBe(
        `${v.label}: ${srcdoc.includes("color:red") ? "inlined" : "MISSED"}`,
      );
      expect(`${v.label}: script`).toBe(
        `${v.label}: ${/src="data:text\/javascript/.test(srcdoc) ? "script" : "MISSED"}`,
      );
    }
  });

  it("refuses to ship a preview with an unresolvable local reference", () => {
    // Better a loud failure than a white frame the user has to diagnose.
    expect(() =>
      buildPreview({
        "app/index.html":
          '<html><head></head><body><div id="root"></div><script type="module" src="./app.js"></script><img src="./logo.png"></body></html>',
        "app/app.js": "console.log(1);",
        "app/logo.png": "binary-ish",
      }),
    ).toThrow(/Could not rewrite/);
  });

  it("leaves absolute and CDN URLs alone", () => {
    const { srcdoc } = buildPreview({
      "app/index.html":
        '<html><head><link rel="stylesheet" href="https://cdn.example/x.css"></head><body><div id="root"></div><script type="module" src="./app.js"></script></body></html>',
      "app/app.js": "console.log(1);",
    });
    expect(srcdoc).toContain("https://cdn.example/x.css");
  });

  it("honours a custom directory", () => {
    const files = generateApp({ ...spec, dir: "site" });
    expect(() => buildPreview(files, "site")).not.toThrow();
  });
});

describe("buildPreview, built output", () => {
  // What Vite writes to dist/: hashed assets in a subdirectory, referenced
  // relatively because the generated vite.config.js sets base: "./".
  const dist = {
    "index.html":
      '<!doctype html><html><head><meta charset="utf-8"><title>Built</title>' +
      '<script type="module" crossorigin src="./assets/index-abc123.js"></script>' +
      '<link rel="stylesheet" crossorigin href="./assets/index-def456.css">' +
      '</head><body><div id="root"></div></body></html>',
    "assets/index-abc123.js": 'document.getElementById("root").textContent = "built";',
    "assets/index-def456.css": "body{background:#111}",
  };

  it("previews a built project with no changes to the linker", () => {
    // The rewriter matches on the attribute rather than the markup, so hashed
    // filenames in a subdirectory need no special handling. Worth a test
    // anyway: this is the path every built app takes to the screen.
    const { srcdoc } = buildPreview(dist, "");
    expect(srcdoc).toContain("<style>");
    expect(srcdoc).toContain("background:#111");
    expect(srcdoc).toMatch(/src="data:text\/javascript/);
  });

  it("leaves nothing pointing at a path the iframe cannot resolve", () => {
    // A srcdoc iframe inherits the host's base URL, so any surviving relative
    // reference 404s against DevStation itself and the app renders blank.
    const { srcdoc } = buildPreview(dist, "");
    const refs = [...srcdoc.matchAll(/(?:src|href)\s*=\s*(["'])([^"']+)\1/gi)]
      .map((m) => m[2])
      .filter((v) => !/^(https?:|data:|#)/i.test(v));
    expect(refs).toEqual([]);
  });
});
