import { describe, expect, it } from "bun:test";
import { stateBriefing, stripCodeBlocks } from "./session";

describe("stateBriefing", () => {
  const files = { "app/index.html": "<html>", "app/app.js": "x" };

  it("tells the model which files exist", () => {
    expect(stateBriefing(files)).toContain("index.html, app.js");
  });

  it("hands over the preview's actual errors, not just 'it is blank'", () => {
    const b = stateBriefing(files, [
      { kind: "error", message: "html is not defined", source: "app.js", line: 12 },
    ]);
    expect(b).toContain("html is not defined");
    expect(b).toContain("app.js:12");
    expect(b).toContain("why it looks blank");
  });

  it("de-duplicates repeated errors so one loop cannot fill the prompt", () => {
    const same = { kind: "error" as const, message: "boom" };
    const b = stateBriefing(files, [same, same, same, same, same, same]);
    expect(b.match(/boom/g)).toHaveLength(1);
  });

  it("says nothing about errors when there are none", () => {
    expect(stateBriefing(files)).not.toContain("reported these errors");
  });
});

describe("stripCodeBlocks", () => {
  it("keeps the prose and drops the code, for the transcript", () => {
    expect(stripCodeBlocks("Built a counter.\n\n```js app.js\nx\n```")).toBe("Built a counter.");
  });

  it("survives a reply that is only code", () => {
    expect(stripCodeBlocks("```js app.js\nx\n```")).toBe("");
  });
});
