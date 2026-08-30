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
/** Stop chasing a job that has not moved in this long — the runner sweeps its
 *  own jobs after a day, and a job it no longer has will 404 forever. */
const MAX_SILENT_MS = 10 * 60 * 1000;

export type AgentPhase = "running" | "done" | "error" | "cancelled";

export interface AgentJob {
  id: string;
  projectId: string;
  phase: AgentPhase;
  status: string;
  prose: string;
  changed: string[];
  files: Record<string, string> | null;
  dist: Record<string, string> | null;
  history: ChatMessage[];
  issues: string[];
  error?: string;
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
}

export interface UseAgentJob {
  /** Whether the runner is reachable and persistent turns are possible. */
  configured: boolean | null;
  job: AgentJob | null;
  /** True while a job is running, whether started here or resumed. */
  busy: boolean;
  start: (input: StartInput) => Promise<AgentJob | null>;
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
  const idRef = useRef<string | null>(null);
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
        // The runner no longer has it — swept, or restarted mid-run. Nothing to
        // reattach to, so stop pretending there is.
        forgetJob(projectId);
        idRef.current = null;
        setJob(null);
        return;
      }
      const body = (await res.json().catch(() => null)) as { job?: AgentJob } | null;
      const next = body?.job;
      if (!next) return;
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
      if (next.phase !== "running" && settledRef.current !== next.id) {
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
      status: input.mode === "review" ? "Reading the code…" : "Planning the app…",
      prose: "",
      changed: [],
      files: null,
      dist: null,
      history: [],
      issues: [],
    };
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
  }, [projectId]);

  const clear = useCallback(() => {
    if (projectId) forgetJob(projectId);
    idRef.current = null;
    setJob(null);
  }, [projectId]);

  return {
    configured,
    job,
    busy: job?.phase === "running",
    start,
    cancel,
    clear,
  };
}
