// The agent orchestrator: one Vercel Sandbox per project.
//
// Each project the Coding Agent works on gets a sandbox of its own, a Linux VM
// with the internet, made in this Vercel project's own account. Inside it runs
// the same agent server as services/runner, bundled into one file
// (scripts/build-agent-server.ts), on Bun, listening on a public port that
// only answers a token derived for that one sandbox. The website talks to it
// exactly as it would talk to a separate runner (src/routes/api.workspace.ts),
// so nothing else changes.
//
// Why a sandbox per project rather than one shared server: the agent runs
// commands, installs packages and downloads things. In a VM of its own it can
// do all of that freely (nobody approves each command), and nothing it does
// reaches another project or this website. The sandbox is persistent: when it
// times out its files and conversation are snapshotted, and the next request
// resumes it and starts the server again.
//
// Each start writes the bundle from this deployment, so a project picks up a
// new version of the agent the next time its server starts.

import { randomBytes } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

/** The bundled agent server, loaded only when a sandbox needs it (and never
 *  in unit tests, which cannot build it). */
async function agentServer(): Promise<string> {
  const mod = (await import("./agent-server.gen.mjs?raw")) as { default: string };
  return mod.default;
}

const PORT = 8792;
// The sandbox image is Ubuntu, run as "ubuntu", which can write under /vercel.
const DIR = "/vercel/devstation";
const BUNDLE = `${DIR}/server.mjs`;
const BUN = `${DIR}/bun/node_modules/.bin/bun`;
const BUN_VERSION = "1.4.2";
/** Between the sandbox's name and the agent server's own workspace id. */
const SEP = "~";

export interface RunnerReply {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/** The agent runs in Vercel Sandbox unless AGENT_HOST=runner points it at a
 *  separate server (RUNNER_URL, RUNNER_TOKEN). */
export function sandboxHostEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.AGENT_HOST ?? "vercel-sandbox").toLowerCase() !== "runner";
}

/** Minutes a sandbox stays up after each message before it is snapshotted.
 *  The plan caps it: 45 minutes on Hobby, 5 hours on Pro. */
function timeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const minutes = Number(env.SANDBOX_TIMEOUT_MINUTES ?? 45);
  return Math.max(5, Math.min(300, Number.isFinite(minutes) ? minutes : 45)) * 60_000;
}

/** Where a sandbox keeps the token its server answers to. It is made at
 *  random when the sandbox is, and read back through the Vercel API (which
 *  only this project can call), so no secret has to be configured. */
const TOKEN_FILE = `${DIR}/token`;
const tokens = new Map<string, string>();

async function tokenOf(sandbox: Sandbox, name: string): Promise<string> {
  const known = tokens.get(name);
  if (known) return known;
  const token = (await sandbox.fs.readFile(TOKEN_FILE, "utf8")).trim();
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("The sandbox has no agent token.");
  tokens.set(name, token);
  return token;
}

/** "ds-ab12…~ws-cd34…" -> the sandbox and the server's own workspace id. */
export function splitId(id: string): { name: string; inner: string } | null {
  const at = id.indexOf(SEP);
  if (at <= 0) return null;
  const name = id.slice(0, at);
  const inner = id.slice(at + SEP.length);
  return /^ds-[a-z0-9]{8,32}$/.test(name) && /^[\w-]{1,60}$/.test(inner) ? { name, inner } : null;
}

const fail = (status: number, message: string): RunnerReply => ({
  ok: false,
  status,
  body: { ok: false, message },
});

/** What the server inside the sandbox is given. Only the model keys it needs:
 *  Fortytwo is the default, the others serve a model picked by name. */
function serverEnv(token: string, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const pass = ["FORTYTWO_API_KEY", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "AI_REASONING"];
  const out: Record<string, string> = {
    RUNNER_TOKEN: token,
    SESSION_SECRET: token,
    RUNNER_HOST: "0.0.0.0",
    PORT: String(PORT),
    RUNNER_STATE_DIR: `${DIR}/state`,
    // The VM is the isolation: commands run on it directly, with the internet.
    DEVSTATION_SANDBOX: "off",
    DEVSTATION_ISOLATED_HOST: "1",
  };
  for (const key of pass) if (env[key]) out[key] = env[key] as string;
  return out;
}

async function healthy(base: string, waitMs: number): Promise<boolean> {
  const until = Date.now() + waitMs;
  do {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4_000) });
      if (res.ok) return true;
    } catch {
      // Not up yet.
    }
    if (Date.now() >= until) break;
    await new Promise((r) => setTimeout(r, 750));
  } while (Date.now() < until);
  return false;
}

