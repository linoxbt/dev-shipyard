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

import { createHash, randomBytes } from "node:crypto";
import { Sandbox } from "@vercel/sandbox";

/** The bundled agent server, loaded only when a sandbox needs it (and never
 *  in unit tests, which cannot build it). */
async function agentServer(): Promise<string> {
  const mod = (await import("./agent-server.gen.mjs?raw")) as { default: string };
  return mod.default;
}

/** Which agent server this deployment ships, so a sandbox still running an
 *  older one is restarted on it. */
let buildId: string | null = null;
async function agentBuild(): Promise<string> {
  buildId ??= createHash("sha256")
    .update(await agentServer())
    .digest("hex")
    .slice(0, 16);
  return buildId;
}

const PORT = 8792;
// The sandbox image is Ubuntu, run as "ubuntu", which can write under /vercel.
const DIR = "/vercel/devstation";
const BUNDLE = `${DIR}/server.mjs`;
const BUN = `${DIR}/bun/node_modules/.bin/bun`;
const BUN_VERSION = "1.4.2";
/** How long the latest snapshot of a sleeping project is kept. */
const SNAPSHOT_MS = 60 * 24 * 60 * 60_000;
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
const MAX_TOKENS_CACHED = 500;

async function tokenOf(sandbox: Sandbox, name: string): Promise<string> {
  const known = tokens.get(name);
  if (known) return known;
  const token = (await sandbox.fs.readFile(TOKEN_FILE, "utf8")).trim();
  if (!/^[0-9a-f]{64}$/.test(token)) throw new Error("The sandbox's agent server has no key.");
  if (tokens.size >= MAX_TOKENS_CACHED) tokens.delete(tokens.keys().next().value as string);
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

/** What the server inside the sandbox is given. No model key: model calls
 *  go through this site's proxy with a pass for each turn (api/model), so
 *  nothing the agent or the project's own scripts run can read a key. */
function serverEnv(token: string, build: string): Record<string, string> {
  return {
    RUNNER_TOKEN: token,
    SESSION_SECRET: token,
    RUNNER_HOST: "0.0.0.0",
    PORT: String(PORT),
    RUNNER_STATE_DIR: `${DIR}/state`,
    // The VM is the isolation: commands run on it directly, with the internet.
    DEVSTATION_SANDBOX: "off",
    DEVSTATION_ISOLATED_HOST: "1",
    DEVSTATION_BUILD: build,
  };
}

/** Whether the server answers, and which build it is. */
async function health(base: string, waitMs: number): Promise<{ build: string } | null> {
  const until = Date.now() + waitMs;
  do {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(4_000) });
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { build?: unknown };
        return { build: typeof body.build === "string" ? body.build : "" };
      }
    } catch {
      // Not up yet.
    }
    if (Date.now() >= until) break;
    await new Promise((r) => setTimeout(r, 750));
  } while (Date.now() < until);
  return null;
}

/** Write this deployment's agent server into the sandbox and start it,
 *  stopping one already running (an older build). */
async function startServer(sandbox: Sandbox, token: string): Promise<void> {
  await sandbox.runCommand("mkdir", ["-p", `${DIR}/state`]);
  await sandbox.runCommand("pkill", ["-f", BUNDLE]).catch(() => undefined);
  await sandbox.writeFiles([{ path: BUNDLE, content: Buffer.from(await agentServer()) }]);
  // The image may already have Bun; otherwise it is installed once.
  let bun = BUN;
  const hasBun = await sandbox.runCommand("test", ["-x", BUN]);
  if (hasBun.exitCode !== 0) {
    const system = await sandbox.runCommand("sh", ["-c", `bun --version | grep -q '^1\\.'`]);
    if (system.exitCode === 0) {
      bun = "bun";
    } else {
      const installed = await sandbox.runCommand({
        cmd: "npm",
        args: [
          "install",
          "--no-audit",
          "--no-fund",
          "--prefix",
          `${DIR}/bun`,
          `bun@${BUN_VERSION}`,
        ],
      });
      if (installed.exitCode !== 0) {
        throw new Error(
          `Could not install Bun in the sandbox: ${(await installed.stderr()).slice(-300)}`,
        );
      }
    }
  }
  await sandbox.runCommand({
    cmd: bun,
    args: [BUNDLE],
    cwd: DIR,
    env: serverEnv(token, await agentBuild()),
    detached: true,
  });
}

/**
 * The sandbox's server address, starting the server when it is not up (a new
 * sandbox, or one resumed from a snapshot). A server from an older build is
 * replaced when `mayRestart` says nothing is running on it.
 */
async function ready(
  sandbox: Sandbox,
  token: string,
  opts: { fresh?: boolean; mayRestart?: () => Promise<boolean> } = {},
): Promise<string> {
  const base = sandbox.domain(PORT);
  if (!opts.fresh) {
    const up = await health(base, 2_500);
    if (up && (up.build === (await agentBuild()) || !(await opts.mayRestart?.()))) return base;
  }
  await startServer(sandbox, token);
  if (await health(base, 45_000)) return base;
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
  if (/oidc|credential|unauthori[sz]ed|forbidden|vercel_token|access token/i.test(why)) {
    return fail(
      503,
      "The agent's sandbox could not be reached: this deployment has no access to Vercel Sandbox. Turn on OIDC for the Vercel project (Settings, Security), or set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID.",
    );
  }
  return fail(502, `The agent's sandbox did not answer. ${why.slice(0, 200)}`);
}

