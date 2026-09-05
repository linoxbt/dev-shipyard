// Running one phase of a job inside a throwaway container.
//
// Everything here is about limiting what model-written code can reach. The
// container gets no host mount, no capabilities, no writable root and, for
// every phase except install: no network at all. Files go in through a tar
// stream on stdin and come back the same way, so the host filesystem is never
// exposed to the job.

import { spawn } from "node:child_process";
import { LIMITS, NETWORK_PHASES, PHASE_COMMANDS, phaseTimeout, type PhaseName } from "./limits";

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;

/** Strip terminal colour codes.
 *
 *  npm and vite emit them even with CI=true, and every consumer of this output
 *  is something other than a terminal: a JSON API, a language model reading an
 *  error, and an HTML dashboard where the raw escapes render as mojibake.
 *  Stripped from the finished string rather than each chunk, so a sequence
 *  split across two reads is still matched whole. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

export interface PhaseResult {
  phase: PhaseName;
  ok: boolean;
  exitCode: number | null;
  /** Combined stdout+stderr, truncated at LIMITS.maxLogBytes. */
  log: string;
  durationMs: number;
  timedOut: boolean;
}

export interface RunOptions {
  image: string;
  /** Container that persists across phases of one job, so `install` results
   *  are still there for `build`. */
  containerName: string;
}

function run(
  cmd: string,
  args: string[],
  opts: { input?: Buffer; timeoutMs: number; capture?: boolean } = {
    timeoutMs: LIMITS.phaseTimeoutMs,
  },
): Promise<{ code: number | null; out: string; timedOut: boolean; stdout: Buffer }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let out = "";
    let bytes = 0;
    let timedOut = false;

    const append = (b: Buffer) => {
      if (bytes >= LIMITS.maxLogBytes) return;
      const room = LIMITS.maxLogBytes - bytes;
      const slice = b.length > room ? b.subarray(0, room) : b;
      bytes += slice.length;
      out += slice.toString("utf8");
      if (bytes >= LIMITS.maxLogBytes) out += "\n… output truncated …";
    };

    if (opts.capture) child.stdout.on("data", (b: Buffer) => chunks.push(b));
    else child.stdout.on("data", append);
    child.stderr.on("data", append);

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, timedOut, stdout: Buffer.concat(chunks) });
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: null, out: out + String(e), timedOut, stdout: Buffer.alloc(0) });
    });

    if (opts.input) {
      child.stdin.write(opts.input);
    }
    child.stdin.end();
  });
}

/** Attach or detach the bridge network.
 *
 *  Both directions throw on failure, and that is deliberate. Docker reports a
 *  refused `network connect` on stderr with a non-zero exit and carries on
 *  quite happily; swallowing that once already cost a debugging session, where
 *  every install ran with no network and simply timed out after three minutes
 *  with an empty log. Failing to detach is worse still: it would leave
 *  model-written code running with an open network, so that aborts the job. */
async function setNetwork(name: string, connected: boolean): Promise<void> {
  const verb = connected ? "connect" : "disconnect";
  const res = await run("docker", ["network", verb, "bridge", name], { timeoutMs: 20_000 });
  if (res.code !== 0) {
    throw new Error(`Could not ${verb} the job network: ${res.out.slice(0, 400)}`);
  }
}

/** Create the job container.
 *
 *  It starts WITH the network and loses it for good after the last phase that
 *  needs one. That is the opposite of what you would want, and it is forced by
 *  gVisor: the sandbox configures its netstack when it starts, and an interface
 *  hot-plugged afterwards never reaches it. `docker network connect` on a
 *  running runsc container reports success and leaves DNS resolving nothing, so
 *  npm fails with EAI_AGAIN, which is invisible until a project asks for a
 *  package the warm image does not already carry.
 *
 *  Cutting the network works fine in that direction, so the order is reversed:
 *  attached at creation, detached once, never reattached. Nothing of the job
 *  runs before install anyway: the container sleeps while its files are
 *  unpacked, so the window where it can reach out is the same one it always
 *  had.
 *
 *  Created on the bridge and detached a moment later, rather than created with
 *  `--network none`. Docker refuses to connect a second network to a container
 *  in "private (none) mode", so a container born with no network can never be
 *  given one: install could never reach the registry. Detaching from the
 *  bridge leaves exactly the same isolation and can be reversed. Nothing of the
 *  job's runs in the gap: the container sleeps until the files are unpacked. */
