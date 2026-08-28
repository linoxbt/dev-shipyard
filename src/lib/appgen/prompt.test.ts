import { describe, expect, it } from "bun:test";
import { parseGeneratedFiles, blankScaffold, appBuilderSystemPrompt } from "./prompt";

describe("parseGeneratedFiles", () => {
  it("reads the shapes models actually produce", () => {
    // Filename position varies by model; all of these are common.
    const text = [
      "Here you go.",
      "```html index.html",
      "<!doctype html>",
      "```",
      "```js path=app.js",
      'console.log("hi");',
      "```",
      "```css",
      "ignored — no filename",
      "```",
      "```styles.css",
      "body{}",
      "```",
    ].join("\n");
    const files = parseGeneratedFiles(text);
    expect(files.map((f) => f.path)).toEqual(["app/index.html", "app/app.js", "app/styles.css"]);
    expect(files[1].content).toBe('console.log("hi");');
  });

  it("does not double-prefix a path the model already qualified", () => {
    const files = parseGeneratedFiles("```js app/app.js\nx\n```");
    expect(files[0].path).toBe("app/app.js");
  });

  it("lets a later block correct an earlier one", () => {
    // Models frequently re-emit a file after noticing a mistake.
    const files = parseGeneratedFiles("```js app.js\nfirst\n```\n```js app.js\nsecond\n```");
    expect(files).toHaveLength(1);
    expect(files[0].content).toBe("second");
  });

  it("refuses path traversal and unexpected file types", () => {
    expect(parseGeneratedFiles("```js ../../etc/passwd.js\nx\n```")).toHaveLength(0);
    expect(parseGeneratedFiles("```sh deploy.sh\nrm -rf /\n```")).toHaveLength(0);
    expect(parseGeneratedFiles("```js ../app.js\nx\n```")).toHaveLength(0);
  });

  it("caps how many files and how large a response can be", () => {
    const many = Array.from({ length: 20 }, (_, i) => "```js f" + i + ".js\nx\n```").join("\n");
    expect(parseGeneratedFiles(many).length).toBeLessThanOrEqual(12);
    const huge = "```js big.js\n" + "x".repeat(200_000) + "\n```";
    expect(parseGeneratedFiles(huge)).toHaveLength(0);
  });

  it("returns nothing for prose with no code", () => {
    expect(parseGeneratedFiles("I would build a nice app for you.")).toHaveLength(0);
  });

  it("honours a custom directory", () => {
    expect(parseGeneratedFiles("```js app.js\nx\n```", "site")[0].path).toBe("site/app.js");
  });
});

describe("blankScaffold", () => {
  const files = blankScaffold();

  it("is runnable before the model writes anything", () => {
    expect(Object.keys(files)).toEqual(["app/index.html", "app/app.js", "app/styles.css"]);
    expect(files["app/index.html"]).toContain('<div id="root">');
    expect(files["app/app.js"]).toContain("render(html");
  });

  it("ships a correct import map, so a partial response still runs", () => {
    const html = files["app/index.html"];
    for (const spec of ["preact", "preact/hooks", "htm/preact", "viem"]) {
      expect(`${spec}: ${html.includes(`"${spec}":`)}`).toBe(`${spec}: true`);
    }
    expect(html).toMatch(/esm\.sh\/preact@\d+\.\d+\.\d+/);
  });
});

describe("appBuilderSystemPrompt", () => {
  it("forbids JSX, since there is no transform available", () => {
    const p = appBuilderSystemPrompt();
    expect(p).toContain("NO JSX");
    expect(p).toContain("htm");
  });

  it("says nothing about contracts when there is none", () => {
    const p = appBuilderSystemPrompt();
    expect(p).toContain("not wired to a smart contract");
    expect(p).not.toContain("CONTRACT.address");
  });

  it("describes the contract surface when one is attached", () => {
    const p = appBuilderSystemPrompt({
      contract: {
        address: "0xabc",
        chainId: 1990,
        chainName: "QIE Mainnet",
        rpcUrl: "r",
        explorerUrl: "e",
        nativeSymbol: "QIE",
        abi: [
          { type: "function", name: "claim", inputs: [], stateMutability: "nonpayable" },
          {
            type: "function",
            name: "holdsQieId",
            inputs: [{ type: "address" }],
            stateMutability: "view",
          },
        ],
      },
    });
    expect(p).toContain("claim() [write]");
    expect(p).toContain("holdsQieId(address) [read]");
    // contract.js is generated — the model must not overwrite the binding.
    expect(p).toContain("do not output it");
  });
});
