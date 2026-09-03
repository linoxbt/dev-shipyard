import { describe, expect, it } from "bun:test";
import { listFiles, readFile, resolvePath, runInspection, searchFiles } from "./tool-exec";

const ctx = {
  dir: "app",
  files: {
    "app/index.html": '<div id="root"></div>',
    "app/app.js": "import { render } from 'htm/preact';\nrender(App, root);\n",
    "app/styles.css": ":root { color: red }",
  },
};

describe("resolvePath", () => {
  it("accepts the path with the workspace prefix", () => {
    expect(resolvePath("app/app.js", ctx)).toBe("app/app.js");
  });

  it("accepts it without, since that is how the model writes them", () => {
    expect(resolvePath("app.js", ctx)).toBe("app/app.js");
  });

  it("returns null for something that is not there", () => {
    expect(resolvePath("nope.js", ctx)).toBeNull();
  });
});

describe("listFiles", () => {
  it("shows the paths the model writes, not the stored ones", () => {
    const out = listFiles(ctx);
    expect(out).toContain("app.js");
    expect(out).not.toContain("app/app.js");
  });

  it("says so when there is nothing", () => {
    expect(listFiles({ dir: "app", files: {} })).toContain("empty");
  });
});

describe("readFile", () => {
  it("returns the contents", () => {
    expect(readFile("app.js", ctx)).toContain("render(App, root)");
  });

  it("names what IS there when the guess was wrong", () => {
    // A dead end makes the model guess again; a correction lets it recover.
    const out = readFile("main.js", ctx);
    expect(out).toContain("no file at main.js");
    expect(out).toContain("app.js");
  });
});

describe("searchFiles", () => {
  it("reports path and line number", () => {
    expect(searchFiles("render", ctx)).toMatch(/app\.js:\d+:/);
  });

  it("is case-insensitive", () => {
    expect(searchFiles("RENDER", ctx)).toContain("app.js");
  });

  it("says so rather than returning nothing", () => {
    expect(searchFiles("zzzz", ctx)).toContain("No match");
  });

  it("caps a runaway result instead of filling the prompt with it", () => {
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => [`app/f${i}.js`, "hit\n".repeat(10)]),
    );
    const out = searchFiles("hit", { dir: "app", files: many });
    expect(out).toContain("more matches not shown");
    expect(out.split("\n").length).toBeLessThan(60);
  });
});

describe("runInspection", () => {
  it("hands back null for anything it does not own", () => {
    // write_file and run_build are deliberately not here: this file only looks.
    expect(runInspection("write_file", { path: "a.js" }, ctx)).toBeNull();
    expect(runInspection("run_build", {}, ctx)).toBeNull();
  });

  it("dispatches the read-only tools", () => {
    expect(runInspection("list_files", {}, ctx)).toContain("app.js");
    expect(runInspection("read_file", { path: "app.js" }, ctx)).toContain("render");
    expect(runInspection("search_files", { query: "root" }, ctx)).toContain("index.html");
  });
});
