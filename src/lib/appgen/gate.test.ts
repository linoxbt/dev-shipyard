import { describe, expect, it } from "bun:test";
import { runTurn, type GateCall, type GateDecision } from "./session";
import { blankScaffold } from "./prompt";
import { preflight } from "@/lib/agent/tools";

// The gate is the single point every effect a turn has passes through. These
// tests are about the WIRING rather than the policy: that nothing is written
// without the gate seeing it first, that a refusal reaches the model instead of
// vanishing, and that a turn with no gate behaves exactly as it always did.

/** A model that answers with a scaffold that actually validates.
 *
 *  It has to validate: runTurn only reaches the build step when static checks
 *  find nothing, so a stub app with issues makes every build assertion below
 *  pass for the wrong reason. Hand-written markup got that wrong once already. */
const SCAFFOLD = blankScaffold("app", "esm");

function stubChat(seen: { systems: string[]; messages: string[][] }) {
  return async (opts: {
    system: string;
    messages: Array<{ role: string; content: string }>;
    signal?: AbortSignal;
    onDelta: (c: string) => void;
  }): Promise<string> => {
    seen.systems.push(opts.system);
    seen.messages.push(opts.messages.map((m) => m.content));
    return [
      "Built it.",
      "",
      ...Object.entries(SCAFFOLD).flatMap(([path, content]) => [
        "```" + path.split(".").pop() + " " + path,
        content,
        "```",
        "",
      ]),
    ].join("\n");
  };
}

function recorder() {
  const seen: { systems: string[]; messages: string[][] } = { systems: [], messages: [] };
  return { seen, chat: stubChat(seen) };
}

describe("runTurn gate", () => {
  it("writes files when no gate is supplied, exactly as before", async () => {
    const { chat } = recorder();
    const result = await runTurn({
      prompt: "build it",
      files: {},
      history: [],
      mode: "build",
      chat,
    });
    expect(result.files["app/index.html"]).toContain('<div id="root">');
    // The parser trims trailing whitespace off a fenced body, so compare trimmed.
    expect(result.files["app/app.js"]).toBe(SCAFFOLD["app/app.js"].trimEnd());
    expect(result.changed).toContain("app/app.js");
  });

  it("shows the gate every file before any of them is written", async () => {
    const { chat } = recorder();
    const offered: string[] = [];
    await runTurn({
      prompt: "build it",
      files: {},
      history: [],
      mode: "build",
      chat,
      gate: (call: GateCall): GateDecision => {
        if (call.name === "write_file") offered.push(String(call.args.path));
        return { ok: true };
      },
    });
    expect(offered).toContain("app/index.html");
    expect(offered).toContain("app/app.js");
  });

  it("does not write a file the gate refuses", async () => {
    const { chat } = recorder();
    const result = await runTurn({
      prompt: "build it",
      files: {},
      history: [],
      mode: "build",
      chat,
      gate: (call): GateDecision =>
        call.args.path === "app/app.js"
          ? { ok: false, message: "app.js is off limits." }
          : { ok: true },
    });
    expect(result.files["app/index.html"]).toBeDefined();
    // The refused write must not appear, and must not be reported as changed.
    expect(result.files["app/app.js"]).toBeUndefined();
    expect(result.changed).not.toContain("app/app.js");
  });

  it("tells the model why a write was refused, so it can work around it", async () => {
    const { seen, chat } = recorder();
    await runTurn({
      prompt: "build it",
      files: {},
      history: [],
      mode: "build",
      chat,
      gate: (call): GateDecision =>
        call.args.path === "app/app.js"
          ? { ok: false, message: "app.js is off limits." }
          : { ok: true },
    });
    // A refusal has to produce another round carrying the reason, otherwise the
    // model silently believes it wrote a file that does not exist.
    expect(seen.messages.length).toBeGreaterThan(1);
    const followUp = seen.messages.at(-1)!.join("\n");
    expect(followUp).toContain("were refused");
    expect(followUp).toContain("app.js is off limits.");
  });

  it("never runs the build when the gate refuses it", async () => {
    const { chat } = recorder();
    let built = 0;
    const result = await runTurn({
      prompt: "build it",
      files: {},
      history: [],
      mode: "build",
      chat,
      gate: (call): GateDecision =>
        call.name === "run_build" ? { ok: false, message: "Builds are paused." } : { ok: true },
      runBuild: async () => {
        built++;
        return { ok: true } as never;
      },
    });
    expect(built).toBe(0);
    expect(result.build).toBeUndefined();
  });

  it("runs the build when the gate allows it", async () => {
    const { chat } = recorder();
    let built = 0;
    await runTurn({
      prompt: "build it",
      files: {},
      history: [],
      mode: "build",
      chat,
      gate: () => ({ ok: true }),
      runBuild: async () => {
        built++;
        return { ok: true } as never;
      },
    });
    expect(built).toBe(1);
  });
});

