import { describe, expect, it } from "bun:test";
import { validateApp, issuesForModel } from "./validate";
import { generateApp } from "./generate";
import { blankScaffold } from "./prompt";
import { getTemplate } from "@/lib/data/templates";

const good = generateApp({
  abi: JSON.parse(getTemplate("qie-id-gate")!.abi),
  address: "0x31423638af5b8d2a9096b6ab58c62f07844bc461",
  contractName: "Gate",
  chainId: 1990,
  chainName: "QIE Mainnet",
  rpcUrl: "https://rpc1mainnet.qie.digital/",
  explorerUrl: "https://mainnet.qie.digital",
  nativeSymbol: "QIE",
});

const html = good["app/index.html"];

describe("validateApp", () => {
  it("passes what the deterministic generator produces", () => {
    expect(validateApp(good).filter((i) => i.fatal)).toHaveLength(0);
  });

  it("passes the blank scaffold", () => {
    expect(validateApp(blankScaffold()).filter((i) => i.fatal)).toHaveLength(0);
  });

  it("catches JSX — the usual reason a preview is blank", () => {
    const issues = validateApp({
      "app/index.html": html,
      "app/app.js": 'const App = () => { return (<div className="x">hi</div>); };',
    });
    expect(issues.some((i) => i.fatal)).toBe(true);
    expect(issues.map((i) => i.message).join(" ")).toContain("JSX");
  });

  it("catches an import the import map does not define", () => {
    const issues = validateApp({
      "app/index.html": html,
      "app/app.js": 'import React from "react";\nconsole.log(React);',
    });
    expect(issues.some((i) => i.message.includes('"react"'))).toBe(true);
  });

  it("allows mapped sub-paths and full URLs", () => {
    const issues = validateApp({
      "app/index.html": html,
      "app/app.js": [
        'import { useState } from "preact/hooks";',
        'import { html } from "htm/preact";',
        'import confetti from "https://esm.sh/canvas-confetti@1.9.3";',
        "console.log(useState, html, confetti);",
      ].join("\n"),
    });
    expect(issues.filter((i) => i.fatal)).toHaveLength(0);
  });

  it("catches a relative import of a file that was never written", () => {
    const issues = validateApp({
      "app/index.html": html,
      "app/app.js": 'import { x } from "./missing.js";\nconsole.log(x);',
    });
    expect(issues.some((i) => i.message.includes("./missing.js"))).toBe(true);
  });

  it("catches a missing mount point and a missing index.html", () => {
    expect(
      validateApp({ "app/index.html": "<html><body></body></html>", "app/app.js": "" }).some((i) =>
        i.message.includes("root"),
      ),
    ).toBe(true);
    expect(validateApp({ "app/app.js": "" })[0].message).toContain("no index.html");
  });

  it("summarises fatal issues for the model, and stays quiet when clean", () => {
    expect(issuesForModel(validateApp(good))).toBeNull();
    const msg = issuesForModel(
      validateApp({ "app/index.html": html, "app/app.js": 'import x from "nope";' }),
    );
    expect(msg).toContain("will not run");
    expect(msg).toContain("nope");
  });
});

describe("validateApp, vite target", () => {
  const vite = generateApp({
    abi: JSON.parse(getTemplate("qie-id-gate")!.abi),
    address: "0x31423638af5b8d2a9096b6ab58c62f07844bc461",
    contractName: "Gate",
    chainId: 1990,
    chainName: "QIE Mainnet",
    rpcUrl: "https://rpc1mainnet.qie.digital/",
    explorerUrl: "https://mainnet.qie.digital",
    nativeSymbol: "QIE",
    target: "vite",
  });

  it("accepts a generated Vite project", () => {
    // The no-build rules would reject this outright: no import map, and every
    // dependency imported bare.
    expect(validateApp(vite, "app", "vite")).toEqual([]);
  });

  it("does not demand an import map", () => {
    const issues = validateApp(vite, "app", "vite");
    expect(issues.map((i) => i.message).join(" ")).not.toContain("import map");
  });

  it("accepts bare imports and JSX, which a bundler handles", () => {
    const withJsx = {
      ...vite,
      "app/src/app.js": [
        'import { render } from "preact";',
        'import confetti from "canvas-confetti";',
        'export const A = () => <div className="x">hi</div>;',
      ].join("\n"),
    };
    expect(validateApp(withJsx, "app", "vite")).toEqual([]);
  });

  it("still catches an import of a file that was never written", () => {
    // The build does report this, a hundred lines later and phrased as a
    // rollup resolution failure.
    const broken = {
      ...vite,
      "app/src/app.js": 'import { thing } from "./nope.js";\nexport { thing };\n',
    };
    const issues = validateApp(broken, "app", "vite");
    expect(issues.some((i) => i.message.includes("./nope.js"))).toBe(true);
  });

  it("resolves relative imports against the importing file, not the app root", () => {
    // src/app.js importing ./contract.js means src/contract.js. Resolving that
    // against the app root reports a missing file that is sitting right there.
    expect(validateApp(vite, "app", "vite")).toEqual([]);
    const reachesUp = {
      ...vite,
      "app/src/app.js": 'import { CHAIN } from "../shared/chain.js";\nexport { CHAIN };\n',
      "app/shared/chain.js": "export const CHAIN = 1;\n",
    };
    expect(validateApp(reachesUp, "app", "vite")).toEqual([]);
  });

  it("still requires somewhere to mount", () => {
    const noRoot = { ...vite, "app/index.html": "<!doctype html><html><body></body></html>" };
    expect(validateApp(noRoot, "app", "vite").some((i) => i.fatal)).toBe(true);
  });
});

describe("an empty workspace is not a broken app", () => {
  it("reports nothing for a project with no files", () => {
    // A conversational turn leaves the workspace untouched. Validating it
    // produced "There is no index.html." for an app that was never built —
    // shown as a fixable error, which the user could do nothing about.
    expect(validateApp({}, "app")).toEqual([]);
  });

  it("still reports a missing index.html once there ARE files", () => {
    const issues = validateApp({ "app/app.js": "" }, "app");
    expect(issues.some((i) => i.message.includes("no index.html"))).toBe(true);
  });
});
