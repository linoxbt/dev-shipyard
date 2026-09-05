import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/ai";

// Keeps an App Builder turn alive across a page refresh.
//
// The turn runs in the build runner, not in this tab (see services/runner's
// agent.ts). All the browser holds is a job id, so refreshing, closing the tab
// or moving to another device loses nothing: the id is remembered per project
// and reattached on mount.
//
// The id is stored per project rather than globally, so opening a different app
// never picks up a build belonging to the one you left.

const KEY = "devstation-agent-jobs-v1";
/** Fast enough that the status line still reads as live, slow enough that a
 *  long build is not thousands of requests. */
const POLL_MS = 2000;
/** Stop chasing a job that has not moved in this long: the runner sweeps its
 *  own jobs after a day, and a job it no longer has will 404 forever. */
const MAX_SILENT_MS = 10 * 60 * 1000;

export type AgentPhase = "running" | "awaiting_decision" | "done" | "error" | "cancelled";

/** The phases where the turn is over and the result is final.
 *
 *  Written out rather than expressed as "not running", which is exactly what
 *  made a paused turn look finished: awaiting_decision is neither running nor
 *  done, so `phase !== "running"` forgot the job, dropped its id and reported a
 *  result for a turn that had not produced one. */
const SETTLED: AgentPhase[] = ["done", "error", "cancelled"];

export function isSettled(phase: AgentPhase): boolean {
  return SETTLED.includes(phase);
}

/** One client request id per QUESTION, not per click.
 *
 *  Two clicks on the same question must send the same id so the runner records
 *  one answer and issues one grant. Minting per call would make every retry a
 *  fresh answer, which is the thing the idempotency exists to stop.
 *
 *  Pure and exported so that rule is testable: this project has no React
 *  renderer in its test setup, so the logic lives outside the component. */
export function clientRequestIdFor(
  store: Record<string, string>,
  requestId: string,
  mint: () => string = () => Math.random().toString(36).slice(2, 10),
): string {
  const existing = store[requestId];
  if (existing) return existing;
  const id = `ans-${requestId}-${mint()}`;
  store[requestId] = id;
  return id;
}

export interface AgentJob {
  id: string;
  projectId: string;
  phase: AgentPhase;
  status: string;
  prose: string;
  changed: string[];
  removed?: string[];
  /** Outward actions you approved that this browser must carry out, because the
   *  credential for them is in this session and never reaches the runner. */
  handoffs?: Array<{ name: string; args: Record<string, unknown> }>;
  files: Record<string, string> | null;
  dist: Record<string, string> | null;
  history: ChatMessage[];
  issues: string[];
  pendingDecisionId?: string | null;
  /** Why a turn stopped, when it stopped for a reason worth saying out loud -
   *  a declined permission, or a question nobody answered in time. */
  buildNote?: string | null;
  error?: string;
}

/** The question a paused turn is waiting on, as the runner hands it over.
 *  Option ids are stable and are what an answer refers to: the labels are
 *  display text and matching on them would silently change what a click means. */
export interface PendingDecision {
  id: string;
  taskId: string;
  question: string;
  description?: string;
  consequences?: string;
  affectedAction?: string;
  expiresAt?: number;
  options?: Array<{ id: string; label: string; value: string }>;
}

function readStore(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeStore(next: Record<string, string>): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* a full or blocked store must not break the builder */
  }
}

export function rememberJob(projectId: string, jobId: string): void {
  writeStore({ ...readStore(), [projectId]: jobId });
}

export function forgetJob(projectId: string): void {
  const next = readStore();
  delete next[projectId];
  writeStore(next);
}

export function rememberedJob(projectId: string | null): string | null {
  if (!projectId) return null;
  return readStore()[projectId] ?? null;
}

export interface StartInput {
  projectId: string;
  prompt: string;
  files: Record<string, string>;
  history: ChatMessage[];
  context?: unknown;
  dir?: string;
  mode?: "build" | "review";
  /** The connected wallet, so a grant is bound to a person. */
  owner?: string;
}

export interface UseAgentJob {
  /** Whether the runner is reachable and persistent turns are possible. */
  configured: boolean | null;
  job: AgentJob | null;
  /** The question this turn is waiting on, when it is waiting on one. */
  decision: PendingDecision | null;
  /** True while a job is running, whether started here or resumed. */
  busy: boolean;
  /** True while the turn is stopped waiting for an answer. Still attached, and
   *  still the user's turn to act, which is why it is not `busy`. */
  waiting: boolean;
  answering: boolean;
  start: (input: StartInput) => Promise<AgentJob | null>;
  answer: (requestId: string, optionId: string) => Promise<boolean>;
  cancel: () => void;
  /** Forget the current job without cancelling it. */
  clear: () => void;
}

