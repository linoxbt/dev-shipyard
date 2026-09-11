import { spawn } from "node:child_process";

// Running a command, and deciding how dangerous it is first.
//
// The classification below is NOT the security boundary. A deny-list of
// dangerous commands can always be worked around — base64, a shell variable, a
// script that writes another script — and treating it as the thing keeping the
// host safe is how people end up surprised. The boundary is the sandbox: a
// scoped workspace, and in hardened mode a container with no network and a
// read-only root. What this does is decide when to ASK, which is a different
// job and one a heuristic is allowed to do imperfectly.
//
// So the default is "needs approval". A small allow-list of genuinely
// read-only commands runs without asking; a deny-list escalates to
// always-ask-even-in-full-auto. Anything unrecognised lands in the middle
// rather than being assumed safe.

export type CommandRisk = "safe" | "writes" | "destructive";

/** Commands that only read. The first word of the command has to be one of
 *  these AND the whole command has to be free of the shell metacharacters that
 *  would let something else ride along. */
const READ_ONLY = new Set([
  "ls",
  "pwd",
  "echo",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "find",
  "which",
  "file",
  "stat",
  "du",
  "df",
  "date",
  "whoami",
  "env",
  "printenv",
  "sort",
  "uniq",
  "diff",
  "tree",
  "node",
  "bun",
  "python",
  "python3",
  "go",
  "cargo",
  "tsc",
]);

/** Read-only subcommands of tools whose other subcommands are not. */
const READ_ONLY_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set(["status", "log", "diff", "show", "branch", "remote", "rev-parse", "ls-files"]),
  npm: new Set(["ls", "list", "view", "outdated", "--version", "-v"]),
  bun: new Set(["--version", "-v", "pm"]),
  docker: new Set(["ps", "images", "version"]),
};

/** Anything that can destroy work or reach past the workspace. Kept per
 *  platform: `rm -rf` is not a real command on Windows, so a POSIX-only list
 *  would wave through the PowerShell equivalent — a safety gap, not merely a
 *  portability one. */
const DESTRUCTIVE_POSIX: RegExp[] = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i,
  /\brm\s+-[a-z]*r/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bchmod\s+(-R\s+)?[0-7]*777/i,
  /\bchown\s+-R\b/i,
  /:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;/, // fork bomb
  /\bsudo\b/i,
  /\bsu\s+-/i,
  />\s*\/dev\/(sd|nvme|disk)/i,
  /\bshutdown\b|\breboot\b|\bhalt\b/i,
  /\bkillall\b|\bpkill\s+-9/i,
  /\bcurl\b[^|]*\|\s*(ba)?sh/i, // pipe-to-shell
  /\bwget\b[^|]*\|\s*(ba)?sh/i,
  /\bgit\s+push\b[^\n]*(--force|-f)\b/i,
  /\bgit\s+reset\b[^\n]*--hard/i,
  /\bgit\s+clean\b[^\n]*-[a-z]*f/i,
  /\bgit\s+branch\b[^\n]*-D\b/i,
  /\bnpm\s+publish\b/i,
];

const DESTRUCTIVE_WINDOWS: RegExp[] = [
  /Remove-Item\b[^\n]*-Recurse/i,
  /Remove-Item\b[^\n]*-Force/i,
  /\brmdir\b[^\n]*\/s/i,
  /\bdel\b[^\n]*\/[qsf]/i,
  /Format-Volume\b/i,
  /Clear-Disk\b/i,
  /Stop-Computer\b|Restart-Computer\b/i,
  /Set-ExecutionPolicy\b/i,
  /Invoke-WebRequest\b[^\n]*\|\s*Invoke-Expression/i,
  /\biex\b\s*\(/i,
];

/** Metacharacters that chain, redirect or substitute. Their presence means the
 *  first word no longer tells you what the command does. */
const CHAINING = /[;&|`$><]|\$\(|&&|\|\|/;

export function destructivePatterns(platform: NodeJS.Platform = process.platform): RegExp[] {
  return platform === "win32" ? [...DESTRUCTIVE_WINDOWS, ...DESTRUCTIVE_POSIX] : DESTRUCTIVE_POSIX;
}

export function classifyCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
): CommandRisk {
  const trimmed = command.trim();
  if (!trimmed) return "safe";

  // Destructive wins over everything, including an allow-listed first word:
  // "ls && rm -rf /" starts with ls.
  for (const pattern of destructivePatterns(platform)) {
    if (pattern.test(trimmed)) return "destructive";
  }

  if (CHAINING.test(trimmed)) return "writes";

  const [head, sub] = trimmed.split(/\s+/);
  const subcommands = READ_ONLY_SUBCOMMANDS[head];
  if (subcommands) return sub && subcommands.has(sub) ? "safe" : "writes";
  if (READ_ONLY.has(head)) return "safe";
  return "writes";
}

/** The policy operation a command maps to, so risk is decided by the same
 *  engine as everything else rather than by a second set of rules here. */
export function operationForCommand(command: string): string {
  switch (classifyCommand(command)) {
    case "safe":
      return "project.inspect";
    case "destructive":
      return "shell.exec";
    default:
      return "shell.write";
  }
}

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
