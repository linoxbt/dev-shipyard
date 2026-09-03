import { describe, expect, it } from "bun:test";
import { runTurn } from "./session";
import { blankScaffold } from "./prompt";
import { DEFAULT_BUDGET } from "@/lib/agent/loop";

// The loop as it actually runs inside a turn: propose a lookup, get an
// observation, then answer. These use a scripted model so the assertions are
// about the loop rather than about what a real model decides to do.

const SCAFFOLD = blankScaffold("app", "esm");
const PROJECT = { ...SCAFFOLD, "app/old.js": "export const secretMarker = 42;\n" };

function filesReply(): string {
  return [
    "Done.",
    "",
    ...Object.entries(SCAFFOLD).flatMap(([path, content]) => [
      "```" + path.split(".").pop() + " " + path,
      content,
      "```",
      "",
    ]),
  ].join("\n");
}

/** Replies in order, repeating the last one once the script runs out. */
function scriptedChat(script: string[], seen: string[][]) {
  let i = 0;
  return async (opts: {
    system: string;
    messages: Array<{ role: string; content: string }>;
    signal?: AbortSignal;
    onDelta: (c: string) => void;
  }): Promise<string> => {
    seen.push(opts.messages.map((m) => m.content));
    const reply = script[Math.min(i, script.length - 1)];
    i++;
    for (const ch of reply) opts.onDelta(ch);
    return reply;
  };
}

describe("looking before writing", () => {
  it("answers a lookup with the file's real contents, then writes", async () => {
    const seen: string[][] = [];
    const result = await runTurn({
      prompt: "what is in old.js? then rebuild the app",
      files: PROJECT,
      history: [],
      mode: "build",
      chat: scriptedChat(
        ['Let me look.\n<tool name="read_file">{"path": "app/old.js"}</tool>', filesReply()],
        seen,
      ),
    });

    // The second call must carry the observation, and it must contain the
    // file's actual contents rather than a summary of them.
    const second = seen[1].join("\n");
    expect(second).toContain("Result of read_file");
    expect(second).toContain("secretMarker");
    expect(result.changed.length).toBeGreaterThan(0);
  });

  it("does not spend a repair round on a lookup", async () => {
    // Repair rounds exist to fix a broken build. A turn that looks something up
    // three times must still have its full repair allowance afterwards.
    const seen: string[][] = [];
    await runTurn({
      prompt: "look around then build",
      files: PROJECT,
      history: [],
      mode: "build",
      chat: scriptedChat(
        [
          '<tool name="list_files"></tool>',
          '<tool name="search_files">{"query":"secretMarker"}</tool>',
          '<tool name="read_file">{"path":"app/old.js"}</tool>',
          filesReply(),
        ],
        seen,
      ),
    });
    // Three lookups plus the answer: all four calls happened, which they could
    // not have if lookups consumed the two repair rounds.
    expect(seen.length).toBeGreaterThanOrEqual(4);
  });

  it("stops a model that will not stop looking things up", async () => {
    const seen: string[][] = [];
    await runTurn({
      prompt: "look forever",
      files: PROJECT,
      history: [],
      mode: "build",
      chat: scriptedChat(['<tool name="list_files"></tool>'], seen),
    });
    // Bounded by the lookup budget plus the repair rounds, not unbounded.
    expect(seen.length).toBeLessThanOrEqual(DEFAULT_BUDGET.maxSteps + MAX_ROUNDS_SLACK);
    const last = seen.at(-1)!.join("\n");
    expect(last).toContain("lookups");
  });

  it("puts every call through the gate", async () => {
    const seen: string[][] = [];
    const proposed: string[] = [];
    await runTurn({
      prompt: "read it",
      files: PROJECT,
      history: [],
      mode: "build",
      chat: scriptedChat(
        ['<tool name="read_file">{"path":"app/old.js"}</tool>', filesReply()],
        seen,
      ),
      gate: (call) => {
        proposed.push(call.name);
        return { ok: true };
      },
    });
    expect(proposed).toContain("read_file");
  });

  it("reports a refused lookup instead of running it", async () => {
    const seen: string[][] = [];
    await runTurn({
      prompt: "read it",
      files: PROJECT,
      history: [],
      mode: "build",
      chat: scriptedChat(
        ['<tool name="read_file">{"path":"app/old.js"}</tool>', filesReply()],
        seen,
      ),
      gate: (call) =>
        call.name === "read_file" ? { ok: false, message: "Reading is off." } : { ok: true },
    });
    // Assert on the observation itself, not the whole prompt: the briefing
    // carries every file's contents, so searching the prompt for the file body
    // proves nothing about whether the lookup ran.
    const observation = seen[1].at(-1)!;
    expect(observation).toContain("Reading is off.");
    // The refusal stands in for the result rather than sitting alongside it.
    expect(observation).not.toContain("secretMarker");
  });

  it("tells the model when a lookup's arguments were not usable", async () => {
    const seen: string[][] = [];
    await runTurn({
      prompt: "read it",
      files: PROJECT,
      history: [],
      mode: "build",
      chat: scriptedChat(['<tool name="read_file">{not json}</tool>', filesReply()], seen),
    });
    expect(seen[1].join("\n")).toContain("not a JSON object");
  });

  it("refuses to silently drop files that were mixed with a lookup", async () => {
    const seen: string[][] = [];
    const result = await runTurn({
      prompt: "do both",
      files: PROJECT,
      history: [],
      mode: "build",
      chat: scriptedChat(['<tool name="list_files"></tool>\n' + filesReply(), filesReply()], seen),
    });
    // Told, not dropped in silence: the alternative leaves the model believing
    // it wrote something it did not.
    expect(seen[1].join("\n")).toContain("NOT applied");
    void result;
  });

  it("never shows the raw call in the transcript", async () => {
    const streamed: string[] = [];
    const result = await runTurn({
      prompt: "read it",
      files: PROJECT,
      history: [],
      mode: "build",
      chat: scriptedChat(
        ['Looking.\n<tool name="read_file">{"path":"app/old.js"}</tool>', filesReply()],
        [],
      ),
      onProse: (t) => streamed.push(t),
    });
    for (const t of streamed) expect(t).not.toContain("<tool");
    expect(result.reply).not.toContain("<tool");
  });
});

/** Repair rounds the turn may still take after the lookup budget is spent. */
const MAX_ROUNDS_SLACK = 4;