/** Write this deployment's agent server into the sandbox and start it. */
async function startServer(sandbox: Sandbox, token: string): Promise<void> {
  await sandbox.runCommand("mkdir", ["-p", `${DIR}/state`]);
  await sandbox.writeFiles([{ path: BUNDLE, content: Buffer.from(await agentServer()) }]);
  const hasBun = await sandbox.runCommand("test", ["-x", BUN]);
  if (hasBun.exitCode !== 0) {
    const installed = await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "--no-audit", "--no-fund", "--prefix", `${DIR}/bun`, `bun@${BUN_VERSION}`],
    });
    if (installed.exitCode !== 0) {
      throw new Error(
        `Could not install Bun in the sandbox: ${(await installed.stderr()).slice(-300)}`,
      );
    }
  }
  await sandbox.runCommand({
    cmd: BUN,
    args: [BUNDLE],
    cwd: DIR,
    env: serverEnv(token),
    detached: true,
  });
}

/** The sandbox's server address, starting the server when it is not up (a
 *  new sandbox, or one resumed from a snapshot). */
async function ready(sandbox: Sandbox, token: string, fresh = false): Promise<string> {
  const base = sandbox.domain(PORT);
  if (!fresh && (await healthy(base, 2_500))) return base;
  await startServer(sandbox, token);
  if (await healthy(base, 45_000)) return base;
  throw new Error("The agent server did not start in its sandbox.");
}

async function forward(
  base: string,
  token: string,
  path: string,
  init: RequestInit & { owner?: string },
  caller: string,
): Promise<RunnerReply> {
  const { owner, ...rest } = init;
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-devstation-caller": caller,
      ...(owner ? { "x-devstation-owner": owner } : {}),
    },
    signal: AbortSignal.timeout(60_000),
  });
  const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { ok: res.ok, status: res.status, body };
}

/** Give the workspace in a reply its outside id: sandbox plus inner id. */
function outward(reply: RunnerReply, name: string): RunnerReply {
  const workspace = reply.body.workspace as { id?: unknown } | undefined;
  if (workspace && typeof workspace.id === "string") {
    reply.body.workspace = { ...workspace, id: `${name}${SEP}${workspace.id}` };
  }
  return reply;
}

function notFound(error: unknown): boolean {
  const e = error as { response?: { status?: number }; status?: number; message?: string };
  return (
    e?.response?.status === 404 ||
    e?.status === 404 ||
    /not.?found|404/i.test(String(e?.message ?? ""))
  );
}

function sandboxProblem(error: unknown): RunnerReply {
  const why = error instanceof Error ? error.message : String(error);
  if (/oidc|token|credential|unauthori[sz]ed|forbidden/i.test(why)) {
    return fail(
      503,
      "The agent's sandbox could not be reached: this deployment has no access to Vercel Sandbox. Turn on OIDC for the Vercel project (Settings, Security), or set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID.",
    );
  }
  return fail(502, `The agent's sandbox did not answer. ${why.slice(0, 200)}`);
}

/**
 * The runner contract (POST /agent/workspaces, /agent/workspaces/:id/...),
 * answered by the project's own sandbox.
 */
export async function sandboxRunner(
  path: string,
  init: RequestInit & { owner?: string },
  caller: string,
): Promise<RunnerReply> {
  try {
    if (path === "/agent/workspaces" && init.method === "POST") {
      const name = `ds-${randomBytes(8).toString("hex")}`;
      const sandbox = await Sandbox.create({
        name,
        persistent: true,
        timeout: timeoutMs(),
        ports: [PORT],
        resources: { vcpus: 2 },
        tags: { app: "devstation" },
      });
      const token = randomBytes(32).toString("hex");
      await sandbox.runCommand("mkdir", ["-p", DIR]);
      await sandbox.writeFiles([{ path: TOKEN_FILE, content: Buffer.from(token) }]);
      await sandbox.runCommand("chmod", ["600", TOKEN_FILE]);
      tokens.set(name, token);
      const base = await ready(sandbox, token, true);
      return outward(await forward(base, token, path, init, caller), name);
    }

    const match = path.match(/^\/agent\/workspaces\/([^/]+)(\/[a-z_]+)?$/);
    const ids = match ? splitId(decodeURIComponent(match[1])) : null;
    if (!match || !ids) return fail(404, "That workspace is gone.");

    let sandbox: Sandbox;
    try {
      sandbox = await Sandbox.get({ name: ids.name, resume: true });
    } catch (error) {
      if (notFound(error)) return fail(404, "That workspace is gone.");
      throw error;
    }
    const token = await tokenOf(sandbox, ids.name);
    const base = await ready(sandbox, token);
    // A message is work about to happen: keep the machine up for it.
    if (match[2] === "/messages" && init.method === "POST") {
      await sandbox.extendTimeout(timeoutMs()).catch(() => undefined);
    }
    const inner = `/agent/workspaces/${encodeURIComponent(ids.inner)}${match[2] ?? ""}`;
    return outward(await forward(base, token, inner, init, caller), ids.name);
  } catch (error) {
    return sandboxProblem(error);
  }
}
