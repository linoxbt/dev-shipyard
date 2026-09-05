import { describe, expect, it } from "bun:test";
import { TOOLS } from "./tools";
import {
  DEFAULT_BUDGET,
  toolProtocol,
  budgetSpent,
  formatObservation,
  parseToolCalls,
  stripToolCalls,
} from "./loop";

describe("parseToolCalls", () => {
  it("reads a call and its arguments", () => {
    const calls = parseToolCalls('<tool name="read_file">{"path": "app/app.js"}</tool>');
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("read_file");
    expect(calls[0].args).toEqual({ path: "app/app.js" });
    expect(calls[0].malformed).toBe(false);
  });

  it("reads a call with no arguments", () => {
    const calls = parseToolCalls('<tool name="list_files"></tool>');
    expect(calls[0].args).toEqual({});
    expect(calls[0].malformed).toBe(false);
  });

  it("keeps several calls in the order they were written", () => {
    const calls = parseToolCalls(
      '<tool name="list_files"></tool>\n<tool name="search_files">{"query":"render"}</tool>',
    );
    expect(calls.map((c) => c.name)).toEqual(["list_files", "search_files"]);
  });

  it("marks a malformed payload instead of dropping the call", () => {
    // Dropping it silently would leave the model waiting for a result that
    // never comes. Flagged, it reaches preflight and comes back as a
    // validation error it can read and correct.
    const calls = parseToolCalls('<tool name="read_file">{not json}</tool>');
    expect(calls).toHaveLength(1);
    expect(calls[0].malformed).toBe(true);
  });

  it("treats a JSON array as malformed, since arguments are named", () => {
    const calls = parseToolCalls('<tool name="read_file">["app/app.js"]</tool>');
    expect(calls[0].malformed).toBe(true);
  });

  it("finds nothing in ordinary prose", () => {
    expect(parseToolCalls("I used a tool to read the file.")).toEqual([]);
  });

  it("ignores an unterminated call rather than half-running it", () => {
    expect(parseToolCalls('<tool name="read_file">{"path": "a.js"}')).toEqual([]);
  });
});

describe("stripToolCalls", () => {
  it("keeps the prose and drops the call", () => {
    expect(stripToolCalls('Let me look.\n<tool name="list_files"></tool>')).toBe("Let me look.\n");
  });

  it("drops a call the stream cut off mid-tag", () => {
    expect(stripToolCalls('Let me look. <tool name="read_f')).toBe("Let me look.");
  });
});

describe("budgetSpent", () => {
  it("allows work within both budgets", () => {
    expect(budgetSpent({ steps: 0, startedAt: 1000 }, DEFAULT_BUDGET, 1000).spent).toBe(false);
  });

  it("stops a model that will not stop looking things up", () => {
    const r = budgetSpent(
      { steps: DEFAULT_BUDGET.maxSteps, startedAt: 1000 },
      DEFAULT_BUDGET,
      1000,
    );
    expect(r.spent).toBe(true);
    expect(r.why).toContain("lookups");
  });

  it("stops on elapsed time even when few steps were used", () => {
    // Four reads and four full builds are the same number of steps and nothing
    // like the same wait, which is why time is budgeted separately.
    const r = budgetSpent({ steps: 1, startedAt: 0 }, DEFAULT_BUDGET, DEFAULT_BUDGET.maxMs + 1);
    expect(r.spent).toBe(true);
    expect(r.why).toContain("time");
  });
});

describe("formatObservation", () => {
  it("names the tool the result came from", () => {
    expect(formatObservation("read_file", "contents")).toContain("read_file");
    expect(formatObservation("read_file", "contents")).toContain("contents");
  });
});

describe("toolProtocol", () => {
  it("mentions every tool in the registry", () => {
    // The bug this exists to prevent: push_to_github was registered,
    // classified and covered by tests while the prompt still listed five
    // tools, so the model answered a request to push with "I don't have the
    // ability to perform GitHub account actions". It was right: nothing had
    // told it otherwise. A tool the prompt does not name does not exist.
    const text = toolProtocol();
    for (const name of Object.keys(TOOLS)) {
      expect(text).toContain(name);
    }
  });

  it("separates what the agent does from what it may only ask for", () => {
    const text = toolProtocol();
    const asking = text.indexOf("Asking for something outside the project");
    expect(asking).toBeGreaterThan(-1);
    // The outward tools belong on the asking side, not the doing side.
    expect(text.indexOf("push_to_github")).toBeGreaterThan(asking);
    expect(text.indexOf("publish_app")).toBeGreaterThan(asking);
    expect(text.indexOf("read_file")).toBeLessThan(asking);
  });

  it("tells the model to ask rather than refuse", () => {
    expect(toolProtocol()).toContain("do not");
    expect(toolProtocol()).toContain("unable to");
  });
});
