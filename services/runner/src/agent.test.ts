import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The state directory is read when agent.ts is first evaluated, so it has to be
// set before the import. That is also what makes this a real restart test: the
// module below has never seen the job it is about to be handed.
const STATE_DIR = mkdtempSync(join(tmpdir(), "devstation-runner-"));
process.env.RUNNER_STATE_DIR = STATE_DIR;
// No model key, so a resumed turn fails immediately instead of reaching the
// network. Everything asserted here is decided before that happens.
process.env.OPENROUTER_API_KEY = "";
process.env.AI_API_KEY = "";

const agent = await import("./agent");
const { createDecisionRequest, setDecisionStore } =
  await import("../../../src/lib/agent/decisions");
const { inspectSequence } = await import("../../../src/lib/agent/events");
const { getGrant, issueGrant, setGrantStore } =
  await import("../../../src/lib/agent/authorization");
const { fileStore } = await import("../../../src/lib/agent/store");

const AGENT_DIR = join(STATE_DIR, "agent");

beforeAll(() => {
  mkdirSync(AGENT_DIR, { recursive: true });
  // The production wiring, not a hand-rolled equivalent. Pointing the stores
  // at temp files by hand is exactly what hid the sweeper bug: it tested the
  // module and not the path the runner actually takes.
  agent.initAgentStores();
  void setGrantStore;
  void setDecisionStore;
  void fileStore;
});

afterAll(() => {
  rmSync(STATE_DIR, { recursive: true, force: true });
});

describe("the audit trail", () => {
  it("records the question, the answer and the grant, in order", () => {
    const request = writePausedJob("agent-audit-1");
    agent.answerAgentDecision({
      jobId: "agent-audit-1",
      requestId: request.id,
      clientRequestId: "audit-click",
      selectedOptionIds: [agent.APPROVE_OPTION],
    });
    const events = agent.getAgentJob("agent-audit-1")!.log.events;
    const types = events.map((e) => e.type);
    expect(types).toContain("agent.decision.received");
    expect(types).toContain("agent.authorization.requested");

    // The trail has to say WHAT was approved, not merely that something was.
    const granted = events.find((e) => e.type === "agent.authorization.requested")!;
    expect(granted.payload.operation).toBe("file.delete");
    expect(granted.payload.resources).toEqual(["app/old.js"]);
    expect(String(granted.payload.fingerprint)).toHaveLength(32);
  });

  it("records a refusal as its own outcome", () => {
    const request = writePausedJob("agent-audit-2");
    agent.answerAgentDecision({
      jobId: "agent-audit-2",
      requestId: request.id,
      clientRequestId: "audit-no",
      selectedOptionIds: [agent.DECLINE_OPTION],
    });
    const events = agent.getAgentJob("agent-audit-2")!.log.events;
    const denied = events.find((e) => e.type === "agent.authorization.denied");
    expect(denied).toBeDefined();
    expect(denied!.payload.reason).toBe("declined_by_user");
    // And nothing claims a grant was issued.
    expect(events.some((e) => e.type === "agent.authorization.requested")).toBe(false);
  });

  it("continues the sequence across a restart instead of starting again", () => {
    // The job outlives the process: an answer can arrive in one runner and the
    // turn it resumes finish in another. Two events numbered 12 would make the
    // trail unreadable exactly when it matters.
    const request = writePausedJob("agent-audit-3");
    agent.answerAgentDecision({
      jobId: "agent-audit-3",
      requestId: request.id,
      clientRequestId: "audit-seq",
      selectedOptionIds: [agent.DECLINE_OPTION],
    });
    const events = agent.getAgentJob("agent-audit-3")!.log.events;
    const sequences = events.map((e) => e.sequence);
    expect(sequences.length).toBeGreaterThan(1);
    expect(inspectSequence(sequences).ok).toBe(true);
    // Strictly increasing by one, which is what makes a gap detectable.
    expect(sequences).toEqual(sequences.map((_, i) => sequences[0] + i));
  });

  it("keeps no prose or file contents in the trail", () => {
    const request = writePausedJob("agent-audit-4");
    agent.answerAgentDecision({
      jobId: "agent-audit-4",
      requestId: request.id,
      clientRequestId: "audit-quiet",
      selectedOptionIds: [agent.DECLINE_OPTION],
    });
    const serialised = JSON.stringify(agent.getAgentJob("agent-audit-4")!.log.events);
    // Prose and status change on every streamed chunk. Recording them would
    // bury the decisions under thousands of entries that answer nothing anyone
    // would ask of an audit trail.
    expect(serialised).not.toContain("agent.message");
    expect(serialised.length).toBeLessThan(4000);
  });
});

