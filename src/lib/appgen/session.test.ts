import { describe, expect, it } from "bun:test";
import {
  buildFeedback,
  stateBriefing,
  looksLikeReviewRequest,
  stripCodeBlocks,
  trimHistory,
  type BuildOutcome,
} from "./session";

describe("stateBriefing", () => {
  const files = { "app/index.html": "<html>", "app/app.js": "x" };

  it("sends the real code, not just the filenames", () => {
    // Names alone were the worst bug in this loop: the model could only work
    // from what it remembered writing, so a follow-up rebuilt whole files from
    // memory instead of editing what was there.
    const b = stateBriefing({ "app/index.html": "<html>hi</html>", "app/app.js": "const x = 1;" });
    expect(b).toContain("--- index.html ---");
    expect(b).toContain("<html>hi</html>");
    expect(b).toContain("--- app.js ---");
    expect(b).toContain("const x = 1;");
  });

  it("tells the model to edit what is there rather than start over", () => {
    expect(stateBriefing(files)).toContain("do not start over");
  });

  it("marks the generated binding as read-only", () => {
    // contract.js is regenerated from the deployment; a model rewrite would
    // silently repoint the app.
    const b = stateBriefing({ "app/contract.js": "export const CHAIN = {};" });
    expect(b).toContain("GENERATED");
    expect(b).toContain("never output it");
  });

  it("truncates a runaway file instead of dropping the whole briefing", () => {
    const huge = "x".repeat(40_000);
    const b = stateBriefing({ "app/app.js": huge });
    expect(b).toContain("characters omitted");
    expect(b.length).toBeLessThan(30_000);
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

describe("buildFeedback", () => {
  const outcome = (phases: Array<[string, boolean, string]>): BuildOutcome => ({
    ok: phases.every(([, ok]) => ok),
    phases: phases.map(([phase, ok, log]) => ({ phase, ok, log })),
    dist: null,
  });

  it("says nothing when the build passed", () => {
    expect(
      buildFeedback(
        outcome([
          ["install", true, ""],
          ["build", true, ""],
        ]),
      ),
    ).toBeNull();
  });

  it("reports only the first failure", () => {
    // Later phases never ran, and a lint error printed under a build error
    // buries the thing that has to be fixed first.
    const f = buildFeedback(
      outcome([
        ["install", true, "added 40 packages"],
        ["build", false, "Could not resolve ./missing.js"],
        ["test", false, "never ran"],
      ]),
    )!;
    expect(f).toContain("The build failed");
    expect(f).toContain("Could not resolve ./missing.js");
    expect(f).not.toContain("never ran");
  });

  it("names each kind of failure in terms the model can act on", () => {
    expect(buildFeedback(outcome([["lint", false, "no-undef"]]))).toContain(
      "The linter rejected the code",
    );
    expect(buildFeedback(outcome([["test", false, "1 failed"]]))).toContain(
      "The browser test failed",
    );
    expect(buildFeedback(outcome([["install", false, "E404"]]))).toContain(
      "Installing the dependencies failed",
    );
  });

  it("keeps the tail of a long log, where the error is", () => {
    const log = "noise\n".repeat(2000) + "ERROR: the actual problem";
    const f = buildFeedback(outcome([["build", false, log]]))!;
    expect(f).toContain("ERROR: the actual problem");
    expect(f.length).toBeLessThan(3200);
  });

  it("does not ask the model to fix an unavailable runner", () => {
    // Nothing is wrong with the app: there is nowhere to build it. Telling the
    // model to "fix" that would send it rewriting working code.
    const out: BuildOutcome = {
      ok: false,
      phases: [],
      dist: null,
      unavailable: "Builds are not configured on this deployment.",
    };
    expect(buildFeedback(out)).toBeNull();
  });
});

describe("trimHistory", () => {
  it("keeps what was said and drops the code that was said with it", () => {
    // The live files are supplied fresh every turn. Old copies in the
    // transcript only give the model versions to confuse itself with.
    const trimmed = trimHistory([
      { role: "user", content: "build a counter" },
      { role: "assistant", content: "Built it.\n\n```js app.js\nconst old = 1;\n```" },
    ]);
    expect(trimmed[1].content).toContain("Built it.");
    expect(trimmed[1].content).not.toContain("const old = 1;");
  });

  it("leaves the user's own words completely alone", () => {
    // What the user asked for is the memory worth keeping.
    const asked = "make it dark, and keep the ```code``` fences I pasted";
    expect(trimHistory([{ role: "user", content: asked }])[0].content).toBe(asked);
  });

  it("never leaves an assistant turn empty", () => {
    const trimmed = trimHistory([{ role: "assistant", content: "```js app.js\nx\n```" }]);
    expect(trimmed[0].content.length).toBeGreaterThan(0);
  });
});

describe("looksLikeReviewRequest", () => {
  it("recognises a short, direct request to look rather than touch", () => {
    for (const p of [
      "review the code",
      "audit this app",
      "can you check it over?",
      "any bugs?",
      "what's wrong with this",
      "sanity check please",
      "look this over",
    ]) {
      expect(looksLikeReviewRequest(p)).toBe(true);
    }
  });

  it("never intercepts a request to build or change something", () => {
    // The failure is asymmetric: missing a review costs one click on the
    // button; mistaking a build for a review means the app never gets written.
    for (const p of [
      "fix the layout",
      "add a dark mode",
      "review it and fix the bugs",
      "build a swap interface",
      "make it responsive",
      "create a portfolio page",
    ]) {
      expect(looksLikeReviewRequest(p)).toBe(false);
    }
  });

  it("does not fire because a spec happens to CONTAIN the word review", () => {
    // The bug this guards: "review modal" and "Review Swap" appear all over a
    // swap specification, and every one of them used to turn a build request
    // into a code review.
    expect(
      looksLikeReviewRequest(
        "build a crypto swap interface with a review modal summarising everything before confirming",
      ),
    ).toBe(false);
    expect(
      looksLikeReviewRequest("add a Review Swap button that opens a confirmation dialog"),
    ).toBe(false);
  });

  it("treats anything long as a specification, not a question", () => {
    const long = "review ".repeat(40);
    expect(long.length).toBeGreaterThan(120);
    expect(looksLikeReviewRequest(long)).toBe(false);
  });

  it("requires the review word to open the prompt", () => {
    expect(looksLikeReviewRequest("the modal needs a review step")).toBe(false);
    expect(looksLikeReviewRequest("review this")).toBe(true);
  });
});
