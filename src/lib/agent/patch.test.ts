import { describe, expect, it } from "bun:test";
import { applyPatch, parsePatch } from "./patch";

const FILE = `function greet(name) {
  return "Hello, " + name + "!";
}

module.exports = { greet };
`;

describe("parsing a unified diff", () => {
  it("reads hunk headers and line kinds", () => {
    const parsed = parsePatch(`--- a/x.js
+++ b/x.js
@@ -1,3 +1,4 @@
 function greet(name) {
+  if (!name) throw new Error("name is required");
   return "Hello, " + name + "!";
 }`);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].oldStart).toBe(1);
    expect(parsed.hunks[0].lines.filter((l) => l.kind === "+")).toHaveLength(1);
  });

  it("rejects something that is not a diff, rather than silently doing nothing", () => {
    const parsed = parsePatch("please add a null check");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain("not a unified diff");
  });
});

describe("applying a patch", () => {
  it("applies a clean hunk", () => {
    const result = applyPatch(
      FILE,
      `@@ -1,3 +1,4 @@
 function greet(name) {
+  if (!name) throw new Error("name is required");
   return "Hello, " + name + "!";
 }`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.content).toContain('throw new Error("name is required")');
      expect(result.content).toContain("module.exports");
    }
  });

  it("still applies when the file has drifted from where the diff says", () => {
    // The line numbers in a diff are a hint, not an address: the file has
    // usually moved since the model read it.
    const drifted = `// added later\n// and another\n// and another\n// and one more\n${FILE}`;
    const result = applyPatch(
      drifted,
      `@@ -1,3 +1,4 @@
 function greet(name) {
+  if (!name) throw new Error("name is required");
   return "Hello, " + name + "!";
 }`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toContain("name is required");
  });

  it("refuses a hunk whose context is not in the file", () => {
    const result = applyPatch(
      FILE,
      `@@ -1,3 +1,4 @@
 function farewell(name) {
+  console.log("bye");
   return "Goodbye";
 }`,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("did not match");
  });

  it("leaves the file untouched when a LATER hunk fails", () => {
    // The property that matters. A half-applied patch leaves a file that is
    // neither version, while the model is told the edit failed.
    const patch = `@@ -1,2 +1,3 @@
 function greet(name) {
+  // first hunk applies fine
   return "Hello, " + name + "!";
@@ -40,2 +41,3 @@
 this context does not exist
+never applied
 nor does this`;
    const result = applyPatch(FILE, patch);
    expect(result.ok).toBe(false);
    // Nothing partial came back, so there is nothing for a caller to write.
    if (!result.ok) expect(result).not.toHaveProperty("content");
  });

  it("applies several hunks and keeps later offsets right", () => {
    const long = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    const result = applyPatch(
      long,
      `@@ -2,1 +2,2 @@
 line 2
+inserted near the top
@@ -30,1 +31,2 @@
 line 30
+inserted near the bottom`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const lines = result.content.split("\n");
      // The second hunk must land after line 30, not be shifted by the first.
      expect(lines[2]).toBe("inserted near the top");
      expect(lines[lines.indexOf("line 30") + 1]).toBe("inserted near the bottom");
    }
  });

  it("preserves whether the file ended with a newline", () => {
    const withNewline = applyPatch("a\nb\n", `@@ -1,2 +1,3 @@\n a\n+inserted\n b`);
    expect(withNewline.ok && withNewline.content.endsWith("\n")).toBe(true);

    const without = applyPatch("a\nb", `@@ -1,2 +1,3 @@\n a\n+inserted\n b`);
    expect(without.ok && without.content.endsWith("\n")).toBe(false);
  });

  it("handles a pure deletion", () => {
    const result = applyPatch(
      FILE,
      `@@ -1,3 +1,2 @@
 function greet(name) {
-  return "Hello, " + name + "!";
 }`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).not.toContain("Hello, ");
  });
});

describe("counting the change", () => {
  it("reports a one-for-one swap as an addition and a removal, not as nothing", () => {
    // A net-lines count calls this "+0", which reads as "the patch did nothing".
    const result = applyPatch("a\nb\nc\n", "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
    expect(result.content).toBe("a\nB\nc\n");
  });

  it("counts across several hunks", () => {
    const original = "1\n2\n3\n4\n5\n6\n7\n8\n";
    const result = applyPatch(
      original,
      "@@ -1,3 +1,4 @@\n 1\n+1.5\n 2\n 3\n@@ -6,3 +7,2 @@\n 6\n-7\n 8\n",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.added).toBe(1);
    expect(result.removed).toBe(1);
  });
});

describe("the trailing newline", () => {
  it("applies a patch in the shape git actually emits", () => {
    // `git diff` output ends with a newline. Treating that terminator as a
    // line made the last hunk expect an empty line that is not in the file.
    const withNewline = applyPatch("a\nb\nc\n", "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n");
    const without = applyPatch("a\nb\nc\n", "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c");
    expect(withNewline.ok).toBe(true);
    expect(without.ok).toBe(true);
    if (!withNewline.ok || !without.ok) return;
    expect(withNewline.content).toBe(without.content);
  });

  it("still reads an interior blank line as context", () => {
    const result = applyPatch("a\n\nb\n", "@@ -1,3 +1,3 @@\n a\n\n-b\n+B\n");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.content).toBe("a\n\nB\n");
  });
});
