import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShell, type ShellResult } from "./shell";
import { looksLikeSecret } from "./workspace";

// Where a command actually runs.
//
// One interface with two implementations, chosen once per run: on this machine,
// or inside a container. `ShellResult` stays the contract, so nothing
// downstream of the executor knows or cares which it got.
//
// The seam exists because `command-class.ts` has always said, in its own
// header, that the deny-list is not the security boundary and that the boundary
// is the sandbox. Until now there was no sandbox on that path, so the comment
// described an intention rather than a fact.

export interface ExecOptions {
  cwd: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
  /** The command needs to reach the network. Honoured by implementations that
   *  can seal one off; the host executor has nothing to do with it. */
  network?: boolean;
}

/** A command left running in the background, as last seen. */
export interface BackgroundJob {
  id: string;
  command: string;
  running: boolean;
  exitCode: number | null;
  /** The end of what it has printed, stdout and stderr together. */
  output: string;
}

export type StartResult = { ok: true; id: string } | { ok: false; message: string };

export interface Executor {
  readonly kind: "host" | "sandbox";
  /** One line for `doctor`, the banner and the run header. It says what the
   *  user is actually getting, which matters most when it is the weaker of the
   *  two: somebody who believes they are sandboxed and is not is worse off
   *  than somebody who knows they are not. */
  readonly describe: string;
  run(command: string, opts: ExecOptions): Promise<ShellResult>;
  /** Release whatever was held open. Safe to call twice. */
  dispose(): Promise<void>;
  /** Start a command that keeps running after this returns: a dev server, a
   *  local chain, a watcher. Stopped when the executor is disposed. Absent
   *  where it cannot be done. */
  start?(command: string, opts: ExecOptions): Promise<StartResult>;
  /** What a background command has printed, and whether it is still running. */
  jobOutput?(id: string, maxBytes?: number): Promise<BackgroundJob | null>;
  /** Stop a background command. False when there is no such command. */
  stop?(id: string): Promise<boolean>;
}

/**
 * The environment a command is allowed to see.
 *
 * `runShell` used to hand the child `{ ...process.env }`, which meant every
 * command the agent ran had ANTHROPIC_API_KEY, GITHUB_TOKEN and everything
 * else in its environment. The redaction in `secrets.ts` scrubs key-shaped
 * values on the way back to the model, and that is worth having, but it is
 * cosmetic here: a command that HOLDS a credential can spend it, whatever the
 * model is shown afterwards. `curl -H "Authorization: $GITHUB_TOKEN"` never
 * needs to print anything.
 *
 * So the child gets what a build genuinely needs and nothing else. Anything a
 * particular command legitimately requires is passed explicitly by the caller.
 */
const ALLOWED_ENV = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TERM",
  "TZ",
  "CI",
  "SHELL",
  "USER",
  "LOGNAME",
  "TMPDIR",
  // Toolchains break in confusing ways without these, and none is a secret.
  "NODE_OPTIONS",
  "npm_config_cache",
  "PYTHONPATH",
  "JAVA_HOME",
  // Where tools keep their configuration, including gh's login. Locations,
  // not secrets: the token itself stays in the file they point at.
  "GH_CONFIG_DIR",
  "XDG_CONFIG_HOME",
] as const;

export function allowedEnv(
  from: NodeJS.ProcessEnv = process.env,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of ALLOWED_ENV) {
    if (from[key] !== undefined) out[key] = from[key];
  }
  return { ...out, ...extra };
}

/**
 * Refuse a command that names a file the workspace would not let the agent
 * read.
 *
 * `read_file` refuses `.env`, `*.pem`, `id_rsa` and the rest, with a reason.
 * `cat` is on the read-only allow-list, so `run_shell {"command":"cat .env"}`
 * walked straight past that and asked nobody. This closes the obvious version.
 *
 * It is a word match over the command, and it is not a boundary: `cat $(echo
 * .env)`, a base64'd path, or a script that reads the file all get through.
 * The real answers are the sandbox and not having secrets to find. This stops
 * the accident and the first thing anyone tries.
 */
export function refusedForSecret(command: string): string | null {
  for (const token of command.split(/[\s;&|<>()"']+/)) {
    const path = token.replace(/^\.\//, "");
    if (!path || path.startsWith("-")) continue;
    if (looksLikeSecret(path)) {
      return (
        `That command names ${path}, which looks like a credentials file, so it was not run. ` +
        "Ask the user for anything you need from it."
      );
    }
  }
  return null;
}

/** Commands run directly on this machine, as this user. What the agent has
 *  always done, minus the parent's secrets. */
export function hostExecutor(): Executor {
  const jobs = new Map<
    string,
    { command: string; child: ChildProcess; log: string; running: boolean; exitCode: number | null }
  >();
  let count = 0;
  const logDir = join(tmpdir(), `devstation-jobs-${process.pid}`);

  const stop = async (id: string): Promise<boolean> => {
    const job = jobs.get(id);
    if (!job) return false;
    const pid = job.child.pid;
    if (job.running && pid) {
      // The whole group: a dev server started through npm is npm's child.
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        /* already gone */
      }
      setTimeout(() => {
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          /* gone */
        }
      }, 3_000).unref();
    }
    return true;
  };

  return {
    kind: "host",
    describe: "on this machine, unsandboxed",
    run(command, opts) {
      const refusal = refusedForSecret(command);
      if (refusal) return Promise.resolve(failedResult(refusal));
      const { network: _network, env, ...rest } = opts;
      return runShell(command, { ...rest, env: allowedEnv(process.env, env) });
    },
    async start(command, opts) {
      const refusal = refusedForSecret(command);
      if (refusal) return { ok: false, message: refusal };
      if (process.platform === "win32") {
        return { ok: false, message: "Background commands are not supported on Windows yet." };
      }
      mkdirSync(logDir, { recursive: true });
      const id = `job-${++count}`;
      const log = join(logDir, `${id}.log`);
      const fd = openSync(log, "a");
      const child = spawn(command, {
        cwd: opts.cwd,
        shell: "/bin/sh",
        // Its own process group, so stopping it stops everything it started.
        detached: true,
        env: allowedEnv(process.env, opts.env),
        stdio: ["ignore", fd, fd],
      });
      closeSync(fd);
      const job = { command, child, log, running: true, exitCode: null as number | null };
      child.on("exit", (code) => {
        job.running = false;
        job.exitCode = code;
      });
      child.on("error", () => {
        job.running = false;
      });
      // Never the reason the CLI stays open.
      child.unref();
      jobs.set(id, job);
      return { ok: true, id };
    },
    async jobOutput(id, maxBytes = 20_000) {
      const job = jobs.get(id);
      if (!job) return null;
      let output = "";
      try {
        const data = readFileSync(job.log);
        output = data.subarray(Math.max(0, data.length - maxBytes)).toString("utf8");
      } catch {
        /* nothing printed yet */
      }
      return { id, command: job.command, running: job.running, exitCode: job.exitCode, output };
    },
    stop,
    async dispose() {
      // Background commands end with the session that started them.
      for (const id of jobs.keys()) await stop(id);
    },
  };
}

/** A result shaped like a command that never got to run. Used by every
 *  implementation for its own failures, so a sandbox that cannot start reads
 *  the same way as a command that failed, rather than throwing into the middle
 *  of a turn. */
export function failedResult(message: string): ShellResult {
  return { ok: false, code: null, stdout: "", stderr: message, timedOut: false };
}
