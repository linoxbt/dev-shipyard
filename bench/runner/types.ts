import type { MockTurn } from "../../src/lib/agent/providers";
import type {
  AgentEvent,
  AgentEventKind,
  ApprovalRequest,
  RunResult,
} from "../../src/lib/agent/orchestrator";

// What a benchmark task is, and what counts as passing it.
//
// The point of this suite is to make a change to the agent measurable rather
// than guessed. Every claim in this project so far has been "I ran it once and
// it worked", which is evidence but not measurement.
//
// Workspaces are file maps, not directories on disk. A directory of
// deliberately broken fixtures would be linted by `eslint .`, rewritten by
// `prettier --write .`, and worst, CI runs bare `bun test`, which would execute
// the intentionally failing fixture tests as part of this repo's own suite. A
// Record<string, string> avoids all three, and reuses materialise() and
// readWorkspace() from repo-session.ts, which repo-agent.ts is already built on.

export type Capability =
  | "edit"
  | "shell"
  | "git"
  | "memory"
  | "retrieval"
  | "web"
  | "mcp"
  | "approval";

export interface BenchTask {
  id: string;
  title: string;
  capability: Capability;
  goal: string;
  workspace: Record<string, string>;
  /** git init and a baseline commit before the run, for checkpoint and undo. */
  git?: boolean;
  /** Build the project index first, for retrieval tasks. */
  index?: boolean;
  maxSteps?: number;
  maxCostUsd?: number;
  autonomy?: "ask_sensitive" | "ask_integrations" | "ask_deploy" | "autonomous";
  /** A deterministic approver. Absent means everything gated is refused, which
   *  is what the orchestrator does with no approver at all. */
  approve?: (request: ApprovalRequest) => boolean;
  /** Present means this task can run free and deterministically under the
   *  MockProvider. Absent means it is live-only. */
  script?: MockTurn[];
  checks: Check[];
}

export interface ToolCallRecord {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
}

export interface TaskOutcome {
  result: RunResult;
  events: AgentEvent[];
  toolCalls: ToolCallRecord[];
  /** What the workspace held before the run, for diffing. */
  before: Record<string, string>;
  after: Record<string, string>;
  changed: string[];
  deleted: string[];
  durationMs: number;
  /** The real directory, for checks that run a command in it. */
  root: string;
  /** The system prompt the model was given, for checks about memory. */
  system: string;
}

/**
 * A check has a name because the report records per-check results, not just a
 * task verdict. That is what tells you HOW something regressed rather than
 * merely that it did.
 *
 * The valuable ones are the negative ones. A suite that only checks the goal
 * was met will happily reward an agent that met it by deleting the tests.
 */
export type Check =
  | { name: string; kind: "file.matches"; path: string; pattern: RegExp }
  | { name: string; kind: "file.unchanged"; path: string }
  | { name: string; kind: "file.absent"; path: string }
  | { name: string; kind: "files.changedOnly"; paths: string[] }
  | { name: string; kind: "tool.called"; tool: string; min?: number }
  | { name: string; kind: "tool.notCalled"; tool: string }
  | {
      name: string;
      kind: "tool.calledWith";
      tool: string;
      match: (input: Record<string, unknown>) => boolean;
    }
  | { name: string; kind: "event"; event: AgentEventKind }
  | { name: string; kind: "steps.atMost"; n: number }
  | { name: string; kind: "system.contains"; text: string }
  /**
   * Run a command in the finished workspace, optionally restoring some files
   * first. `restore` is the important half: without it, "make the tests pass"
   * is satisfied by deleting the test, and nobody notices for months.
   */
  | { name: string; kind: "command"; run: string; expectExit?: number; restore?: string[] }
  | { name: string; kind: "custom"; run: (outcome: TaskOutcome) => boolean | Promise<boolean> };

export interface CheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface Attempt {
  passed: boolean;
  checks: CheckResult[];
  steps: number;
  costUsd: number;
  durationMs: number;
  /** Why it failed, in one line, or null. */
  failure: string | null;
}

export interface TaskReport {
  id: string;
  title: string;
  capability: Capability;
  attempts: Attempt[];
  /** k of n, because one run of a non-deterministic system is an anecdote. */
  passRate: number;
  medianSteps: number;
  medianCostUsd: number;
  /** The distinct reasons it failed. Three failures for three different
   *  reasons is a different situation from three for one. */
  failures: string[];
}

export interface RunReport {
  at: string;
  provider: string;
  model: string;
  repeat: number;
  sandbox: boolean;
  /** So two runs that differ in ways you have forgotten about are not mistaken
   *  for a comparison. */
  fingerprint: {
    gitSha: string;
    systemPromptHash: string;
    toolCatalogueHash: string;
  };
  tasks: TaskReport[];
}
