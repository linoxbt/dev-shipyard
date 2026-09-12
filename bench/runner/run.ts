import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Orchestrator, type AgentEvent } from "../../src/lib/agent/orchestrator";
import { Workspace } from "../../src/lib/agent/workspace";
import { MockProvider, type ModelProvider } from "../../src/lib/agent/providers";
import { initLocalRepo, materialise, readWorkspace } from "../../src/lib/agent/repo-session";
import { changedFiles } from "../../src/lib/github-repos";
import { indexWorkspace, openStore } from "../../src/lib/agent/memory/workspace-index";
import { hostExecutor, type Executor } from "../../src/lib/agent/executor";
import { CODING_AGENT_SYSTEM } from "../../src/lib/agent/system-prompt";
import { failureOf, runChecks } from "./checks";
import type { Attempt, BenchTask, TaskOutcome } from "./types";

// Running one task once.
//
// The whole workspace is set up and torn down per attempt, so a repeat is a
// genuinely fresh start rather than a second pass over the first one's mess.

export interface RunOptions {
  provider: ModelProvider;
  executor?: Executor;
  /** Kept out of the workspace so a task that lists files does not see it. */
  keepWorkspace?: boolean;
}

export async function runTask(task: BenchTask, options: RunOptions): Promise<Attempt> {
  const root = mkdtempSync(join(tmpdir(), `bench-${task.id}-`));
  const started = Date.now();
  const events: AgentEvent[] = [];
  const toolCalls: TaskOutcome["toolCalls"] = [];
  let system = "";

  try {
    const before = { ...task.workspace };
    materialise(before, root);
    if (task.git) await initLocalRepo(root, "main");

    const memory = task.index ? openStore(root) : null;
    if (memory) await indexWorkspace(root, { store: memory, embeddings: null });

    const orchestrator = new Orchestrator({
      provider: options.provider,
      workspace: new Workspace(root),
      executor: options.executor ?? hostExecutor(),
      memory,
      maxSteps: task.maxSteps ?? 20,
      maxCostUsd: task.maxCostUsd ?? 0.5,
      autonomy: task.autonomy,
      // No approver means everything gated is refused, which is the
      // orchestrator's own default and the right one for an unattended run.
      requestApproval: task.approve ? async (request) => task.approve!(request) : undefined,
      onEvent: (event) => {
        events.push(event);
        if (event.kind === "step.completed" || event.kind === "step.failed") {
          toolCalls.push({
            name: event.tool ?? "",
            input: (event.detail as Record<string, unknown>) ?? {},
            ok: event.kind === "step.completed",
          });
        }
      },
    });

    const result = await orchestrator.run(task.goal);
    memory?.close();

    // What the model was actually told, for checks about memory and the
    // sandbox addendum. Taken from the provider when it records calls.
    const recorded = options.provider as Partial<MockProvider>;
    system = recorded.calls?.[0]?.system ?? CODING_AGENT_SYSTEM;

    const after = readWorkspace(root);
    const change = changedFiles(before, after);

    const outcome: TaskOutcome = {
      result,
      events,
      // The tool names the orchestrator emits are reliable; the inputs are not
      // always in the event, so a task asserting on arguments uses a custom
      // check against the transcript instead.
      toolCalls: toolCalls.filter((c) => c.name),
      before,
      after,
      changed: Object.keys(change.files),
      deleted: change.deleted,
      durationMs: Date.now() - started,
      root,
      system,
    };

    const checks = await runChecks(task.checks, outcome);
    const failure = failureOf(checks);

    return {
      passed: failure === null,
      checks,
      steps: result.steps,
      costUsd: result.costUsd,
      durationMs: outcome.durationMs,
      failure,
    };
  } catch (error) {
    return {
      passed: false,
      checks: [],
      steps: 0,
      costUsd: 0,
      durationMs: Date.now() - started,
      failure: `the run threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    if (!options.keepWorkspace) rmSync(root, { recursive: true, force: true });
  }
}

/** A fresh MockProvider per attempt, since it consumes its script. */
export function mockFor(task: BenchTask): MockProvider | null {
  return task.script ? new MockProvider(task.script) : null;
}