/** Container runtime for job containers.
 *
 *  gVisor (`runsc`) by default. It puts a user-space kernel between the job and
 *  the host's: syscalls are serviced by gVisor rather than passed through, so a
 *  Linux kernel bug is no longer one hop from the host. That matters more here
 *  than it would elsewhere, because this runs beside other projects and their
 *  secrets rather than on a throwaway machine.
 *
 *  Set RUNNER_RUNTIME=runc to opt out. The default is the safe one on purpose:
 *  a deployment that has not installed gVisor should fail loudly at container
 *  creation, not quietly run model-written code with weaker isolation.
 */
const RUNTIME = process.env.RUNNER_RUNTIME ?? "runsc";

export async function createContainer(image: string, name: string): Promise<string> {
  const res = await run(
    "docker",
    [
      "create",
      "--name",
      name,
      "--runtime",
      RUNTIME,
      "--network",
      "bridge",
      "--memory",
      LIMITS.memory,
      "--memory-swap",
      LIMITS.memory, // no swap: the memory cap means something
      "--cpus",
      LIMITS.cpus,
      "--pids-limit",
      String(LIMITS.pidsLimit),
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      // The only writable paths. A tmpfs is created root-owned, so mode 1777
      // (world-writable + sticky, like /tmp) is what lets the unprivileged job
      // user actually write to it.
      // noexec on /tmp stops a dropped binary being run from there.
      "--tmpfs",
      "/tmp:rw,noexec,nosuid,mode=1777,size=256m",
      "--tmpfs",
      "/home/runner:rw,nosuid,mode=1777,size=64m",
      // The workspace must allow exec: node_modules/.bin lives here, and
      // packages with a postinstall (esbuild, and so vite) run their own
      // downloaded binary. `exec` has to be asked for explicitly, every tmpfs
      // docker mounts is noexec by default, and `--mount type=tmpfs` offers no
      // way to say otherwise, which is why this is `--tmpfs` while the rest are
      // not. Without it npm fails inside a postinstall with a bare EACCES that
      // names the binary but not the reason.
      "--tmpfs",
      "/work:rw,exec,nosuid,mode=1777,size=768m",
      "--workdir",
      "/work",
      "--user",
      "1000:1000",
      "--env",
      "HOME=/home/runner",
      "--env",
      "npm_config_cache=/tmp/npm",
      "--env",
      "CI=true",
      // Playwright's browser is baked into the image; without this it looks
      // for one under $HOME and tries to download it, which the test phase has
      // no network to do.
      "--env",
      "PLAYWRIGHT_BROWSERS_PATH=/opt/playwright",
      image,
      "sleep",
      String(Math.ceil(LIMITS.jobTimeoutMs / 1000)),
    ],
    { timeoutMs: 30_000 },
  );
  if (res.code !== 0)
    throw new Error(`Could not create the job container: ${res.out.slice(0, 400)}`);
  const started = await run("docker", ["start", name], { timeoutMs: 30_000 });
  if (started.code !== 0) {
    throw new Error(`Could not start the job container: ${started.out.slice(0, 400)}`);
  }
  return name;
}

export async function destroyContainer(name: string): Promise<void> {
  await run("docker", ["rm", "-f", name], { timeoutMs: 30_000 });
  detached.delete(name);
}

