import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hostExecutor, type Executor } from "./executor";
import { resolveSettings } from "./providers/settings";
import { stepCell } from "./cli/live";

// Commands that keep running -- a dev server, anvil, a watcher -- and the saved
// choice to run on the machine itself, where its logins are.

const executors: Executor[] = [];
const dirs: string[] = [];
afterEach(async () => {
  for (const e of executors.splice(0)) await e.dispose();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "bg-"));
  dirs.push(dir);
  return dir;
}

describe("a background command on this machine", () => {
  it("keeps running after it starts, and its output can be read", async () => {
    const ex = hostExecutor();
    executors.push(ex);
    const started = await ex.start!("echo hello; sleep 30", { cwd: scratch() });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await pause(400);
    const job = await ex.jobOutput!(started.id);
    expect(job?.running).toBe(true);
    expect(job?.output).toContain("hello");
  });

  it("stops when asked, and reports how a finished one exited", async () => {
    const ex = hostExecutor();
    executors.push(ex);
    const cwd = scratch();
    const long = await ex.start!("sleep 30", { cwd });
    if (!long.ok) throw new Error(long.message);
    expect(await ex.stop!(long.id)).toBe(true);
    await pause(400);
    expect((await ex.jobOutput!(long.id))?.running).toBe(false);

    const short = await ex.start!("echo done; exit 3", { cwd });
    if (!short.ok) throw new Error(short.message);
    await pause(400);
    expect(await ex.jobOutput!(short.id)).toMatchObject({ running: false, exitCode: 3 });
  });

  it("knows nothing about a command it did not start", async () => {
    const ex = hostExecutor();
    executors.push(ex);
    expect(await ex.jobOutput!("job-99")).toBeNull();
    expect(await ex.stop!("job-99")).toBe(false);
  });
});

describe("the terminal", () => {
  it("shows a background command, its output and stopping it", () => {
    const cell = (tool: string, input: Record<string, unknown>, output = "") =>
      stepCell({ kind: "step.completed", tool, message: "", at: "", detail: { input, output } });
    expect(cell("run_shell", { command: "anvil", background: true })).toMatchObject({
      title: "Bash(anvil)",
      body: ["⎿  Running in the background"],
    });
    expect(
      cell("shell_output", { id: "job-1" }, "job-1 (anvil) is still running.\nListening on 8545")
        .title,
    ).toBe("BashOutput(job-1)");
    expect(cell("stop_shell", { id: "job-1" }).title).toBe("KillShell(job-1)");
  });
});

describe("the saved sandbox choice", () => {
  it("is read from the global config, and the project's wins", () => {
    const home = scratch();
    const root = scratch();
    mkdirSync(join(home, ".devstation"), { recursive: true });
    writeFileSync(join(home, ".devstation", "config.json"), JSON.stringify({ sandbox: "off" }));
    expect(resolveSettings({ root, home, env: {} }).sandbox).toBe("off");

    mkdirSync(join(root, ".devstation"), { recursive: true });
    writeFileSync(join(root, ".devstation", "config.json"), JSON.stringify({ sandbox: "on" }));
    expect(resolveSettings({ root, home, env: {} }).sandbox).toBe("on");
  });

  it("warns about a value that is neither on nor off", () => {
    const home = scratch();
    mkdirSync(join(home, ".devstation"), { recursive: true });
    writeFileSync(join(home, ".devstation", "config.json"), JSON.stringify({ sandbox: "maybe" }));
    const resolved = resolveSettings({ root: scratch(), home, env: {} });
    expect(resolved.sandbox).toBeNull();
    expect(resolved.warnings.join(" ")).toContain('sandbox must be "on" or "off"');
  });
});