export function useAgentJob(
  projectId: string | null,
  onSettled?: (job: AgentJob) => void,
): UseAgentJob {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [job, setJob] = useState<AgentJob | null>(null);
  const [decision, setDecision] = useState<PendingDecision | null>(null);
  const [answering, setAnswering] = useState(false);
  const idRef = useRef<string | null>(null);
  // One client request id per QUESTION, not per click. Two clicks on the same
  // question send the same id, so the runner records one answer and issues one
  // grant. Minting it per call would make every retry a fresh answer, which is
  // exactly what the idempotency is there to prevent.
  const answerIdsRef = useRef<Record<string, string>>({});
  const settledRef = useRef<string | null>(null);
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  useEffect(() => {
    let alive = true;
    fetch("/api/agent")
      .then((r) => r.json())
      .then((d: { configured?: boolean }) => {
        if (alive) setConfigured(d.configured === true);
      })
      .catch(() => {
        if (alive) setConfigured(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Reattach on mount / project change. This is the refresh case: the tab is
  // new, the job is not.
  useEffect(() => {
    idRef.current = rememberedJob(projectId);
    setJob(null);
    setDecision(null);
    settledRef.current = null;
  }, [projectId]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    let lastChange = Date.now();
    let lastSerialised = "";

    const tick = async () => {
      const id = idRef.current;
      if (!id) return;
      const res = await fetch(`/api/agent?id=${encodeURIComponent(id)}`).catch(() => null);
      if (!alive || !res) return;
      if (res.status === 404) {
        // The runner no longer has it: swept, or restarted mid-run. Nothing to
        // reattach to, so stop pretending there is.
        forgetJob(projectId);
        idRef.current = null;
        setJob(null);
        return;
      }
      const body = (await res.json().catch(() => null)) as {
        job?: AgentJob;
        decision?: PendingDecision | null;
      } | null;
      const next = body?.job;
      if (!next) return;
      setDecision(body?.decision ?? null);
      const serialised = JSON.stringify(next);
      if (serialised !== lastSerialised) {
        lastSerialised = serialised;
        lastChange = Date.now();
        setJob(next);
      } else if (Date.now() - lastChange > MAX_SILENT_MS) {
        forgetJob(projectId);
        idRef.current = null;
        return;
      }
      // A paused turn is NOT settled. Treating it as such forgot the job,
      // dropped the id and reported the turn finished while it was still
      // waiting for an answer that could no longer reach it.
      if (isSettled(next.phase) && settledRef.current !== next.id) {
        settledRef.current = next.id;
        forgetJob(projectId);
        idRef.current = null;
        onSettledRef.current?.(next);
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [projectId, job?.id]);

  const start = useCallback(async (input: StartInput): Promise<AgentJob | null> => {
    const res = await fetch("/api/agent", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    }).catch(() => null);
    if (!res || !res.ok) return null;
    const body = (await res.json().catch(() => null)) as { id?: string } | null;
    if (!body?.id) return null;
    rememberJob(input.projectId, body.id);
    idRef.current = body.id;
    settledRef.current = null;
    const started: AgentJob = {
      id: body.id,
      projectId: input.projectId,
      phase: "running",
      // No status until the agent reports one. Seeding a label here claimed
      // the turn was planning an app before it had even been classified,
      // which is what made "hi" say "Planning the app…".
      status: "",
      prose: "",
      changed: [],
      files: null,
      dist: null,
      history: [],
      issues: [],
    };
    setDecision(null);
    setJob(started);
    return started;
  }, []);

  const cancel = useCallback(() => {
    const id = idRef.current;
    if (!id) return;
    void fetch(`/api/agent?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => null);
    if (projectId) forgetJob(projectId);
    idRef.current = null;
    setJob(null);
    setDecision(null);
  }, [projectId]);

  const clear = useCallback(() => {
    if (projectId) forgetJob(projectId);
    idRef.current = null;
    setJob(null);
    setDecision(null);
  }, [projectId]);

  /** Answer the question this turn is waiting on. */
  const answer = useCallback(async (requestId: string, optionId: string): Promise<boolean> => {
    const id = idRef.current;
    if (!id) return false;
    const clientRequestId = clientRequestIdFor(answerIdsRef.current, requestId);

    setAnswering(true);
    try {
      const res = await fetch("/api/agent", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, requestId, clientRequestId, selectedOptionIds: [optionId] }),
      }).catch(() => null);
      if (!res || !res.ok) return false;
      // The next poll carries the new phase. Clearing the card here rather than
      // waiting for it keeps the buttons from sitting live for another 2s.
      setDecision(null);
      return true;
    } finally {
      setAnswering(false);
    }
  }, []);

  return {
    configured,
    job,
    decision,
    busy: job?.phase === "running",
    waiting: job?.phase === "awaiting_decision",
    answering,
    start,
    answer,
    cancel,
    clear,
  };
}