/** Unpack the project into the container's workspace.
 *
 *  Deliberately `docker exec … tar -x` rather than `docker cp`. The workspace
 *  is a tmpfs mount, and `docker cp` into one silently writes nowhere: it
 *  reports success and the files simply are not there. Extracting from inside
 *  the container writes to the actual mount, and as the job user, so the
 *  ownership is right too. */
export async function putFiles(name: string, tar: Buffer): Promise<void> {
  const res = await run(
    "docker",
    [
      "exec",
      "-i",
      "--workdir",
      "/work",
      "--user",
      "1000:1000",
      name,
      "tar",
      "-xf",
      "-",
      "-C",
      "/work",
    ],
    { input: tar, timeoutMs: 60_000 },
  );
  if (res.code !== 0)
    throw new Error(`Could not unpack files into the job: ${res.out.slice(0, 400)}`);
}

/** Read a directory back out of the container as a tar archive. */
export async function getDir(name: string, dir: string): Promise<Buffer | null> {
  const res = await run(
    "docker",
    ["exec", "--user", "1000:1000", name, "tar", "-cf", "-", "-C", "/work", dir],
    { timeoutMs: 60_000, capture: true },
  );
  if (res.code !== 0 || res.stdout.length === 0) return null;
  if (res.stdout.length > LIMITS.maxOutputBytes) return null;
  return res.stdout;
}

/** Containers whose network has been cut. Cutting is one-way: see
 *  createContainer for why, so this records that it has happened rather than
 *  toggling anything. Cleared when the container is destroyed. */
const detached = new Set<string>();

/** Run one phase.
 *
 *  The network is present from creation and removed before the first phase that
 *  does not need it, permanently. Every phase after install therefore runs with
 *  no route out, which is the control that stops model-written code phoning
 *  home from a build or a test. */
export async function runPhase(
  name: string,
  phase: PhaseName,
  extraArgs: string[] = [],
): Promise<PhaseResult> {
  const started = Date.now();
  const needsNetwork = NETWORK_PHASES.has(phase);

  if (needsNetwork && detached.has(name)) {
    // Refuse rather than run it without a registry and report a confusing
    // failure. Reattaching is not an option under gVisor.
    throw new Error(
      `Cannot run "${phase}" after the job network has been cut: order the phases with install first.`,
    );
  }
  if (!needsNetwork && !detached.has(name)) {
    await setNetwork(name, false);
    detached.add(name);
  }
  try {
    const cmd = [...PHASE_COMMANDS[phase], ...extraArgs];
    const res = await run(
      "docker",
      ["exec", "--workdir", "/work", "--user", "1000:1000", name, ...cmd],
      { timeoutMs: phaseTimeout(phase) },
    );
    return {
      phase,
      ok: res.code === 0,
      exitCode: res.code,
      log: stripAnsi(res.out),
      durationMs: Date.now() - started,
      timedOut: res.timedOut,
    };
  } finally {
    if (needsNetwork) {
      // Drop it as soon as the last networked phase is done, even if that phase
      // threw, rather than waiting for the next phase to ask.
      await setNetwork(name, false);
      detached.add(name);
    }
  }
}

export async function dockerAvailable(): Promise<boolean> {
  const res = await run("docker", ["version", "--format", "{{.Server.Version}}"], {
    timeoutMs: 15_000,
  });
  return res.code === 0;
}

/** The runtime jobs are actually created with. */
export function jobRuntime(): string {
  return RUNTIME;
}

/** Is that runtime registered with the daemon?
 *
 *  Reported by /health so a box missing gVisor is visible before a job fails
 *  with a docker error nobody reads. */
export async function runtimeAvailable(): Promise<boolean> {
  const res = await run("docker", ["info", "--format", "{{json .Runtimes}}"], {
    timeoutMs: 15_000,
  });
  if (res.code !== 0) return false;
  try {
    return Object.keys(JSON.parse(res.out) as Record<string, unknown>).includes(RUNTIME);
  } catch {
    return false;
  }
}
