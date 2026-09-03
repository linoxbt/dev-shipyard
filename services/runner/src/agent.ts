// Server-side App Builder turns.
//
// The App Builder used to run a whole turn inside the browser tab: the model
// stream, the repair rounds and the build were all driven from the page. That
// made a refresh fatal — the AbortController died with the tab and the work was
// gone, with nothing on the server that even knew a build had been running.
//
// A turn now runs HERE, in the runner, which is a long-lived process. The page
// starts a job, gets an id, and polls. Close the tab, refresh, come back on
// another device: the job carries on and the id reattaches to it.
//
// It lives in the runner rather than the app's own server on purpose. The app
// deploys to Netlify, where a function is killed after ten seconds — orders of
// magnitude less than a real build. The runner is the only part of DevStation
// that can hold a job open for minutes.

import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { runTurn } from "../../../src/lib/appgen/session";
import { projectFiles } from "../../../src/lib/appgen/build";
import { preflight } from "../../../src/lib/agent/tools";
import {
  consumeAuthorization,
  issueGrant,
  revokeTaskGrants,
  setGrantStore,
  type ProtectedAction,
  type RiskLevel,
} from "../../../src/lib/agent/authorization";
import {
  cancelDecisions,
  createDecisionRequest,
  expireDecisions,
  selectedOptions,
  setDecisionStore,
  submitDecision,
  type DecisionRequest,
} from "../../../src/lib/agent/decisions";
import { canTransition, type TaskStatus } from "../../../src/lib/agent/events";
import { fileStore } from "../../../src/lib/agent/store";
import type { GateCall, GateDecision } from "../../../src/lib/appgen/session";
import type { ChatMessage } from "../../../src/lib/ai";
import type { PromptContext } from "../../../src/lib/appgen/prompt";

/** Jobs older than this are swept. Long enough to survive a night away from
 *  the tab, short enough that generated app files do not accumulate forever. */
export const AGENT_TTL_MS = 24 * 60 * 60 * 1000;
/** Hard cap on retained jobs, oldest evicted first. */
export const MAX_AGENT_JOBS = 100;

const STATE_DIR = process.env.RUNNER_STATE_DIR ?? "/var/lib/devstation-runner";
const AGENT_DIR = join(STATE_DIR, "agent");

export type AgentPhase = "running" | "awaiting_decision" | "done" | "error" | "cancelled";

/** AgentPhase is the vocabulary the browser reads; TaskStatus is the one the
 *  state machine is written in. Mapped rather than duplicated, so there is a
 *  single set of legal transitions instead of two that can drift apart. */
const AS_STATUS: Record<AgentPhase, TaskStatus> = {
  running: "running",
  awaiting_decision: "waiting_for_user",
  done: "completed",
  error: "failed",
  cancelled: "cancelled",
};

export interface AgentJob {
  id: string;
  /** Which project this belongs to, so a reattaching page can be sure the job
   *  it remembered is the one it is looking at. */
  projectId: string;
  createdAt: number;
  updatedAt: number;
  phase: AgentPhase;
  /** Human status line, mirroring what the in-page build used to show. */
  status: string;
  /** Prose the model has written so far. */
  prose: string;
  changed: string[];
  files: Record<string, string> | null;
  dist: Record<string, string> | null;
  history: ChatMessage[];
  issues: string[];
  buildNote: string | null;
  /** Actions the policy engine refused, with the reason. Recorded on the job so
   *  a refusal is visible after the fact rather than only in the model's
   *  transcript — the audit trail proper arrives in a later phase. */
  refused: string[];
  /** Files this turn removed, kept apart from `changed`. */
  removed: string[];
  /** How many times this job has stopped to ask. Capped, so a model that keeps
   *  proposing a different privileged action cannot ask forever. */
  pauses: number;
  /** The question this job is waiting on, when its phase is awaiting_decision. */
  pendingDecisionId: string | null;
  /** What that question is about, kept so the grant issued on approval is
   *  fingerprinted from the action that was actually checked rather than one
   *  rebuilt afterwards from the answer. */
  pendingAction: { action: ProtectedAction; riskLevel: Exclude<RiskLevel, "low"> } | null;
  /** Grants issued to this task. Tried against each proposed action on the way
   *  back through the gate. */
  grantIds: string[];
  /** Everything needed to run this turn again.
   *
   *  A paused turn cannot be suspended and revived: it is a JavaScript async
   *  function, and a process restart takes its stack with it. So resuming means
   *  running the turn again with the grant in place. Keeping the input on the
   *  job is what makes that possible in a process that never saw the job start. */
  resume: StartAgentInput | null;
  error?: string;
}

