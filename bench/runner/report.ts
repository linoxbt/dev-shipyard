import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CODING_AGENT_SYSTEM } from "../../src/lib/agent/system-prompt";
import { toolCatalogue } from "../../src/lib/agent/tools";
import { runShell } from "../../src/lib/agent/shell";
import type { Attempt, RunReport, TaskReport } from "./types";

// Turning attempts into something you can compare.

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function summarise(
  id: string,
  title: string,
  capability: TaskReport["capability"],
  attempts: Attempt[],
): TaskReport {
  return {
    id,
    title,
    capability,
    attempts,
    passRate: attempts.length ? attempts.filter((a) => a.passed).length / attempts.length : 0,
    medianSteps: median(attempts.map((a) => a.steps)),
    medianCostUsd: median(attempts.map((a) => a.costUsd)),
    // The distinct reasons, not every occurrence: three failures for three
    // different reasons is a different situation from three for one.
    failures: [...new Set(attempts.map((a) => a.failure).filter((f): f is string => f !== null))],
  };
}

function hash(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/**
 * What the run was of.
 *
 * Without the prompt and tool hashes, two reports can differ in ways nobody
 * remembers changing, and comparing them is worse than not comparing them.
 */
export async function fingerprint(): Promise<RunReport["fingerprint"]> {
  const sha = await runShell("git rev-parse --short HEAD", {
    cwd: process.cwd(),
    timeoutMs: 15_000,
  });
  return {
    gitSha: sha.ok ? sha.stdout.trim() : "unknown",
    systemPromptHash: hash(CODING_AGENT_SYSTEM),
    toolCatalogueHash: hash(JSON.stringify(toolCatalogue())),
  };
}

export function renderTable(report: RunReport): string {
  const rows = report.tasks.map((task) => {
    const rate = `${Math.round(task.passRate * 100)}%`;
    const verdict = task.passRate === 1 ? "pass" : task.passRate === 0 ? "FAIL" : "flaky";
    return [
      verdict.padEnd(6),
      task.id.padEnd(22),
      rate.padStart(4),
      String(task.medianSteps).padStart(6),
      `$${task.medianCostUsd.toFixed(3)}`.padStart(8),
      task.failures[0] ?? "",
    ].join("  ");
  });

  const passed = report.tasks.filter((t) => t.passRate === 1).length;
  return [
    `${report.provider}/${report.model}  ${report.repeat} run(s) each  ` +
      `${report.sandbox ? "sandboxed" : "on the host"}  ${report.fingerprint.gitSha}`,
    `prompt ${report.fingerprint.systemPromptHash}  tools ${report.fingerprint.toolCatalogueHash}`,
    "",
    ["        ", "task".padEnd(22), "rate", " steps", "    cost", "first failure"].join("  "),
    ...rows,
    "",
    `${passed}/${report.tasks.length} tasks passed every run`,
  ].join("\n");
}

export function save(report: RunReport, dir = join(process.cwd(), "bench", "results")): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${report.at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(path, JSON.stringify(report, null, 2));
  return path;
}

/**
 * Two reports, side by side.
 *
 * Deliberately stingy about calling anything an improvement. With six tasks at
 * three repeats there are eighteen trials, and a move from 70% to 80% on that
 * many is noise wearing a green arrow. Being reluctant here is the entire value
 * of having the tool.
 */
export function compare(baseline: RunReport, candidate: RunReport): string {
  const lines: string[] = [];
  if (baseline.fingerprint.systemPromptHash !== candidate.fingerprint.systemPromptHash) {
    lines.push("The system prompt changed between these runs.");
  }
  if (baseline.fingerprint.toolCatalogueHash !== candidate.fingerprint.toolCatalogueHash) {
    lines.push("The tool catalogue changed between these runs.");
  }
  if (baseline.model !== candidate.model) {
    lines.push(`Different models: ${baseline.model} then ${candidate.model}.`);
  }
  lines.push("");

  for (const task of candidate.tasks) {
    const was = baseline.tasks.find((t) => t.id === task.id);
    if (!was) {
      lines.push(`${task.id.padEnd(22)} new`);
      continue;
    }
    const delta = task.passRate - was.passRate;
    const trials = Math.min(was.attempts.length, task.attempts.length);
    // One trial each way cannot tell you anything about a rate.
    const meaningful = Math.abs(delta) > 0.5 && trials >= 3;
    const verdict =
      delta === 0 ? "same" : meaningful ? (delta > 0 ? "BETTER" : "WORSE") : "within noise";

    const steps = task.medianSteps - was.medianSteps;
    const cost = task.medianCostUsd - was.medianCostUsd;
    lines.push(
      [
        task.id.padEnd(22),
        `${Math.round(was.passRate * 100)}% -> ${Math.round(task.passRate * 100)}%`.padEnd(14),
        verdict.padEnd(13),
        // Separated on purpose: fewer steps at the same pass rate is a real win
        // that a pass/fail column hides completely.
        `steps ${steps >= 0 ? "+" : ""}${steps}`.padEnd(11),
        `cost ${cost >= 0 ? "+" : ""}$${cost.toFixed(3)}`,
      ].join("  "),
    );
  }
  return lines.join("\n");
}
