#!/usr/bin/env bun
import { readFileSync } from "node:fs";
import { TASKS, taskById } from "../bench/tasks";
import { mockFor, runTask } from "../bench/runner/run";
import { compare, fingerprint, renderTable, save, summarise } from "../bench/runner/report";
import { providerFromEnv } from "../src/lib/agent/providers";
import { sandboxExecutor, sandboxReadiness, readinessProblem } from "../src/lib/agent/sandbox-exec";
import type { Attempt, RunReport } from "../bench/runner/types";

// bun run bench                      free, deterministic, what CI runs
// bun run bench --live               the configured model, costs money
// bun run bench --live --repeat 5
// bun run bench --tasks fix-failing-test,patch-precision
// bun run bench compare a.json b.json

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? undefined : args[at + 1];
};

/**
 * Ask before spending the user's money.
 *
 * The estimate is deliberately rough and deliberately stated: it is the order
 * of magnitude that matters when the difference between a one-task check and a
 * full --repeat 5 sweep is a dollar against thirty. --yes skips the question
 * for CI and for anyone who already knows what they are buying; a
 * non-interactive stdin has nobody to ask, so it declines rather than assuming
 * consent.
 */
async function confirmSpend(
  tasks: number,
  repeat: number,
  provider: { name: string; model: string },
): Promise<boolean> {
  const estimate = tasks * repeat * 0.15;
  process.stdout.write(
    `About to run ${tasks} task(s) ${repeat} time(s) against ` +
      `${provider.name}/${provider.model}.\nThis costs roughly $${estimate.toFixed(2)} ` +
      `and takes a few minutes.\n`,
  );
  if (flag("yes")) return true;
  if (!process.stdin.isTTY) {
    process.stdout.write("Not a terminal, so there is nobody to ask. Pass --yes to run it.\n");
    return false;
  }
  process.stdout.write("Continue? [y/N] ");
  for await (const chunk of process.stdin) {
    return String(chunk).trim().toLowerCase().startsWith("y");
  }
  return false;
}

async function main() {
  if (args[0] === "compare") {
    const [, a, b] = args;
    if (!a || !b) throw new Error("compare needs two report files");
    const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as RunReport;
    process.stdout.write(`${compare(read(a), read(b))}\n`);
    return;
  }

  const live = flag("live");
  const repeat = Number(value("repeat") ?? (live ? 3 : 1));
  const only = value("tasks")
    ?.split(",")
    .map((s) => s.trim());
  const wanted = only ? only.map((id) => taskById(id)).filter(Boolean) : TASKS;
  if (wanted.length === 0) throw new Error("no such task");

  const provider = live ? providerFromEnv() : null;
  if (live && !provider) throw new Error("--live needs ANTHROPIC_API_KEY or OPENROUTER_API_KEY");

  // Mock runs stay on the host: they execute scripted tool calls, so a
  // container adds seconds per task and a Docker dependency CI does not have.
  // A live run is measuring the real thing and should be sandboxed like one.
  const sandbox = live && !flag("no-sandbox");
  if (sandbox) {
    const problem = readinessProblem(await sandboxReadiness());
    if (problem) throw new Error(problem);
  }

  if (live && !(await confirmSpend(wanted.length, repeat, provider!))) {
    process.stdout.write("Nothing run.\n");
    return;
  }

  const report: RunReport = {
    at: new Date().toISOString(),
    provider: live ? provider!.name : "mock",
    model: live ? provider!.model : "scripted",
    repeat,
    sandbox,
    fingerprint: await fingerprint(),
    tasks: [],
  };

  for (const task of wanted) {
    if (!task) continue;
    if (!live && !task.script) {
      process.stdout.write(`${task.id.padEnd(22)} skipped (no script; live only)\n`);
      continue;
    }

    const attempts: Attempt[] = [];
    for (let i = 0; i < repeat; i++) {
      attempts.push(
        await runTask(task, {
          provider: live ? provider! : mockFor(task)!,
          // Per task, around the workspace runTask creates for it.
          executorFor: sandbox ? (root) => sandboxExecutor({ workspace: root }) : undefined,
        }),
      );
      process.stdout.write(
        `${task.id.padEnd(22)} ${i + 1}/${repeat} ${attempts.at(-1)!.passed ? "pass" : "fail"}\n`,
      );
    }
    report.tasks.push(summarise(task.id, task.title, task.capability, attempts));
  }

  process.stdout.write(`\n${renderTable(report)}\n`);
  const path = save(report);
  process.stdout.write(`\nwritten to ${path}\n`);

  // A red suite should fail a build.
  if (report.tasks.some((t) => t.passRate < 1)) process.exit(1);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