/** A workspace path: the sandbox and inner id, the action, and for a
 *  screenshot its name. Null for anything else. */
export function routeOf(
  path: string,
): { ids: { name: string; inner: string }; action: string; tail: string; search: string } | null {
  const q = path.indexOf("?");
  // Only a plain query (?all=1) is carried through; anything odd is dropped.
  const search = q >= 0 && /^\?[A-Za-z0-9_=&-]{1,200}$/.test(path.slice(q)) ? path.slice(q) : "";
  if (q >= 0) path = path.slice(0, q);
  const match = path.match(/^\/agent\/workspaces\/([^/]+)(\/[a-z_]+)?(\/shot-[a-z0-9]+-\d+)?$/);
  if (!match) return null;
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const ids = splitId(id);
  const action = match[2] ?? "";
  const tail = match[3] ?? "";
  if (!ids || (tail && action !== "/shot")) return null;
  return { ids, action, tail, search };
}

/**
 * Writes a turn's body once the project's owner is known: `payer` is whose
 * plan pays for its model calls, `withAccounts` whether the sender's
 * connected accounts may go in.
 */
export type TurnBody = (payer: string, withAccounts: boolean) => Promise<string>;

/**
 * The project's owner as this site recorded it when it made the machine, or
 * null for a machine made before owners were recorded. Never read from the
 * machine: its owner's agent runs there and could answer anything.
 */
export function ownerOfSandbox(tags: Record<string, string> | undefined): string | null {
  const owner = tags?.owner;
  return owner && /^0x[0-9a-f]{40}$/.test(owner) ? owner : null;
}

/** Machines made before owners were recorded on them (owner tags shipped
 *  2026-11-02 18:54 UTC). Only these can have an owner recorded later. */
export const OWNER_TAGS_SINCE = Date.parse("2026-11-02T19:10:00Z");

/**
 * Record the owner of a machine made before owners were recorded, so its
 * owner's connected accounts reach it again. Only when everything agrees:
 * the machine is that old, the sender's own session (signed by this site)
 * lists the project, and the project has no other builders, so no one else's
 * turns could ever run beside those accounts. Null when any of it is missing.
 */
export async function adoptLegacyOwner(
  sandbox: Pick<Sandbox, "createdAt" | "tags" | "update">,
  base: string,
  token: string,
  inner: string,
  sender: string,
  caller: string,
  fwd: typeof forward = forward,
): Promise<string | null> {
  try {
    if (sandbox.createdAt.getTime() >= OWNER_TAGS_SINCE) return null;
    const members = await fwd(
      base,
      token,
      `/agent/workspaces/${encodeURIComponent(inner)}/members`,
      { method: "GET", owner: sender },
      caller,
    );
    const body = members.body as { role?: unknown; owner?: unknown; collaborators?: unknown };
    const others = Array.isArray(body.collaborators) ? body.collaborators.length : -1;
    if (!members.ok || body.role !== "owner" || body.owner !== sender || others !== 0) return null;
    await sandbox.update({ tags: { ...(sandbox.tags ?? {}), app: "devstation", owner: sender } });
    return sender;
  } catch {
    return null;
  }
}

/**
 * The runner contract (POST /agent/workspaces, /agent/workspaces/:id/...),
 * answered by the project's own sandbox.
 */