describe("the calls the runner actually proposes", () => {
  // The runner's gate forwards straight into preflight, so these are the exact
  // shapes that path produces. If the argument names drift, the policy engine
  // stops seeing real resources and the whole boundary quietly goes slack.
  const ctx = { taskId: "t1", userId: "0xabc", projectId: "p1" as const };

  it("allows an ordinary file write", () => {
    const r = preflight(
      { id: "a1", name: "write_file", args: { path: "app/app.js", content: "x" } },
      ctx,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.action.resources).toEqual(["app/app.js"]);
  });

  it("allows a dev build", () => {
    expect(preflight({ id: "a2", name: "run_build", args: {} }, ctx).ok).toBe(true);
  });

  it("refuses a path that escapes the workspace", () => {
    const r = preflight(
      { id: "a3", name: "write_file", args: { path: "../../etc/passwd", content: "x" } },
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.reason).toBe("invalid_arguments");
  });

  it("refuses an absolute path", () => {
    const r = preflight(
      { id: "a4", name: "write_file", args: { path: "/etc/passwd", content: "x" } },
      ctx,
    );
    expect(r.ok).toBe(false);
  });

  it("refuses a tool name the registry does not define", () => {
    const r = preflight({ id: "a5", name: "run_shell", args: { cmd: "rm -rf /" } }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection.reason).toBe("unknown_tool");
  });
});

// Deletion is the reason the gate exists. A write that turns out wrong can be
// written again; a delete cannot, which is why file.delete is classified high
// and an ordinary turn stops to ask.
function deletingChat(path: string) {
  return async (opts: {
    system: string;
    messages: Array<{ role: string; content: string }>;
    signal?: AbortSignal;
    onDelta: (c: string) => void;
  }): Promise<string> => {
    void opts;
    return `Removed it.\n<delete path="${path}" />`;
  };
}

describe("deleting a file", () => {
  const withExtra = { ...SCAFFOLD, "app/old.js": "// superseded" };

  it("removes the file when the gate allows it", async () => {
    const result = await runTurn({
      prompt: "remove the old file",
      files: withExtra,
      history: [],
      mode: "build",
      chat: deletingChat("app/old.js"),
      gate: () => ({ ok: true }),
    });
    expect(result.files["app/old.js"]).toBeUndefined();
    expect(result.removed).toContain("app/old.js");
    // Kept apart from `changed`: "updated" and "deleted" are not the same
    // sentence.
    expect(result.changed).not.toContain("app/old.js");
  });

  it("proposes it as delete_file, not as a write", async () => {
    const seen: string[] = [];
    await runTurn({
      prompt: "remove the old file",
      files: withExtra,
      history: [],
      mode: "build",
      chat: deletingChat("app/old.js"),
      gate: (call) => {
        seen.push(`${call.name}:${String(call.args.path ?? "")}`);
        return { ok: true };
      },
    });
    expect(seen).toContain("delete_file:app/old.js");
  });

  it("keeps the file when the gate refuses", async () => {
    const result = await runTurn({
      prompt: "remove the old file",
      files: withExtra,
      history: [],
      mode: "build",
      chat: deletingChat("app/old.js"),
      gate: (call) =>
        call.name === "delete_file" ? { ok: false, message: "Not allowed." } : { ok: true },
    });
    expect(result.files["app/old.js"]).toBe("// superseded");
    expect(result.removed).toEqual([]);
  });

  it("reaches the gate even when the reply contains no files at all", async () => {
    // The reply is a marker and one sentence. Before this, a delete-only reply
    // fell into the "you produced no files" branch and the deletion silently
    // never happened.
    let asked = false;
    await runTurn({
      prompt: "remove the old file",
      files: withExtra,
      history: [],
      mode: "build",
      chat: deletingChat("app/old.js"),
      gate: (call) => {
        if (call.name === "delete_file") asked = true;
        return { ok: true };
      },
    });
    expect(asked).toBe(true);
  });

  it("ignores a marker for a file that is not there", async () => {
    const result = await runTurn({
      prompt: "remove a file that does not exist",
      files: withExtra,
      history: [],
      mode: "build",
      chat: deletingChat("app/never-existed.js"),
      gate: () => ({ ok: true }),
    });
    expect(result.removed).toEqual([]);
  });

  it("strips the marker out of the transcript", async () => {
    const result = await runTurn({
      prompt: "remove the old file",
      files: withExtra,
      history: [],
      mode: "build",
      chat: deletingChat("app/old.js"),
      gate: () => ({ ok: true }),
    });
    expect(result.reply).not.toContain("<delete");
    expect(result.reply).toContain("Removed it.");
  });
});

describe("the policy engine's verdict on a delete", () => {
  it("will not delete a file without asking", () => {
    const r = preflight(
      { id: "d1", name: "delete_file", args: { path: "app/old.js" } },
      { taskId: "t1", userId: "0xabc", projectId: "p1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.rejection.reason).toBe("needs_authorization");
      if (r.rejection.reason === "needs_authorization") {
        expect(r.rejection.verdict.riskLevel).toBe("high");
        // The action travels with the rejection so the grant is fingerprinted
        // from what was actually checked.
        expect(r.rejection.action.resources).toEqual(["app/old.js"]);
      }
    }
  });
});
