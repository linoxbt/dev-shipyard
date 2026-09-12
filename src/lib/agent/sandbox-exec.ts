import { randomBytes } from "node:crypto";
import { existsSync, statSync, unlinkSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { runShell, type ShellResult } from "./shell";
import {
  allowedEnv,
  failedResult,
  refusedForSecret,
  type Executor,
  type ExecOptions,
} from "./executor";
import { detectManifests, type Ecosystem } from "./project";

// Running the agent's commands inside a container.
//
// A different problem from the sandbox in services/runner, which takes a file
// map in and hands a tar back and never mounts anything from the host. The
// agent edits a directory that has to persist and still be there when the
// container is gone, so this one bind-mounts the workspace. That single
// difference drives almost everything below.
//
// WHAT IT PROTECTS, precisely, because a sandbox people misunderstand is worse
// than no sandbox at all:
//
//   Protected:     $HOME, ~/.ssh, ~/.aws, every other project on the disk, the
//                  host's processes, the host environment, the kernel (gVisor),
//                  resource exhaustion, and orphaned processes: `docker rm -f`
//                  kills the hung dev server the host executor cannot.
//   NOT protected: the workspace itself. It is mounted read-write because
//                  editing it is the entire point, so `rm -rf .` inside the
//                  container still destroys the project, and .git lives there
//                  too, so the agent can destroy its own undo history.
//                  Checkpoints cover that. This does not.
//                  Nor the file tools, which run host-side through Workspace;
//                  nor MCP servers, which McpHub spawns on the host; nor
//                  fetch_url, a deliberate GET-only hole guarded by web.ts.
//
// NEVER mount /var/run/docker.sock into this container. One line, and the
// sandbox becomes a more complicated way of being root on the host.
//
// One container per session, not per command. Measured on the development box:
// a `docker run --rm` round trip is about 1.7s under runsc, and a `docker exec`
// into a container that is already up is 150-300ms. Per-command containers
// would put two seconds on every step of every run.

export const DEFAULT_IMAGE = "devstation-sandbox:1";
const DEFAULT_RUNTIME = "runsc";
const LABEL = "devstation.agent";

export interface SandboxOptions {
  workspace: string;
  /**
   * Give the session container internet access. The CLI turns it on, because
   * a coding agent that cannot install a package, clone a repository or call an
   * API from its shell is not much of one, and the workspace boundary is what
   * the container is for. The runner leaves it off: its goals arrive from the
   * internet with nobody watching.
   */
  network?: boolean;
  image?: string;
  runtime?: string;
  lifetimeMs?: number;
  memory?: string;
  cpus?: string;
  pidsLimit?: number;
}

export function imageFor(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEVSTATION_SANDBOX_IMAGE || DEFAULT_IMAGE;
}

export function runtimeFor(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEVSTATION_SANDBOX_RUNTIME || DEFAULT_RUNTIME;
}

/**
 * Everything is slower under a user-space kernel.
 *
 * The agent's timeouts were all measured on the host. services/runner's
 * limits.ts already records 1.4-3.2x for the same work under gVisor, and it
 * widened its install timeout for exactly this reason. Without scaling, every
 * install in the sandbox times out and the first week of using it is spent
 * bisecting timeouts that were never wrong.
 */
export function timeoutScale(runtime: string): number {
  return runtime === "runsc" ? 2.5 : 1;
}

// --- what is on this machine ------------------------------------------------

export interface SandboxReadiness {
  docker: boolean;
  runtime: boolean;
  image: boolean;
  runtimeName: string;
  imageName: string;
}

export async function sandboxReadiness(
  env: NodeJS.ProcessEnv = process.env,
): Promise<SandboxReadiness> {
  const runtimeName = runtimeFor(env);
  const imageName = imageFor(env);
  const cwd = process.cwd();
  const opts = { cwd, timeoutMs: 20_000 };

  const version = await runShell("docker version --format '{{.Server.Version}}'", opts);
  if (!version.ok) {
    return { docker: false, runtime: false, image: false, runtimeName, imageName };
  }

  const runtimes = await runShell("docker info --format '{{json .Runtimes}}'", opts);
  let runtime = false;
  try {
    runtime =
      runtimes.ok &&
      Object.keys(JSON.parse(runtimes.stdout.trim()) as Record<string, unknown>).includes(
        runtimeName,
      );
  } catch {
    runtime = false;
  }

  const image = await runShell(`docker image inspect ${quote(imageName)}`, opts);
  return { docker: true, runtime, image: image.ok, runtimeName, imageName };
}

/** One sentence saying what is missing and what to do, or null when nothing
 *  is. Written to be pasted into a terminal rather than searched for. */
export function readinessProblem(readiness: SandboxReadiness): string | null {
  if (!readiness.docker) {
    return (
      "The sandbox needs Docker, which is not running here. Start it, " +
      "or run with --no-sandbox to execute commands directly on this machine."
    );
  }
  if (!readiness.runtime) {
    return (
      `The sandbox is set to use the ${readiness.runtimeName} runtime, which Docker does not have ` +
      "registered. Install gVisor and register it, set DEVSTATION_SANDBOX_RUNTIME=runc for " +
      "container isolation without it, or run with --no-sandbox."
    );
  }
  if (!readiness.image) {
    return (
      `The sandbox image ${readiness.imageName} is not built. Build it with ` +
      "`bun run sandbox:image`, point DEVSTATION_SANDBOX_IMAGE at another one, " +
      "or run with --no-sandbox."
    );
  }
  return null;
}

// --- does the image carry what this project needs ---------------------------

const NEEDS: Record<Ecosystem, string[]> = {
  npm: ["node"],
  pip: ["python3"],
  cargo: ["cargo"],
  go: ["go"],
};

export interface ProbeResult {
  ok: boolean;
  missing: string[];
  ecosystems: Ecosystem[];
}

/**
 * Check the image before the first command rather than after.
 *
 * Without this, pointing the sandbox at an image that lacks the project's
 * toolchain fails as `cargo: not found` somewhere in the middle of a run,
 * which reads as the agent being broken rather than the image being wrong.
 */
export async function probeImage(
  workspace: string,
  image: string,
  runtime: string,
): Promise<ProbeResult> {
  const ecosystems = gatingEcosystems(detectManifests(workspace));
  const wanted = [...new Set(ecosystems.flatMap((e) => NEEDS[e]))];
  if (wanted.length === 0) return { ok: true, missing: [], ecosystems };

  const check = wanted.map((b) => `command -v ${b} >/dev/null || echo ${b}`).join("; ");
  const result = await runShell(
    `docker run --rm --runtime ${quote(runtime)} --network none --entrypoint sh ` +
      `${quote(image)} -c ${quote(check)}`,
    { cwd: workspace, timeoutMs: 60_000 },
  );

  // A probe that could not run is not a project missing a tool. Saying "cargo
  // is missing" because docker failed would send somebody to fix the wrong
  // thing.
  if (!result.ok) return { ok: true, missing: [], ecosystems };

  const missing = result.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { ok: missing.length === 0, missing, ecosystems };
}

/**
 * Which toolchains the image has to carry: only those of the project at the
 * workspace ROOT.
 *
 * The scan goes two directories deep, which is right for finding a monorepo's
 * packages and wrong for deciding what a session needs. Run from a home
 * directory it found 68 npm, 2 pip and 4 cargo projects belonging to other
 * repositories, and one Rust folder among them refused the whole session. A
 * nested project's toolchain is that project's concern, not a precondition for
 * starting at all.
 */
export function gatingEcosystems(manifests: { dir: string; ecosystem: Ecosystem }[]): Ecosystem[] {
  return [...new Set(manifests.filter((m) => m.dir === "").map((m) => m.ecosystem))];
}

/** A warning, not a refusal. Missing cargo means cargo commands fail inside the
 *  sandbox; it does not mean the agent cannot read, edit and run everything
 *  else. Stopping the session over it was out of all proportion. */
export function probeProblem(probe: ProbeResult, image: string): string | null {
  if (probe.ok) return null;
  return (
    `The sandbox image ${image} has no ${probe.missing.join(", ")}, which this ${probe.ecosystems.join(" and ")} ` +
    "project uses, so commands that need it will fail inside the sandbox. Build an image that has it " +
    "and set DEVSTATION_SANDBOX_IMAGE, or run with --no-sandbox."
  );
}

// --- building the commands --------------------------------------------------

function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * Who to run as inside the container.
 *
 * The workspace is bind-mounted from the host, so a container running as
 * anybody else leaves files in the project that the person who owns it cannot
 * edit. Mirroring the host uid is the only option that does not do that.
 *
 * On a host running as root this means root inside the container, which is
 * weaker than an unprivileged uid, and `describe` says so rather than reporting
 * a flat "sandboxed".
 */
export function userFlag(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : 0;
  const gid = typeof process.getgid === "function" ? process.getgid() : 0;
  return `${uid}:${gid}`;
}

export interface CreateArgs {
  name: string;
  workspace: string;
  image: string;
  runtime: string;
  network: boolean;
  lifetimeSeconds: number;
  memory: string;
  cpus: string;
  pidsLimit: number;
  user: string;
  session: string;
}

/**
 * The full `docker create` command, as a pure function.
 *
 * Pure so the flags can be asserted in a test on a machine with no Docker at
 * all, which is what makes the security-relevant ones reviewable in a diff
 * rather than buried in a string concatenation. Every flag is load-bearing:
 *
 *   --init              PID 1 would otherwise be `sleep`, which never reaps.
 *                       Over a long session zombies accumulate against
 *                       --pids-limit and surface as "fork: Resource
 *                       temporarily unavailable" thirty steps in.
 *   --read-only         the image is not writable, so nothing persists in it
 *   --cap-drop ALL      no capabilities, not even the default set
 *   --security-opt      a setuid binary inside cannot gain privileges
 *   --network none      nothing reaches out unless the caller asked
 *   --memory/--cpus     a runaway hits a limit rather than the host
 *   --pids-limit        a fork bomb hits this
 *   --tmpfs /tmp exec   build tools extract and run binaries from TMPDIR, so
 *                       unlike the runner's sandbox this cannot be noexec. It
 *                       buys little here anyway: /work must be exec, because
 *                       that is where node_modules/.bin lives.
 *   sleep <deadline>    the container ends itself if we never get to
 */
export function createCommand(args: CreateArgs): string {
  return [
    "docker create",
    `--name ${quote(args.name)}`,
    `--label ${quote(`${LABEL}=1`)}`,
    `--label ${quote(`devstation.session=${args.session}`)}`,
    `--runtime ${quote(args.runtime)}`,
    args.network ? "--network bridge" : "--network none",
    "--init",
    `--memory ${quote(args.memory)}`,
    `--memory-swap ${quote(args.memory)}`,
    `--cpus ${quote(args.cpus)}`,
    `--pids-limit ${args.pidsLimit}`,
    "--cap-drop ALL",
    "--security-opt no-new-privileges",
    "--read-only",
    "--tmpfs /tmp:rw,exec,nosuid,mode=1777,size=1g",
    `--volume ${quote(`${args.workspace}:/work:rw`)}`,
    "--workdir /work",
    `--user ${quote(args.user)}`,
    "--env HOME=/tmp",
    "--env CI=true",
    quote(args.image),
    "sleep",
    String(args.lifetimeSeconds),
  ].join(" ");
}

/**
 * Where inside the container a command should run.
 *
 * The workspace is mounted at /work, so a cwd inside it maps to a path under
 * /work. Everything used to run at /work regardless of what the caller asked
 * for, which is wrong in a monorepo: the orchestrator passes the manifest's
 * directory for `run_tests` and `run_build`, so a project with its package.json
 * in apps/web had its tests run from the repository root instead.
 *
 * A cwd outside the workspace returns null and the command is refused rather
 * than quietly running somewhere else. That silence is what hid this: the
 * benchmark harness built a sandbox around the wrong directory and every task
 * ran its commands against this repository without a word.
 */
export function workdirFor(workspace: string, cwd: string): string | null {
  const rel = relative(resolve(workspace), resolve(cwd));
  if (rel === "") return "/work";
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return `/work/${rel.split(sep).join("/")}`;
}

/**
 * One command, run inside the container under its own deadline.
 *
 * The timeout has to be enforced INSIDE. `runShell` kills by process group, and
 * killing the local `docker exec` client leaves the process running in the
 * container holding CPU and the pids budget, which also makes `timedOut` a lie.
 * coreutils `timeout` is in the image and returns 124 when it fires.
 *
 * The command reaches the shell through an environment variable rather than
 * being spliced into a second shell string. Splicing is exactly how the git
 * tool ended up with an injection hole, and the whole point of this file is to
 * be the thing that contains a command, not another way to run one.
 */
export function execCommand(
  name: string,
  command: string,
  timeoutSeconds: number,
  workdir = "/work",
): string {
  return [
    "docker exec",
    `--workdir ${quote(workdir)}`,
    `--env ${quote(`DEVSTATION_CMD=${command}`)}`,
    quote(name),
    "sh -c",
    quote(`timeout --kill-after=5s ${timeoutSeconds}s sh -c "$DEVSTATION_CMD"`),
  ].join(" ");
}

/** Exit codes that mean something other than "your command failed", turned
 *  into a sentence. Without this the model reads a killed command as a failing
 *  test and thrashes against it. */
export function explainExit(code: number | null, memory: string): string | null {
  if (code === 124 || code === 137) {
    return code === 124
      ? "(killed: this command ran past its time limit in the sandbox)"
      : `(killed: the sandbox ran out of memory at ${memory})`;
  }
  return null;
}

// --- the container ----------------------------------------------------------

const DEFAULTS = {
  lifetimeMs: 30 * 60_000,
  // 1g is sized for a generated toy app. tsc plus a test runner on a real repo
  // exceeds it, and an OOM kill is exit 137, which is indistinguishable from a
  // failing test unless it is explained.
  memory: "4g",
  cpus: "2.0",
  // npm plus tsc plus worker threads exceeds 256 on real projects.
  pidsLimit: 512,
};

/** Containers left behind by a run that was killed rather than finished.
 *  services/runner's sandbox.test.ts learned this the hard way; inherit it. */
export async function sweepStale(cwd = process.cwd()): Promise<number> {
  const list = await runShell(`docker ps -aq --filter ${quote(`label=${LABEL}=1`)}`, {
    cwd,
    timeoutMs: 30_000,
  });
  const ids = list.stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (ids.length === 0) return 0;
  await runShell(`docker rm -f ${ids.join(" ")}`, { cwd, timeoutMs: 60_000 });
  return ids.length;
}

/** Whether the CLI's sandbox should have internet access.
 *  DEVSTATION_SANDBOX_NETWORK=off seals it. */
export function sandboxNetworkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DEVSTATION_SANDBOX_NETWORK ?? "on").toLowerCase() !== "off";
}