describe("the sweeper and the security stores", () => {
  it("does not delete the grant store when a job starts", () => {
    // It used to. Grants and decisions sat in the same directory as the jobs,
    // and sweep() treats every .json there as a job: an array has no
    // updatedAt, so it defaulted to 0 and read as older than the 24h TTL. The
    // first job started after any approval wiped every stored grant, and no
    // unit test saw it because they all use their own temp files.
    const grant = issueGrant({
      taskId: "sweep-check",
      userId: "0xowner",
      action: {
        actionId: "a1",
        taskId: "sweep-check",
        userId: "0xowner",
        operation: "file.delete",
        resources: ["app/old.js"],
        environment: "development",
        projectId: "p1",
      },
      riskLevel: "high",
    });
    agent.sweep();
    expect(getGrant(grant.id)).toBeDefined();
    expect(existsSync(join(STATE_DIR, "security", "grants.json"))).toBe(true);
  });

  it("keeps the stores outside the directory it sweeps", () => {
    const swept = readdirSync(AGENT_DIR);
    expect(swept).not.toContain("grants.json");
    expect(swept).not.toContain("decisions.json");
  });
});

describe("canMovePhase", () => {
  it("lets a task pause and come back", () => {
    expect(agent.canMovePhase("running", "awaiting_decision")).toBe(true);
    expect(agent.canMovePhase("awaiting_decision", "running")).toBe(true);
  });

  it("refuses to drag a finished task back into running", () => {
    // The move a race between the turn completing and an answer arriving
    // would attempt.
    expect(agent.canMovePhase("done", "running")).toBe(false);
    expect(agent.canMovePhase("cancelled", "running")).toBe(false);
    expect(agent.canMovePhase("error", "running")).toBe(false);
  });

  it("refuses to complete straight out of a question", () => {
    // A task waiting on an answer has not done the thing it was asking about,
    // so it cannot report itself finished.
    expect(agent.canMovePhase("awaiting_decision", "done")).toBe(false);
  });

  it("allows abandoning a question", () => {
    expect(agent.canMovePhase("awaiting_decision", "cancelled")).toBe(true);
  });

  it("treats a write of the same phase as allowed", () => {
    expect(agent.canMovePhase("running", "running")).toBe(true);
  });
});

/** A job paused on a question, written straight to disk — as a process that
 *  has since died would have left it. */
function writePausedJob(id: string, expiresAt?: number) {
  const request = createDecisionRequest({
    taskId: id,
    question: "Allow file.delete on app/old.js?",
    type: "confirmation",
    required: true,
    riskLevel: "medium",
    expiresAt,
    options: [
      { id: agent.APPROVE_OPTION, label: "Allow", value: "approve" },
      { id: agent.DECLINE_OPTION, label: "Do not allow", value: "decline" },
    ],
  });
  const job = {
    id,
    projectId: "proj-1",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    phase: "awaiting_decision",
    status: request.question,
    prose: "",
    changed: [],
    files: null,
    dist: null,
    history: [],
    issues: [],
    buildNote: null,
    refused: [],
    pendingDecisionId: request.id,
    pendingAction: {
      action: {
        actionId: `${id}-1`,
        taskId: id,
        userId: "0xowner",
        operation: "file.delete",
        resources: ["app/old.js"],
        environment: "development",
        projectId: "proj-1",
      },
      riskLevel: "high",
    },
    grantIds: [],
    resume: {
      projectId: "proj-1",
      prompt: "remove the old file",
      files: {},
      history: [],
      owner: "0xowner",
    },
  };
  writeFileSync(join(AGENT_DIR, `${id}.json`), JSON.stringify(job), "utf8");
  return request;
}

