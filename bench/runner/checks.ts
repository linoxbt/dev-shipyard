import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { runShell } from "../../src/lib/agent/shell";
import type { Check, CheckResult, TaskOutcome } from "./types";

// Evaluating a task's checks against what actually happened.
//
// Every check reports its own name and a reason when it fails, because a suite
// that says "task failed" tells you less than one that says "the file it was
// told not to touch changed".

async function evaluate(check: Check, outcome: TaskOutcome): Promise<CheckResult> {
  const name = check.name;
  const fail = (detail: string): CheckResult => ({ name, passed: false, detail });
  const pass: CheckResult = { name, passed: true };

  switch (check.kind) {
    case "file.matches": {
      const content = outcome.after[check.path];
      if (content === undefined) return fail(`${check.path} is not there`);
      return check.pattern.test(content) ? pass : fail(`${check.path} does not match`);
    }

    case "file.unchanged": {
      const before = outcome.before[check.path];
      const after = outcome.after[check.path];
      return before === after ? pass : fail(`${check.path} was modified`);
    }

    case "file.absent":
      return outcome.after[check.path] === undefined ? pass : fail(`${check.path} still exists`);

    case "files.changedOnly": {
      // Collateral damage: the goal was met, and four other files were
      // reformatted on the way.
      const unexpected = outcome.changed.filter((p) => !check.paths.includes(p));
      return unexpected.length === 0
        ? pass
        : fail(`also changed ${unexpected.slice(0, 4).join(", ")}`);
    }

    case "tool.called": {
      const count = outcome.toolCalls.filter((c) => c.name === check.tool).length;
      return count >= (check.min ?? 1) ? pass : fail(`${check.tool} was not called`);
    }

    case "tool.notCalled": {
      // Tool choice is directly prompt-sensitive and invisible to any check
      // that only looks at the outcome.
      const count = outcome.toolCalls.filter((c) => c.name === check.tool).length;
      return count === 0 ? pass : fail(`${check.tool} was called ${count} time(s)`);
    }

    case "tool.calledWith": {
      const matched = outcome.toolCalls.some((c) => c.name === check.tool && check.match(c.input));
      return matched ? pass : fail(`${check.tool} was never called with what was expected`);
    }

    case "event":
      return outcome.events.some((e) => e.kind === check.event)
        ? pass
        : fail(`no ${check.event} event`);

    case "steps.atMost":
      return outcome.result.steps <= check.n
        ? pass
        : fail(`took ${outcome.result.steps} steps, limit ${check.n}`);

    case "system.contains":
      // Whitespace-insensitive on purpose. Prompts are wrapped prose, and
      // SANDBOX_ADDENDUM happens to break "no network access at all" across
      // two lines. A check that a re-wrap can falsify is a check about
      // formatting pretending to be a check about content.
      return flatten(outcome.system).includes(flatten(check.text))
        ? pass
        : fail("not in the system prompt");

    case "command": {
      // Restoring first is what makes this an oracle rather than a formality:
      // an agent that deleted the failing test would otherwise pass.
      for (const path of check.restore ?? []) {
        const original = outcome.before[path];
        if (original === undefined) continue;
        writeFileSync(join(outcome.root, path), original);
      }
      const result = await runShell(check.run, { cwd: outcome.root, timeoutMs: 180_000 });
      const expected = check.expectExit ?? 0;
      return result.code === expected
        ? pass
        : fail(`\`${check.run}\` exited ${result.code}, expected ${expected}`);
    }

    case "custom":
      return (await check.run(outcome)) ? pass : fail("custom check returned false");
  }
}

/** Collapse runs of whitespace, so a line break cannot fail a text check. */
export function flatten(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export async function runChecks(checks: Check[], outcome: TaskOutcome): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const check of checks) {
    try {
      results.push(await evaluate(check, outcome));
    } catch (error) {
      // A check that throws is a failed check, not a crashed suite.
      results.push({
        name: check.name,
        passed: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}

/** The one-line reason a task failed, or null. The first failing check is the
 *  useful one; listing all of them buries it. */
export function failureOf(results: CheckResult[]): string | null {
  const first = results.find((r) => !r.passed);
  return first ? `${first.name}: ${first.detail ?? "failed"}` : null;
}