export async function sandboxRunner(
  path: string,
  init: RequestInit & {
    owner?: string;
    turn?: TurnBody;
    /** The sender's own session (signed by this site) lists this workspace. */
    claimed?: boolean;
  },
  caller: string,
): Promise<RunnerReply> {
  try {
    if (path === "/agent/workspaces" && init.method === "POST") {
      const name = `ds-${randomBytes(8).toString("hex")}`;
      const options = {
        name,
        persistent: true,
        timeout: timeoutMs(),
        ports: [PORT],
        resources: { vcpus: 2 },
        // Who owns the project, kept where only this site can write it: the
        // machine itself belongs to that person's agent, so what its server
        // says about ownership is not evidence (see ownerOfSandbox).
        tags: { app: "devstation", ...(init.owner ? { owner: init.owner.toLowerCase() } : {}) },
        // Only the latest snapshot is kept, for 60 days: storage stays bounded
        // and an abandoned project expires (api/cron/sandboxes deletes it).
        keepLastSnapshots: { count: 1, expiration: SNAPSHOT_MS, deleteEvicted: true },
      };
      const sandbox = await Sandbox.create(options).catch((error: unknown) => {
        // A tag the platform will not take must not cost the person their
        // project: without it, the project simply never receives connected
        // accounts (ownerOfSandbox answers null).
        if (!init.owner || !/tag/i.test(String((error as Error)?.message ?? ""))) throw error;
        return Sandbox.create({ ...options, tags: { app: "devstation" } });
      });
      try {
        const token = randomBytes(32).toString("hex");
        await sandbox.runCommand("mkdir", ["-p", DIR]);
        await sandbox.writeFiles([{ path: TOKEN_FILE, content: Buffer.from(token) }]);
        await sandbox.runCommand("chmod", ["600", TOKEN_FILE]);
        tokens.set(name, token);
        const base = await ready(sandbox, token, { fresh: true });
        return outward(await forward(base, token, path, init, caller), name);
      } catch (error) {
        // A sandbox that never got its server is of no use to anyone.
        await sandbox.delete({ deleteOrphanSnapshots: true }).catch(() => undefined);
        tokens.delete(name);
        throw error;
      }
    }

    const route = routeOf(path);
    if (!route) return fail(404, "That workspace is gone.");
    const { ids, action, tail, search } = route;

    let sandbox: Sandbox;
    try {
      // Looked up without waking it: a status poll from an open tab must not
      // resume a sleeping machine (and pay for it) just to say it is idle.
      sandbox = await Sandbox.get({ name: ids.name });
    } catch (error) {
      if (notFound(error)) return fail(404, "That workspace is gone.");
      throw error;
    }
    const isStatus = (init.method ?? "GET") === "GET" && (action === "" || action === "/members");
    if (isStatus && sandbox.status !== "running") {
      return { ok: true, status: 200, body: { ok: true, asleep: true } };
    }

    if (sandbox.status !== "running") {
      // Real work (a message, the files, a screenshot): wake it.
      sandbox = await Sandbox.get({ name: ids.name, resume: true });
    }
    const token = await tokenOf(sandbox, ids.name);
    const inner = `/agent/workspaces/${encodeURIComponent(ids.inner)}${action}${tail}${search}`;
    const startsWork = init.method === "POST" && (action === "/messages" || action === "/preview");
    const base = await ready(sandbox, token, {
      // Replace an older agent server only when new work arrives and nothing
      // is running on it, so a turn in progress is never cut off.
      mayRestart: startsWork
        ? async () => {
            const view = await forward(
              sandbox.domain(PORT),
              token,
              `/agent/workspaces/${encodeURIComponent(ids.inner)}`,
              { method: "GET", owner: init.owner },
              caller,
            ).catch(() => null);
            const phase = (view?.body.workspace as { phase?: unknown } | undefined)?.phase;
            return phase !== "running";
          }
        : undefined,
    });
    if (init.turn) {
      // The turn is written now, against the owner this site recorded.
      let owner = ownerOfSandbox(sandbox.tags);
      const sender = (init.owner ?? "").toLowerCase();
      if (owner === null && init.claimed && /^0x[0-9a-f]{40}$/.test(sender)) {
        owner = await adoptLegacyOwner(sandbox, base, token, ids.inner, sender, caller);
      }
      init = {
        ...init,
        body: await init.turn(owner ?? sender, owner !== null && owner === sender),
      };
    }
    // A message is work about to happen: keep the machine up for it.
    if (action === "/messages" && init.method === "POST") {
      await sandbox.extendTimeout(timeoutMs()).catch(() => undefined);
    }
    return outward(await forward(base, token, inner, init, caller), ids.name);
  } catch (error) {
    return sandboxProblem(error);
  }
}

/**
 * Keep a project's machine up while its agent has work, whether or not anyone
 * is watching: asked by the machine itself on its heartbeat (routes/
 * api.model.heartbeat.ts). False when it is not one of this site's machines
 * or is not running (a stopped machine has no work to keep).
 */
export async function keepSandboxAwake(workspace: string): Promise<boolean> {
  if (!sandboxHostEnabled()) return false;
  const ids = splitId(workspace);
  if (!ids) return false;
  try {
    const sandbox = await Sandbox.get({ name: ids.name });
    if (sandbox.status !== "running") return false;
    await sandbox.extendTimeout(timeoutMs());
    return true;
  } catch {
    return false;
  }
}

/** A project untouched for this long is deleted, with its snapshots. */
const IDLE_DELETE_MS = 60 * 24 * 60 * 60_000;

/**
 * Delete DevStation's sandboxes nobody has used for 60 days (run daily by
 * api/cron/sandboxes). Its files are still in the person's browser, so a
 * project opened again later gets a new sandbox from them.
 */
export async function sweepSandboxes(
  now = Date.now(),
): Promise<{ checked: number; deleted: number }> {
  let checked = 0;
  let deleted = 0;
  const pages = await Sandbox.list({
    tags: { app: "devstation" },
    sortBy: "statusUpdatedAt",
    sortOrder: "asc",
  });
  for await (const page of pages.pages()) {
    for (const item of page.sandboxes) {
      checked++;
      if (item.status === "running" || now - item.updatedAt < IDLE_DELETE_MS) continue;
      try {
        const sandbox = await Sandbox.get({ name: item.name });
        await sandbox.delete({ deleteOrphanSnapshots: true });
        tokens.delete(item.name);
        deleted++;
      } catch {
        // Gone already, or busy: the next sweep tries again.
      }
    }
    if (checked >= 5000) break;
  }
  return { checked, deleted };
}