export function sandboxExecutor(options: SandboxOptions): Executor {
  const image = options.image ?? imageFor();
  const runtime = options.runtime ?? runtimeFor();
  const lifetimeMs = options.lifetimeMs ?? DEFAULTS.lifetimeMs;
  const memory = options.memory ?? DEFAULTS.memory;
  const scale = timeoutScale(runtime);
  const user = userFlag();
  const session = randomBytes(5).toString("hex");
  const sealedName = `devstation-agent-${session}`;

  let sealed: string | null = null;
  let disposed = false;

  const create = async (name: string, network: boolean): Promise<string | null> => {
    const created = await runShell(
      createCommand({
        name,
        session,
        workspace: options.workspace,
        image,
        runtime,
        network,
        lifetimeSeconds: Math.ceil(lifetimeMs / 1000),
        memory,
        cpus: options.cpus ?? DEFAULTS.cpus,
        pidsLimit: options.pidsLimit ?? DEFAULTS.pidsLimit,
        user,
      }),
      { cwd: options.workspace, timeoutMs: 60_000 },
    );
    if (!created.ok) return null;

    const started = await runShell(`docker start ${quote(name)}`, {
      cwd: options.workspace,
      timeoutMs: 60_000,
    });
    if (!started.ok) {
      await remove(name);
      return null;
    }
    return name;
  };

  /**
   * Check the ownership rather than assume it.
   *
   * This is the scariest failure in the feature. If the container writes as the
   * wrong uid into a bind mount of a real project, the host's git starts
   * reporting dubious ownership, `checkpoint()` fails, and undo silently stops
   * working, which is the safety net people turned the sandbox on for. It also
   * catches macOS, where virtiofs remaps ownership regardless of what --user
   * asked for, so what matters is the observed result and not the request.
   */
  const verifyOwnership = async (name: string): Promise<string | null> => {
    const probe = `.devstation-uid-probe-${session}`;
    const path = join(options.workspace, probe);
    const written = await runShell(execCommand(name, `touch ${quote(probe)}`, 20), {
      cwd: options.workspace,
      timeoutMs: 30_000,
    });
    if (!written.ok || !existsSync(path)) {
      return "The sandbox could not write to the workspace. Check the mount and try --no-sandbox.";
    }
    try {
      const stat = statSync(path);
      const [uid, gid] = user.split(":").map(Number);
      if (stat.uid !== uid || stat.gid !== gid) {
        return (
          `The sandbox writes files as ${stat.uid}:${stat.gid} but this account is ${user}. ` +
          "Files it creates would not be yours to edit, and git would stop trusting the " +
          "repository, so it was not started. Run with --no-sandbox, or set " +
          "DEVSTATION_SANDBOX_USER."
        );
      }
      return null;
    } finally {
      try {
        unlinkSync(path);
      } catch {
        /* the probe is gone either way */
      }
    }
  };

  const remove = async (name: string) => {
    await runShell(`docker rm -f ${quote(name)}`, {
      cwd: options.workspace,
      timeoutMs: 30_000,
    }).catch(() => undefined);
  };

  const present = (result: ShellResult): ShellResult => {
    const note = explainExit(result.code, memory);
    if (!note) return result;
    return {
      ...result,
      timedOut: result.code === 124 || result.timedOut,
      stderr: `${note}\n${result.stderr}`,
    };
  };

  return {
    kind: "sandbox",
    describe:
      `in a ${runtime} container (${image}) as ${user}` +
      (user.startsWith("0:") ? ", which is root inside it" : "") +
      (options.network ? ", with internet access" : ", with no network"),

    async run(command: string, opts: ExecOptions): Promise<ShellResult> {
      if (disposed) return failedResult("The sandbox has already been shut down.");

      // The same refusal the host executor applies. The sandbox does not
      // protect the workspace, so `cat .env` inside it reads the same file.
      const refusal = refusedForSecret(command);
      if (refusal) return failedResult(refusal);

      const workdir = workdirFor(options.workspace, opts.cwd);
      if (workdir === null) {
        return failedResult(
          `That command asked to run in ${opts.cwd}, which is outside the sandbox's ` +
            "workspace and is not reachable from inside the container.",
        );
      }

      const seconds = Math.ceil(((opts.timeoutMs ?? 120_000) / 1000) * scale);
      // The host-side kill is only a backstop: the in-container timeout is what
      // actually stops the process, and this fires well after it.
      const backstopMs = (seconds + 15) * 1000;
      const env = allowedEnv(process.env, opts.env);

      // A networked command gets its own container, created and destroyed
      // around it. Under gVisor a container created without a network can never
      // be given one, so the only way to have both is to have two, and the bind
      // mount means the sibling is not a fresh start: it sees the same /work.
      // A session container that already has a network needs no sibling.
      if (opts.network && !options.network) {
        const name = `${sealedName}-net-${randomBytes(3).toString("hex")}`;
        const started = await create(name, true);
        if (!started) return failedResult(`Could not start a networked sandbox from ${image}.`);
        try {
          return present(
            await runShell(execCommand(name, command, seconds, workdir), {
              cwd: options.workspace,
              timeoutMs: backstopMs,
              signal: opts.signal,
              env,
            }),
          );
        } finally {
          await remove(name);
        }
      }

      if (!sealed) {
        sealed = await create(sealedName, options.network ?? false);
        if (!sealed) return failedResult(`Could not start the sandbox from ${image}.`);
        const wrong = await verifyOwnership(sealed);
        if (wrong) {
          await remove(sealed);
          sealed = null;
          disposed = true;
          return failedResult(wrong);
        }
      }

      return present(
        await runShell(execCommand(sealed, command, seconds, workdir), {
          cwd: options.workspace,
          timeoutMs: backstopMs,
          signal: opts.signal,
          env,
        }),
      );
    },

    async dispose() {
      disposed = true;
      if (sealed) {
        await remove(sealed);
        sealed = null;
      }
    },
  };
}
