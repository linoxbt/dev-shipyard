import { describe, expect, it } from "bun:test";
import {
  parseGeneratedFiles,
  parseDeletions,
  stripDeleteMarkers,
  blankScaffold,
  appBuilderSystemPrompt,
} from "./prompt";

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
      "ignored: no filename",
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
    // Above MAX_FILES (28): a real multi-service app is 15-20 files, so the cap
    // has to sit above that while still bounding a runaway reply.
    const many = Array.from({ length: 40 }, (_, i) => "```js f" + i + ".js\nx\n```").join("\n");
    expect(parseGeneratedFiles(many).length).toBeLessThanOrEqual(28);
    expect(parseGeneratedFiles(many).length).toBeGreaterThan(12);
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
    // contract.js is generated: the model must not overwrite the binding.
    expect(p).toContain("do not output it");
  });
});

describe("appBuilderSystemPrompt, build targets", () => {
  it("forbids npm and JSX when there is no build step", () => {
    const p = appBuilderSystemPrompt({});
    expect(p).toContain("NO npm install");
    expect(p).toContain("NO JSX");
    expect(p).toContain("import map");
  });

  it("allows npm and JSX when the project is really built", () => {
    // Telling a model "no npm install" in a project that is about to run npm
    // install produces a much worse app than it needs to be.
    const p = appBuilderSystemPrompt({ target: "vite" });
    expect(p).not.toContain("NO npm install");
    expect(p).not.toContain("import map");
    expect(p).toContain("JSX both work");
    expect(p).toContain("src/app.js");
  });

  it("tells the model its work will be linted and tested", () => {
    const p = appBuilderSystemPrompt({ target: "vite" });
    expect(p).toContain("eslint");
    expect(p).toContain("Playwright");
  });
});

// Removing a file is the one action in this pipeline that cannot be undone by
// running again, so the parser is stricter than the one for writes and the
// result goes through the policy gate before anything is deleted.
describe("parseDeletions", () => {
  it("reads a marker", () => {
    expect(parseDeletions('<delete path="app/old.js" />')).toEqual(["app/old.js"]);
  });

  it("adds the workspace prefix when the model leaves it off", () => {
    expect(parseDeletions('<delete path="old.js" />')).toEqual(["app/old.js"]);
  });

  it("accepts single quotes and a non-self-closing tag", () => {
    expect(parseDeletions("<delete path='old.js'>")).toEqual(["app/old.js"]);
  });

  it("refuses to escape the workspace", () => {
    expect(parseDeletions('<delete path="../../etc/passwd.js" />')).toEqual([]);
    expect(parseDeletions('<delete path="../app.js" />')).toEqual([]);
  });

  it("refuses an absolute path", () => {
    expect(parseDeletions('<delete path="/etc/hosts.js" />')).toEqual([]);
  });

  it("refuses a file type this builder does not own", () => {
    expect(parseDeletions('<delete path="deploy.sh" />')).toEqual([]);
  });

  it("never removes the generated contract binding", () => {
    // applyFiles already refuses to overwrite it; deleting it would repoint the
    // app just as effectively.
    expect(parseDeletions('<delete path="app/contract.js" />')).toEqual([]);
  });

  it("de-duplicates a repeated marker", () => {
    expect(parseDeletions('<delete path="old.js" /><delete path="old.js" />')).toEqual([
      "app/old.js",
    ]);
  });

  it("finds nothing in ordinary prose", () => {
    expect(parseDeletions("I deleted the old file and rewrote app.js.")).toEqual([]);
  });
});

describe("stripDeleteMarkers", () => {
  it("keeps the prose and drops the marker", () => {
    expect(stripDeleteMarkers('Removed it.\n<delete path="app/old.js" />')).toBe("Removed it.\n");
  });

  it("drops a marker the stream cut off mid-tag", () => {
    // A half-arrived marker must never render as text in the transcript.
    expect(stripDeleteMarkers('Removed it. <delete path="app/old')).toBe("Removed it.");
  });
});