describe("answering a question after a restart", () => {
  it("reads a paused job this process never started", () => {
    const request = writePausedJob("agent-restart-1");
    const job = agent.getAgentJob("agent-restart-1");
    expect(job?.phase).toBe("awaiting_decision");
    expect(job?.pendingDecisionId).toBe(request.id);
  });

  it("issues a grant for the action that was actually checked", () => {
    const request = writePausedJob("agent-restart-2");
    const result = agent.answerAgentDecision({
      jobId: "agent-restart-2",
      requestId: request.id,
      clientRequestId: "click-1",
      selectedOptionIds: [agent.APPROVE_OPTION],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approved).toBe(true);
    expect(result.job.grantIds).toHaveLength(1);
    const grant = getGrant(result.job.grantIds[0]);
    // Scoped to the one resource the question named, not to the operation at
    // large.
    expect(grant?.scope.operation).toBe("file.delete");
    expect(grant?.scope.resources).toEqual(["app/old.js"]);
    expect(grant?.riskLevel).toBe("high");
  });

  it("stops the task when the answer is no", () => {
    const request = writePausedJob("agent-restart-3");
    const result = agent.answerAgentDecision({
      jobId: "agent-restart-3",
      requestId: request.id,
      clientRequestId: "click-no",
      selectedOptionIds: [agent.DECLINE_OPTION],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.approved).toBe(false);
    expect(result.job.phase).toBe("cancelled");
    expect(result.job.grantIds).toHaveLength(0);
    expect(result.job.buildNote).toContain("file.delete");
  });

  it("does not act twice on a repeated click", () => {
    const request = writePausedJob("agent-restart-4");
    const first = agent.answerAgentDecision({
      jobId: "agent-restart-4",
      requestId: request.id,
      clientRequestId: "click-same",
      selectedOptionIds: [agent.APPROVE_OPTION],
    });
    expect(first.ok).toBe(true);

    const second = agent.answerAgentDecision({
      jobId: "agent-restart-4",
      requestId: request.id,
      clientRequestId: "click-same",
      selectedOptionIds: [agent.APPROVE_OPTION],
    });
    // Refused outright: answering moved the job out of awaiting_decision, and
    // that check runs before anything else. The decision store's own replay
    // guard sits behind it as defence for a future async answer path, and is
    // covered in store.test.ts rather than pretended at here.
    expect(second.ok).toBe(false);

    // What actually matters: no second grant, whatever the second call said.
    expect(agent.getAgentJob("agent-restart-4")?.grantIds).toHaveLength(1);
  });

  it("refuses an answer to a question the task is not waiting on", () => {
    const request = writePausedJob("agent-restart-5");
    const wrong = agent.answerAgentDecision({
      jobId: "agent-restart-5",
      requestId: `${request.id}-not-this-one`,
      clientRequestId: "click-wrong",
      selectedOptionIds: [agent.APPROVE_OPTION],
    });
    expect(wrong.ok).toBe(false);
  });

  it("stops a task whose question expired unanswered", () => {
    // Written with a window that has already closed, as a job abandoned
    // overnight would be by the time anyone looked at it again.
    const request = writePausedJob("agent-restart-6", Date.now() - 1);
    const job = agent.getAgentJob("agent-restart-6");
    expect(job?.phase).toBe("cancelled");
    expect(job?.buildNote).toContain("timed out");
    // And the answer that arrives late is refused rather than acted on.
    const late = agent.answerAgentDecision({
      jobId: "agent-restart-6",
      requestId: request.id,
      clientRequestId: "click-late",
      selectedOptionIds: [agent.APPROVE_OPTION],
    });
    expect(late.ok).toBe(false);
  });

  it("refuses an answer for a job that does not exist", () => {
    const result = agent.answerAgentDecision({
      jobId: "agent-does-not-exist",
      requestId: "dec_whatever",
      clientRequestId: "click-x",
      selectedOptionIds: [agent.APPROVE_OPTION],
    });
    expect(result.ok).toBe(false);
  });
});
