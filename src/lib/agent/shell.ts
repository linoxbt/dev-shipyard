import { spawn } from "node:child_process";

// Running a command. The decision about whether it should be run at all
// lives in command-class.ts, which has no node imports so that the tool
// registry can use it in the browser.
//
// Re-exported here so every existing caller keeps working: this split is
// about what ends up in a bundle, not about changing an interface.
export {
  classifyCommand,
  destructivePatterns,
  operationForCommand,
  type CommandRisk,
} from "./command-class";

export interface ShellResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

const MAX_OUTPUT = 20_000;

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  const half = Math.floor(MAX_OUTPUT / 2);
  return `${text.slice(0, half)}\n… ${text.length - MAX_OUTPUT} characters omitted …\n${text.slice(-half)}`;
}

/**
 * Run a command and wait for it.
 *
 * Spawned detached so it gets its own process group, and killed by group
 * rather than by pid. `exec`'s own timeout sends SIGTERM to the direct child
 * only, which is why a hung `npm run dev` can survive as an orphan holding a
 * port: npm exits, the dev server it spawned does not. SIGTERM goes to the
 * group first, then SIGKILL after a grace period for anything that ignores it.
 */
export function runShell(
  command: string,
  opts: { cwd: string; timeoutMs?: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = {
    cwd: process.cwd(),
  },
): Promise<ShellResult> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const windows = process.platform === "win32";

  return new Promise((resolve) => {
    const child = spawn(command, {
      cwd: opts.cwd,
      shell: windows ? "powershell.exe" : "/bin/sh",
      detached: !windows,
      env: { ...process.env, ...opts.env },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const killGroup = (sig: NodeJS.Signals) => {
      try {
        if (!windows && child.pid) process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {
        /* already gone */
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      killGroup("SIGTERM");
      // Escalate rather than trust that SIGTERM was honoured.
      setTimeout(() => killGroup("SIGKILL"), 3_000);
    }, timeoutMs);

    const onAbort = () => {
      killGroup("SIGTERM");
      setTimeout(() => killGroup("SIGKILL"), 3_000);
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout?.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        ok: code === 0 && !timedOut,
        code,
        stdout: clip(stdout),
        stderr: clip(stderr),
        timedOut,
      });
    };

    child.on("close", finish);
    child.on("error", (err) => {
      stderr += `\n${err.message}`;
      finish(null);
    });
  });
}
