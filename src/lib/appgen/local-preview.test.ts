import { describe, expect, it } from "bun:test";
import { filesUnder, localPreviewPlan } from "./local-preview";

describe("what the browser can preview on its own", () => {
  it("shows a marketplace app that lives in app/ as it is", () => {
    const files = { "app/index.html": "<h1>hi</h1>", "app/app.js": "", "app/README.md": "" };
    expect(localPreviewPlan(files)).toEqual({ kind: "static", dir: "app" });
    expect(localPreviewPlan({ "index.html": "", "styles.css": "" })).toEqual({
      kind: "static",
      dir: "",
    });
  });

  it("leaves a project with a build script to the runner, as the runner would", () => {
    const vite = {
      "package.json": JSON.stringify({ scripts: { build: "vite build" } }),
      "index.html": "",
    };
    expect(localPreviewPlan(vite)).toEqual({ kind: "build", dir: "" });
    const nested = {
      "web/package.json": JSON.stringify({ scripts: { build: "vite build" } }),
      "web/index.html": "",
      "contracts/Token.sol": "",
    };
    expect(localPreviewPlan(nested)).toEqual({ kind: "build", dir: "web" });
    // A package.json without a build script does not stop a plain page.
    expect(
      localPreviewPlan({ "package.json": JSON.stringify({ name: "x" }), "index.html": "" }),
    ).toEqual({ kind: "static", dir: "" });
  });

  it("has nothing to show for contracts and scripts", () => {
    expect(localPreviewPlan({ "src/Token.sol": "", "README.md": "" })).toEqual({ kind: "none" });
    expect(localPreviewPlan({})).toEqual({ kind: "none" });
  });

  it("takes a folder's files for publishing", () => {
    expect(
      filesUnder({ "app/index.html": "a", "app/x/y.js": "b", "README.md": "c" }, "app"),
    ).toEqual({
      "index.html": "a",
      "x/y.js": "b",
    });
  });
});
