import { randomUUID } from "node:crypto";
import { redact } from "./secrets";

// The event log a task produces, and the state machine it must obey.
//
// One generic "progress" event would leave the client unable to tell a question
// from a failure from a completion, so each kind is distinct. Every event
// carries a sequence number that increases by exactly one within a task, which
// is what lets a reconnecting client say "I have up to 11, send me the rest"
// and detect a gap rather than rendering stale state.
//
// Every event's payload is redacted on the way in. An event is the thing that
// gets streamed, stored and logged, so it is the right chokepoint.

export type AgentEventType =
  | "agent.started"
  | "agent.state_changed"
  | "agent.message"
  | "agent.action.proposed"
  | "agent.action.started"
  | "agent.action.completed"
  | "agent.action.failed"
  | "agent.decision.requested"
  | "agent.decision.received"
  | "agent.decision.expired"
  | "agent.authorization.requested"
  | "agent.authorization.granted"
  | "agent.authorization.denied"
  | "agent.authorization.expired"
  | "agent.validation.started"
  | "agent.validation.completed"
  | "agent.completed"
  | "agent.paused"
  | "agent.resumed"
  | "agent.cancelled"
  | "agent.failed";

export interface AgentEvent {
  id: string;
  version: "1";
  taskId: string;
  conversationId: string;
  timestamp: string;
  type: AgentEventType;
  sequence: number;
  payload: Record<string, unknown>;
}

export type TaskStatus =
  | "running"
  | "waiting_for_user"
  | "paused"
  | "completed"
  | "cancelled"
  | "failed";

/** Which transitions are legal. A completed task cannot start running again,
 *  and a cancelled one cannot execute anything: those are the transitions an
 *  attacker or a race would try. */
const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  running: ["waiting_for_user", "paused", "completed", "cancelled", "failed"],
  // The important one: waiting_for_user means "waiting on ONE decision", and
  // the way out is back into running.
  waiting_for_user: ["running", "paused", "cancelled", "failed"],
  paused: ["running", "cancelled", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Enough of a log to rebuild it in a process that never saw it written. */
export interface TaskLogSnapshot {
  events: AgentEvent[];
  status: TaskStatus;
}

/** Events retained per task.
 *
 *  An audit trail that grows without limit is one that eventually stops being
 *  written at all, because the record it lives in gets too large to save. The
 *  OLDEST are dropped rather than the newest: the recent end is what explains
 *  what a task is doing now, and the trimmed count is kept so a gap is visible
 *  as a gap rather than looking like a task that did less than it did. */
export const MAX_EVENTS = 400;

export class TaskLog {
  private events: AgentEvent[] = [];
  private seq = 0;
  private state: TaskStatus = "running";
  private dropped = 0;

  constructor(
    readonly taskId: string,
    readonly conversationId: string,
    /** Restores a log persisted by an earlier process. The sequence continues
     *  from where it left off rather than restarting at 1: a restart must not
     *  produce two different events numbered 12. */
    restore?: TaskLogSnapshot,
  ) {
    if (!restore) return;
    this.events = [...restore.events];
    this.state = restore.status;
    this.seq = restore.events.reduce((n, e) => Math.max(n, e.sequence), 0);
  }

  /** Everything needed to restore this log later. */
  snapshot(): TaskLogSnapshot {
    return { events: this.all(), status: this.state };
  }

  /** How many events were dropped to stay within MAX_EVENTS. */
  get droppedCount(): number {
    return this.dropped;
  }

  get status(): TaskStatus {
    return this.state;
  }

  get lastSequence(): number {
    return this.seq;
  }

  /** Append an event. Payloads are redacted here so no caller can leak a
   *  credential into the stream by forgetting to. */
  emit(type: AgentEventType, payload: Record<string, unknown> = {}): AgentEvent {
    const safe = JSON.parse(redact(JSON.stringify(payload)).text) as Record<string, unknown>;
    const event: AgentEvent = {
      id: `evt_${randomUUID()}`,
      version: "1",
      taskId: this.taskId,
      conversationId: this.conversationId,
      timestamp: new Date().toISOString(),
      type,
      sequence: ++this.seq,
      payload: safe,
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) {
      this.dropped += this.events.length - MAX_EVENTS;
      this.events = this.events.slice(-MAX_EVENTS);
    }
    return event;
  }

  /** Move the task, rejecting an illegal transition rather than obeying it. */
  transition(to: TaskStatus, reason?: string): boolean {
    if (!canTransition(this.state, to)) return false;
    this.state = to;
    this.emit("agent.state_changed", { status: to, ...(reason ? { reason } : {}) });
    return true;
  }

  /** Everything after `afterSequence`, for a client that reconnected holding a
   *  partial view. */
  since(afterSequence: number): AgentEvent[] {
    return this.events.filter((e) => e.sequence > afterSequence);
  }

  all(): AgentEvent[] {
    return [...this.events];
  }
}

/** What a reconnecting client gets when replay is not enough. */
export interface TaskSnapshot {
  taskId: string;
  status: TaskStatus;
  lastSequence: number;
  completedActions: string[];
  activeAction?: string;
  pendingDecisionId?: string;
  decisions: string[];
  authorizations: string[];
  updatedAt: string;
}

/** Detect a gap or a duplicate in a received stream.
 *
 *  The client must not render event 12 as if 11 had arrived; the answer is to
 *  ask for what is missing. */
export function inspectSequence(
  received: number[],
): { ok: true } | { ok: false; missing: number[]; duplicates: number[] } {
  if (received.length === 0) return { ok: true };
  const seen = new Set<number>();
  const duplicates: number[] = [];
  for (const n of received) {
    if (seen.has(n)) duplicates.push(n);
    seen.add(n);
  }
  const sorted = [...seen].sort((a, b) => a - b);
  const missing: number[] = [];
  for (let n = sorted[0]; n < sorted[sorted.length - 1]; n++) {
    if (!seen.has(n)) missing.push(n);
  }
  if (missing.length === 0 && duplicates.length === 0) return { ok: true };
  return { ok: false, missing, duplicates };
}
