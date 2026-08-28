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
