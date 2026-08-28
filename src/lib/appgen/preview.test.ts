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
    expect(decodeURIComponent(entry.split(",")[1] ?? "")).toContain("—");
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

  it("honours a custom directory", () => {
    const files = generateApp({ ...spec, dir: "site" });
    expect(() => buildPreview(files, "site")).not.toThrow();
  });
});
