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

export type AgentPhase = "running" | "done" | "error" | "cancelled";

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
    return { ...job, refused: job.refused ?? [] };
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
  const controller = new AbortController();
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
  };
  // Distinguishes one proposed action from the next within a task, so a grant
  // issued for one can never be spent on another.
  let actions = 0;

  live.set(id, { job, controller });
  persist(job);
  sweep();

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
          const note = `${call.name}: ${result.rejection.message}`;
          touch(job, { refused: [...job.refused, note] });
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
      touch(job, {
        phase: "done",
        status: "",
        files: result.files,
        changed: result.changed,
        history: result.history,
        issues: result.issues.map((i) => (typeof i === "string" ? i : JSON.stringify(i))),
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "The turn failed.";
      touch(job, {
        phase: controller.signal.aborted ? "cancelled" : "error",
        status: "",
        error: message,
      });
    } finally {
      live.delete(id);
    }
  })();

  return job;
}

/** A job by id, live or recovered from disk after a restart. */
export function getAgentJob(id: string): AgentJob | null {
  return live.get(id)?.job ?? readJob(id);
}

export function cancelAgentJob(id: string): boolean {
  const entry = live.get(id);
  if (!entry) return false;
  entry.controller.abort();
  return true;
}

/** Live job count, for the dashboard. */
export function activeAgentJobs(): number {
  return live.size;
}