/** Live jobs, including their abort handles — which cannot be serialised, so
 *  they are kept beside the store rather than in it. */
const live = new Map<string, { job: AgentJob; controller: AbortController }>();

function ensureDir(): void {
  try {
    mkdirSync(AGENT_DIR, { recursive: true });
  } catch {
    /* best effort: a job that cannot be persisted still runs in memory */
  }
}

function fileFor(id: string): string {
  return join(AGENT_DIR, `${id}.json`);
}

/** Point the durable security stores at this runner's state directory.
 *
 *  Called once at startup, before any request is served. Until it runs, grants
 *  and decisions are memory-only — which is what they were before this phase,
 *  and is why it must not be forgotten. */
export function initAgentStores(): void {
  ensureDir();
  setGrantStore(fileStore(join(AGENT_DIR, "grants.json")));
  setDecisionStore(fileStore(join(AGENT_DIR, "decisions.json")));
}

/** Write beside the target and rename: a rename is atomic, so a crash mid-write
 *  cannot leave a half-written job that fails to parse on the way back up. */
function persist(job: AgentJob): void {
  ensureDir();
  try {
    const tmp = `${fileFor(job.id)}.tmp`;
    writeFileSync(tmp, JSON.stringify(job), "utf8");
    renameSync(tmp, fileFor(job.id));
  } catch {
    /* disk trouble must not take the job down */
  }
}

function readJob(id: string): AgentJob | null {
  try {
    const job = JSON.parse(readFileSync(fileFor(id), "utf8")) as AgentJob;
    // Jobs written before `refused` existed are still on disk and still
    // readable for a day. Filled in here so the field is never the undefined
    // its type says it cannot be.
    return {
      ...job,
      refused: job.refused ?? [],
      removed: job.removed ?? [],
      pauses: job.pauses ?? 0,
      pendingDecisionId: job.pendingDecisionId ?? null,
      pendingAction: job.pendingAction ?? null,
      grantIds: job.grantIds ?? [],
      resume: job.resume ?? null,
    };
  } catch {
    return null;
  }
}

