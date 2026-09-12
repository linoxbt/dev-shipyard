import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Orchestrator, type AgentEvent } from "../../src/lib/agent/orchestrator";
import { Workspace } from "../../src/lib/agent/workspace";
import {
  MockProvider,
  type GenerateInput,
  type ModelProvider,
  type ProviderToolCall,
} from "../../src/lib/agent/providers";
import { initLocalRepo, materialise, readWorkspace } from "../../src/lib/agent/repo-session";
import { changedFiles } from "../../src/lib/github-repos";
import { indexWorkspace, openStore } from "../../src/lib/agent/memory/workspace-index";
import { hostExecutor, type Executor } from "../../src/lib/agent/executor";
import { CODING_AGENT_SYSTEM, SANDBOX_ADDENDUM } from "../../src/lib/agent/system-prompt";
import { failureOf, runChecks } from "./checks";
import type { Attempt, BenchTask, TaskOutcome } from "./types";

// Running one task once.
//
// The whole workspace is set up and torn down per attempt, so a repeat is a
// genuinely fresh start rather than a second pass over the first one's mess.

export interface RunOptions {
  provider: ModelProvider;
  /**
   * Built per task, given the workspace that was just created for it.
   *
   * A sandbox mounts exactly one directory, and the directory a task runs in
   * does not exist until runTask makes it. Handing in a ready-made one meant
   * building it around the harness's own cwd, so every task's shell commands
   * ran against this repository instead of its workspace.
   */
  executorFor?: (root: string) => Executor;
  /** A ready-made one, for the host executor, which does not care where it is. */
  executor?: Executor;
  /** Kept out of the workspace so a task that lists files does not see it. */
  keepWorkspace?: boolean;
}

/**
 * Keep what the provider was actually asked.
 *
 * This used to read the system prompt off `MockProvider.calls`, which meant
 * every `system.contains` check was vacuous under `--live`: a real provider has
 * no such field, so the check fell back to the unmodified constant and passed
 * whatever happened. A check that cannot fail in the mode that matters is worse
 * than no check, because it reads like coverage.
 */
function recording(
  inner: ModelProvider,
): ModelProvider & { seen: GenerateInput[]; asked: ProviderToolCall[] } {
  const seen: GenerateInput[] = [];
  const asked: ProviderToolCall[] = [];
  return {
    name: inner.name,
    model: inner.model,
    seen,
    asked,
    async generate(input) {
      seen.push(input);
      const result = await inner.generate(input);
      asked.push(...result.toolCalls);
      return result;
    },
  };
}

/**
 * What each tool was actually called with, and whether it worked.
 *
 * Neither half is available on its own. `step.completed` carries the tool name
 * and nothing else, so the arguments have to come from what the model emitted;
 * the model's own list says nothing about what happened next. Zipping them by
 * execution order within each tool name joins the two, and it is why
 * `tool.calledWith` can assert on arguments at all -- before this it compared
 * against an empty object and could never match anything.
 */
function joinToolCalls(
  executed: { name: string; ok: boolean }[],
  asked: ProviderToolCall[],
): TaskOutcome["toolCalls"] {
  const queues = new Map<string, ProviderToolCall[]>();
  for (const call of asked) {
    const queue = queues.get(call.name) ?? [];
    queue.push(call);
    queues.set(call.name, queue);
  }
  return executed.map((step) => ({
    name: step.name,
    ok: step.ok,
    input: (queues.get(step.name)?.shift()?.input ?? {}) as Record<string, unknown>,
  }));
}

export async function runTask(task: BenchTask, options: RunOptions): Promise<Attempt> {
  const root = mkdtempSync(join(tmpdir(), `bench-${task.id}-`));
  const started = Date.now();
  const events: AgentEvent[] = [];
  const executed: { name: string; ok: boolean }[] = [];
  // Whoever constructs, disposes.
  const built = options.executorFor?.(root) ?? null;

  try {
    materialise(task.workspace, root);
    if (task.git) await initLocalRepo(root, "main");

    const memory = task.index ? openStore(root) : null;
    const executor = built ?? options.executor ?? hostExecutor();

    const session = (provider: ModelProvider, collect: boolean) =>
      new Orchestrator({
        provider,
        workspace: new Workspace(root),
        executor,
        // The same rule the CLI and the runner apply. Benchmarking an agent
        // configured differently from the one people use measures something
        // nobody ships, and this addendum in particular changes behaviour: an
        // agent that has not been told its shell has no network will spend the
        // budget rediscovering it.
        systemAddendum: executor.kind === "sandbox" ? SANDBOX_ADDENDUM : undefined,
        memory,
        maxSteps: task.maxSteps ?? 20,
        maxCostUsd: task.maxCostUsd ?? 0.5,
        autonomy: task.autonomy,
        // No approver means everything gated is refused, which is the
        // orchestrator's own default and the right one for an unattended run.
        requestApproval: task.approve ? async (request) => task.approve!(request) : undefined,
        onEvent: (event) => {
          if (!collect) return;
          events.push(event);
          if (event.kind === "step.completed" || event.kind === "step.failed") {
            executed.push({
              name: event.tool ?? "",
              ok: event.kind === "step.completed",
            });
          }
        },
      });

    // A first session whose only job is to leave something behind. Nothing
    // about it is measured: it is setup that happens to be performed by the
    // agent, which is the only way to test that what one session writes is
    // what the next one gets.
    if (task.prior) {
      const priorProvider =
        options.provider instanceof MockProvider && task.prior.script
          ? new MockProvider(task.prior.script)
          : options.provider;
      await session(priorProvider, false).run(task.prior.goal);
    }

    // Taken after the prior session, so what it wrote is the starting point
    // rather than showing up as collateral damage from the run being measured.
    const before = readWorkspace(root);
    if (memory) await indexWorkspace(root, { store: memory, embeddings: null });

    const provider = recording(options.provider);
    const result = await session(provider, true).run(task.goal);
    memory?.close();

    const after = readWorkspace(root);
    const change = changedFiles(before, after);

    const outcome: TaskOutcome = {
      result,
      events,
      toolCalls: joinToolCalls(
        executed.filter((c) => c.name),
        provider.asked,
      ),
      before,
      after,
      changed: Object.keys(change.files),
      deleted: change.deleted,
      durationMs: Date.now() - started,
      root,
      // What the model was actually told, for checks about memory and the
      // sandbox addendum.
      system: provider.seen[0]?.system ?? CODING_AGENT_SYSTEM,
      sandbox: executor.kind === "sandbox",
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
    await built?.dispose();
    if (!options.keepWorkspace) rmSync(root, { recursive: true, force: true });
  }
}

/** A fresh MockProvider per attempt, since it consumes its script. */
export function mockFor(task: BenchTask): MockProvider | null {
  return task.script ? new MockProvider(task.script) : null;
}