/** Drop expired and surplus jobs. Called on write, so it needs no timer. */
export function sweep(now = Date.now()): number {
  ensureDir();
  let removed = 0;
  let entries: { id: string; updatedAt: number }[] = [];
  try {
    entries = readdirSync(AGENT_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const id = f.replace(/\.json$/, "");
        return { id, updatedAt: readJob(id)?.updatedAt ?? 0 };
      });
  } catch {
    return 0;
  }
  const doomed = new Set<string>();
  for (const e of entries) if (now - e.updatedAt > AGENT_TTL_MS) doomed.add(e.id);
  const survivors = entries
    .filter((e) => !doomed.has(e.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  for (const e of survivors.slice(MAX_AGENT_JOBS)) doomed.add(e.id);
  for (const id of doomed) {
    // Never sweep something still running, however old the clock says it is.
    if (live.has(id)) continue;
    try {
      rmSync(fileFor(id));
      removed++;
    } catch {
      /* already gone */
    }
  }
  return removed;
}

function touch(job: AgentJob, patch: Partial<AgentJob>): void {
  Object.assign(job, patch, { updatedAt: Date.now() });
  persist(job);
}

/** Move a job, refusing an illegal move rather than obeying it.
 *
 *  Returns false without writing anything when the transition is not allowed —
 *  a finished job cannot be dragged back into running, and a cancelled one
 *  cannot be made to execute. Those are exactly the moves a race between the
 *  turn's own completion and an incoming answer would attempt. */
export function canMovePhase(from: AgentPhase, to: AgentPhase): boolean {
  return from === to || canTransition(AS_STATUS[from], AS_STATUS[to]);
}

function setPhase(job: AgentJob, phase: AgentPhase, patch: Partial<AgentJob> = {}): boolean {
  if (!canMovePhase(job.phase, phase)) return false;
  touch(job, { ...patch, phase });
  return true;
}

export interface StartAgentInput {
  projectId: string;
  prompt: string;
  files: Record<string, string>;
  history: ChatMessage[];
  context?: PromptContext;
  dir?: string;
  /** Left undefined so the turn decides for itself. Defaulting this to
   *  "build" is what made a greeting build an app. */
  mode?: "build" | "review";
  /** Passed straight through to the build step. */
  target?: string;
  /** The wallet this turn is being run for, as verified by DevStation's server
   *  before it reached the runner. Recorded on every gated action so an
   *  authorization grant can be bound to a person in a later phase. Empty when
   *  the caller did not supply one — left empty rather than invented. */
  owner?: string;
}

/** Streams one reply from the provider. The runner talks to the model directly
 *  rather than back through the app: the app's own proxy is a serverless
 *  function on a ten-second leash, which is the whole thing being escaped. */
async function providerChat(opts: {
  system: string;
  messages: ChatMessage[];
  signal?: AbortSignal;
  onDelta: (chunk: string) => void;
}): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY || process.env.AI_API_KEY || "";
  if (!key) throw new Error("No model key configured on the runner (OPENROUTER_API_KEY).");
  const model = process.env.AI_MODEL || "anthropic/claude-sonnet-5";
  const maxTokens = Number(process.env.AI_MAX_TOKENS ?? 64000);

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
      "HTTP-Referer": "https://devstation.online",
      "X-Title": "DevStation",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: opts.system }, ...opts.messages],
      temperature: 0.2,
      stream: true,
      max_tokens: maxTokens,
      // Same reason as the app's proxy: reasoning deltas carry no content, and
      // a long reasoning burst looks exactly like a hang.
      ...(process.env.AI_REASONING === "on" ? {} : { reasoning: { enabled: false } }),
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`Model request failed (${res.status}). ${text.slice(0, 200)}`);
  }

  let out = "";
  let buf = "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) {
          out += delta;
          opts.onDelta(delta);
        }
      } catch {
        /* keep-alive comments and partial frames are normal */
      }
    }
  }
  return out;
}

/** Runs the project's real toolchain by posting to this same runner's build
 *  endpoint over loopback. Reusing the HTTP route rather than reaching into the
 *  container pipeline keeps one code path for builds — same queue, same limits,
 *  same history — and an agent job holds no build slot while it thinks. */
async function runBuildViaSelf(
  files: Record<string, string>,
  signal: AbortSignal,
): Promise<{
  ok: boolean;
  phases?: unknown[];
  dist?: Record<string, string> | null;
  message?: string;
}> {
  const port = process.env.PORT ?? "8792";
  const token = process.env.RUNNER_TOKEN ?? "";
  const res = await fetch(`http://127.0.0.1:${port}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ files }),
    signal,
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    phases?: unknown[];
    dist?: Record<string, string> | null;
    message?: string;
  } | null;
  if (!body) return { ok: false, message: `Build failed (${res.status}).` };
  return {
    ok: body.ok === true,
    phases: body.phases,
    dist: body.dist ?? null,
    message: body.message,
  };
}

export function startAgentJob(input: StartAgentInput): AgentJob {
  const id = `agent-${Date.now()}-${randomBytes(4).toString("hex")}`;
  const job: AgentJob = {
    id,
    projectId: input.projectId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    phase: "running",
    // Seeded empty on purpose: the first status a user sees must come from
    // the classifier or the model, never from job creation. A greeting is
    // not a plan.
    status: "",
    prose: "",
    changed: [],
    files: null,
    dist: null,
    history: [],
    issues: [],
    buildNote: null,
    refused: [],
    removed: [],
    pauses: 0,
    pendingDecisionId: null,
    pendingAction: null,
    grantIds: [],
    resume: input,
  };
  persist(job);
  sweep();
  executeTurn(job, input);
  return job;
}

/**
 * Run one turn for a job, from the start or again after a decision.
 *
 * Separated from startAgentJob because resuming is re-running: an answered
 * decision restarts the turn with the grant in place, and that has to work in a
 * process that never saw the job begin.
 */
function executeTurn(job: AgentJob, input: StartAgentInput): void {
  const id = job.id;
  const controller = new AbortController();
  // Distinguishes one proposed action from the next within a task. It does not
  // enter the fingerprint, so an action proposed again on the resumed turn
  // still matches the grant approved for it.
  let actions = 0;
  // Set when the gate stops the turn to ask a question. The abort that follows
  // must not be read as a cancellation, and the job must keep the phase the
  // gate gave it.
  let paused = false;

  live.set(id, { job, controller });

  // Deliberately not awaited: the caller gets the id straight back and the work
  // continues here regardless of what the browser does next.
  void (async () => {
    try {
      const result = await runTurn({
        prompt: input.prompt,
        files: input.files,
        history: input.history,
        context: input.context,
        dir: input.dir,
        mode: input.mode,
        signal: controller.signal,
        chat: providerChat,
        onStatus: (status) => touch(job, { status }),
        onProse: (prose) => touch(job, { prose }),
        onFile: (path) => touch(job, { changed: [...new Set([...job.changed, path])] }),
        // The chokepoint. Every effect this turn has — each file written, and
        // the build — is proposed here first and runs only if the policy
        // engine allows it. Writing files and running a dev build are both
        // classified safe, so turns behave exactly as they did before this
        // existed — that is the intended result, not a gap. parseGeneratedFiles
        // already drops traversal, absolute paths and oversized bodies, so the
        // schema here is a second, independent check rather than the first one.
        //
        // What it buys now is the path itself: one place every effect passes
        // through, exercised on the live route so it cannot rot before the
        // tool loop starts proposing calls the parser never sees.
        //
        // It lives here rather than in the shared turn logic because the
        // browser copy of that logic is not an authority over anything. This
        // process is.
        gate: (call: GateCall): GateDecision => {
          const result = preflight(
            { id: `${id}-${++actions}`, name: call.name, args: call.args },
            {
              taskId: id,
              userId: input.owner ?? "",
              projectId: input.projectId,
              // App Builder turns build a preview, never a live deployment.
              // Publishing is a separate action and gets its own gate later.
              environment: "development",
            },
          );
          if (result.ok) return { ok: true };

          if (result.rejection.reason !== "needs_authorization") {
            const note = `${call.name}: ${result.rejection.message}`;
            touch(job, { refused: [...job.refused, note] });
            return { ok: false, message: result.rejection.message };
          }

          // Approved already? Spend the grant rather than asking twice. This is
          // the path a resumed turn takes: the same action is proposed again,
          // fingerprints the same, and the grant issued for it is consumed here.
          const action = result.rejection.action;
          for (const grantId of job.grantIds) {
            if (consumeAuthorization(grantId, action).ok) return { ok: true };
          }

          if (job.pauses >= MAX_PAUSES) {
            const note = `${call.name}: asked ${MAX_PAUSES} times already, so this was refused.`;
            touch(job, { refused: [...job.refused, note] });
            return {
              ok: false,
              message: "You have already been asked about this several times, so it was not done.",
            };
          }

          // Otherwise stop and ask. The turn ends here; answering starts a new
          // one. A JavaScript async function cannot be suspended across a
          // restart, so pausing is durable state plus a re-run, never a
          // held-open promise pretending to be one.
          paused = true;
          const request = decisionFor(job, call.name, result.rejection.message, action);
          setPhase(job, "awaiting_decision", {
            status: request.question,
            pendingDecisionId: request.id,
            pendingAction: { action, riskLevel: result.rejection.verdict.riskLevel },
            pauses: job.pauses + 1,
          });
          controller.abort();
          return { ok: false, message: result.rejection.message };
        },
        runBuild: async (files) => {
          touch(job, { status: "Building…" });
          // Strip the workspace prefix. The workspace stores
          // "app/package.json"; the container installs in /work, so npm needs
          // "package.json" at the root. Sending the prefixed paths meant npm
          // found nothing and every build down this path died on
          // "ENOENT /work/package.json". The in-page path had always called
          // this; the server-side path was added without it.
          const project = projectFiles(files, input.dir ?? "app");
          // An ESM-target app is index.html plus a module: there is no
          // package.json and nothing to install. npm fails on it with
          // "ENOENT /work/package.json" every time, which is what filled the
          // dashboard with failed builds. runBuildJob has always checked this;
          // this path calls the runner directly and skipped it.
          if (!project["package.json"]) {
            touch(job, { buildNote: "No package.json, so there is nothing to build." });
            return {
              ok: true,
              unavailable: "This app has no package.json, so there is nothing to build.",
            } as never;
          }
          const out = await runBuildViaSelf(project, controller.signal);
          return out as never;
        },
      });
      if (paused) return;
      setPhase(job, "done", {
        status: "",
        files: result.files,
        changed: result.changed,
        removed: result.removed,
        history: result.history,
        issues: result.issues.map((i) => (typeof i === "string" ? i : JSON.stringify(i))),
      });
    } catch (e) {
      // An abort the gate caused is a pause, not a cancellation, and the phase
      // it set already says so.
      if (paused) return;
      const message = e instanceof Error ? e.message : "The turn failed.";
      setPhase(job, controller.signal.aborted ? "cancelled" : "error", {
        status: "",
        error: message,
      });
    } finally {
      live.delete(id);
    }
  })();
}

/** How many times one job may stop to ask. A turn that keeps proposing a
 *  different privileged action would otherwise ask indefinitely, and each ask
 *  costs the user an interruption. Past this, privileged actions are refused
 *  and the turn is told why, which it can work around. */
const MAX_PAUSES = 3;

/** How long a question stays open. Matched to the grant it would produce, so a
 *  decision can never be answered into a grant that is already stale. */
const DECISION_TTL_MS = 10 * 60 * 1000;

export const APPROVE_OPTION = "approve";
export const DECLINE_OPTION = "decline";

/** Build the question the user actually sees.
 *
 *  The consequence comes from the policy engine's own reason rather than a
 *  generic "are you sure?", because the only useful confirmation is one that
 *  says what will happen. */
function decisionFor(
  job: AgentJob,
  toolName: string,
  why: string,
  action: ProtectedAction,
): DecisionRequest {
  return createDecisionRequest({
    taskId: job.id,
    question: `Allow ${action.operation} on ${action.resources.join(", ") || "this project"}?`,
    description: why,
    type: "confirmation",
    required: true,
    riskLevel: "medium",
    expiresAt: Date.now() + DECISION_TTL_MS,
    affectedAction: toolName,
    consequences: why,
    options: [
      { id: APPROVE_OPTION, label: "Allow", value: "approve" },
      { id: DECLINE_OPTION, label: "Do not allow", value: "decline" },
    ],
  });
}

export interface AnswerDecisionInput {
  jobId: string;
  requestId: string;
  clientRequestId: string;
  selectedOptionIds?: string[];
  text?: string;
}

export type AnswerDecisionResult =
  | { ok: true; job: AgentJob; approved: boolean }
  | { ok: false; message: string };

/**
 * Apply an answer and, if it was an approval, run the turn again.
 *
 * Everything this touches — the job, the request, the grant — is on disk, so
 * this works in a process that never saw the question asked.
 */
export function answerAgentDecision(input: AnswerDecisionInput): AnswerDecisionResult {
  const job = live.get(input.jobId)?.job ?? readJob(input.jobId);
  if (!job) return { ok: false, message: "There is no job with that id." };
  if (job.phase !== "awaiting_decision") {
    return { ok: false, message: "That task is not waiting on a decision." };
  }
  if (job.pendingDecisionId !== input.requestId) {
    return { ok: false, message: "That is not the question this task is waiting on." };
  }

  const result = submitDecision({
    requestId: input.requestId,
    taskId: job.id,
    clientRequestId: input.clientRequestId,
    selectedOptionIds: input.selectedOptionIds,
    text: input.text,
  });
  if (!result.ok) return { ok: false, message: `That answer was not accepted (${result.reason}).` };

  const approved = selectedOptions(result.request, result.response).some(
    (o) => o.value === "approve",
  );

  // A replayed answer must not run the turn a second time. The decision store
  // makes the ANSWER idempotent; this makes the consequence idempotent too,
  // which is the half that actually costs something.
  if (result.replayed) return { ok: true, job, approved };

  if (!approved) {
    // Declining is a real outcome, not a failure. The task stops because
    // permission was refused, and says so.
    const pending = job.pendingAction;
    setPhase(job, "cancelled", {
      status: "",
      pendingDecisionId: null,
      pendingAction: null,
      buildNote: `You did not allow ${pending?.action.operation ?? "that action"}, so the task stopped.`,
    });
    revokeTaskGrants(job.id);
    return { ok: true, job, approved: false };
  }

  const pending = job.pendingAction;
  if (!pending || !job.resume) {
    return { ok: false, message: "That task can no longer be resumed." };
  }
  const grant = issueGrant({
    taskId: job.id,
    userId: pending.action.userId,
    action: pending.action,
    riskLevel: pending.riskLevel,
    issuedFromDecisionRequestId: result.request.id,
  });
  if (
    !setPhase(job, "running", {
      status: "",
      pendingDecisionId: null,
      pendingAction: null,
      grantIds: [...job.grantIds, grant.id],
    })
  ) {
    return { ok: false, message: "That task can no longer be resumed." };
  }
  // Resuming is re-running, so the model has to propose the same action again
  // for the grant's fingerprint to match. Naming what was allowed is what makes
  // that the normal outcome rather than a coin toss; MAX_PAUSES catches the
  // case where it changes its mind anyway.
  const resources = pending.action.resources.join(", ");
  executeTurn(job, {
    ...job.resume,
    prompt: `${job.resume.prompt}\n\n(Permission was granted for ${pending.action.operation} on ${resources}. Do exactly that, and nothing else that needs permission.)`,
  });
  return { ok: true, job, approved: true };
}

/** A job by id, live or recovered from disk after a restart. */
export function getAgentJob(id: string): AgentJob | null {
  const job = live.get(id)?.job ?? readJob(id);
  if (!job) return null;
  // Expiry is decided on read here as everywhere else. Without this a question
  // nobody answered in time would leave the task waiting for an answer that can
  // no longer be given — the decision would refuse it, and the job would sit in
  // awaiting_decision until the 24h sweep removed it.
  if (job.phase === "awaiting_decision" && job.pendingDecisionId) {
    const expired = expireDecisions(job.id);
    if (expired.some((r) => r.id === job.pendingDecisionId)) {
      setPhase(job, "cancelled", {
        status: "",
        pendingDecisionId: null,
        pendingAction: null,
        buildNote: "The request timed out without an answer, so the task stopped.",
      });
    }
  }
  return job;
}

export function cancelAgentJob(id: string): boolean {
  const entry = live.get(id);
  const job = entry?.job ?? readJob(id);
  if (!job) return false;
  entry?.controller.abort();
  // Cancelling must not leave live approvals or open questions behind. Both are
  // durable now, so without this they would outlive the task that raised them.
  revokeTaskGrants(id);
  cancelDecisions(id);
  if (!entry) {
    // A paused job has no running turn to abort — it is waiting on an answer
    // that is not coming — so it is moved here instead.
    setPhase(job, "cancelled", { status: "", pendingDecisionId: null, pendingAction: null });
  }
  return true;
}

/** Live job count, for the dashboard. */
export function activeAgentJobs(): number {
  return live.size;
}
