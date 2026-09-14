// The Coding Agent in the browser: one conversation over one workspace.
//
// This is the CLI's engine running on the runner. A person starts from nothing,
// from files they upload, from one of their apps, or from any public GitHub
// repository, and then talks to the agent. Every message is another run of the
// orchestrator over the SAME workspace, carrying the conversation forward, so
// the second thing they ask can be about the first -- which is what the CLI
// does and what the two older web paths did not: the App Builder could only
// make web apps, and the repository agent took one goal and stopped.
//
// Nothing here needs GitHub. A public repository is downloaded without a token,
// and pushing or opening a pull request stays the person's own action, carried
// out by their session on DevStation's server after they have seen the work.
// No credential of theirs ever reaches this process.

import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import { randomBytes } from "node:crypto";
import { Orchestrator, type AgentEvent, type Handoff } from "../../../src/lib/agent/orchestrator";
import type { ProviderMessage } from "../../../src/lib/agent/providers/types";
import { looksBinary, Workspace } from "../../../src/lib/agent/workspace";
import { initLocalRepo, materialise, readWorkspace } from "../../../src/lib/agent/repo-session";
import { providerFromEnv, type ModelProvider } from "../../../src/lib/agent/providers";
import { SANDBOX_ADDENDUM, SANDBOX_NETWORK_ADDENDUM } from "../../../src/lib/agent/system-prompt";
import { hostExecutor, type Executor } from "../../../src/lib/agent/executor";
import {
  readinessProblem,
  sandboxExecutor,
  sandboxReadiness,
} from "../../../src/lib/agent/sandbox-exec";
import { embeddingsFromEnv } from "../../../src/lib/agent/memory/embeddings";
import { indexWorkspace, openStore } from "../../../src/lib/agent/memory/workspace-index";
import type { MemoryStore } from "../../../src/lib/agent/memory/store";
import { filesFromArchive, readTarGz } from "../../../src/lib/repo-archive";
import { parseRepo } from "../../../src/lib/github-repos";
import { sandboxEnabled } from "./repo-agent";
import { LIMITS } from "./limits";

const STATE_DIR = process.env.RUNNER_STATE_DIR ?? "/var/lib/devstation-runner";
const DEFAULT_DIR = join(STATE_DIR, "workspaces");

/** A workspace is kept this long after it was last touched. The browser holds
 *  a copy of the files, so a swept workspace is recreated from them rather
 *  than lost. */
export const WORKSPACE_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_WORKSPACES = 60;
/** Runs at once across everybody. Each is a container and a model loop, and
 *  this host shares its memory with the build queue. */
export const MAX_RUNNING = 2;
const MAX_STEPS = 60;
const MAX_MS = 20 * 60_000;
const MAX_EVENTS = 300;
/** Conversation carried between messages. Older exchanges are dropped first,
 *  always at a user message so a tool result is never left without its call. */
const MAX_HISTORY_CHARS = 300_000;
/** Largest upload or import handed to a workspace. */
export const MAX_SOURCE_FILES = 5000;
export const MAX_SOURCE_BYTES = 12 * 1024 * 1024;

const STOPPED =
  "The runner restarted while this was working. Your files are still here: send the message again.";

export type WorkspacePhase = "idle" | "running" | "error" | "cancelled";
export type PreviewPhase = "none" | "building" | "ready" | "error" | "unsupported";

export interface WorkspaceSource {
  kind: "blank" | "files" | "github";
  /** owner/name, when the files came from (or belong to) a GitHub repository. */
  repo?: string;
  ref?: string;
}

export interface WorkspaceSession {
  id: string;
  owner: string;
  root: string;
  source: WorkspaceSource;
  createdAt: number;
  updatedAt: number;
  phase: WorkspacePhase;
  status: string;
  /** What the person asked in the current or most recent turn. */
  prompt: string;
  /** The agent's words for the current or most recent turn. */
  reply: string;
  /** Tool steps of the current or most recent turn. */
  events: AgentEvent[];
  /** Completed turns, including ones that failed. The browser uses this to
   *  know a turn it has not yet shown has finished. */
  turns: number;
  steps: number;
  costUsd: number;
  changed: string[];
  handoffs: Handoff[];
  error: string | null;
  /** Bumped when a turn finishes, so the browser knows to fetch the files. */
  revision: number;
  fileCount: number;
  preview: { phase: PreviewPhase; revision: number; message: string | null };
  /** Other wallets the owner has added as builders, lowercased. */
  collaborators?: string[];
}

export type WorkspaceView = Omit<WorkspaceSession, "root" | "owner" | "collaborators">;

const sessions = new Map<string, WorkspaceSession>();
const running = new Map<string, AbortController>();
const settled = new Map<string, Promise<void>>();
let baseDir = DEFAULT_DIR;

// --- persistence ------------------------------------------------------------

const sessionFile = (s: { root: string }) => `${s.root}.json`;
const messagesFile = (s: { root: string }) => `${s.root}.messages.json`;
const previewFile = (s: { root: string }) => `${s.root}.preview.json`;

function writeAtomic(path: string, body: string): void {
  try {
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, body, "utf8");
    renameSync(tmp, path);
  } catch {
    // Disk trouble must not take a run down; the browser keeps its own copy.
  }
}

function persist(session: WorkspaceSession): void {
  writeAtomic(sessionFile(session), JSON.stringify(session));
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Load what survived a restart. A turn that was running did not survive it. */
export function initWorkspaceStore(dir = DEFAULT_DIR): void {
  baseDir = dir;
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return;
  }
  let names: string[] = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!/^ws-[a-f0-9]+\.json$/.test(name)) continue;
    const session = readJson<WorkspaceSession>(join(dir, name));
    if (!session?.id) continue;
    if (session.phase === "running") {
      session.phase = "error";
      session.error = STOPPED;
      session.status = "";
      session.turns += 1;
    }
    if (session.preview?.phase === "building") {
      session.preview = { ...session.preview, phase: "error", message: STOPPED };
    }
    sessions.set(session.id, session);
  }
}

export function sweepWorkspaces(now = Date.now()): number {
  let removed = 0;
  for (const [id, s] of [...sessions]) {
    if (running.has(id)) continue;
    if (now - s.updatedAt > WORKSPACE_TTL_MS) {
      drop(id);
      removed++;
    }
  }
  const idle = [...sessions.values()]
    .filter((s) => !running.has(s.id))
    .sort((a, b) => a.updatedAt - b.updatedAt);
  while (sessions.size > MAX_WORKSPACES && idle.length > 0) {
    drop(idle.shift()!.id);
    removed++;
  }
  return removed;
}

function drop(id: string): void {
  const s = sessions.get(id);
  sessions.delete(id);
  if (!s) return;
  for (const path of [s.root, sessionFile(s), messagesFile(s), previewFile(s)]) {
    rmSync(path, { recursive: true, force: true });
  }
}

// --- sources ----------------------------------------------------------------

/** Validates a source as the HTTP body describes it. */
export function parseWorkspaceSource(
  raw: unknown,
): { source: WorkspaceSource; files: Record<string, string> } | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "A source is required." };
  const r = raw as Record<string, unknown>;
  const repo = typeof r.repo === "string" ? r.repo.slice(0, 200) : undefined;
  const ref = typeof r.ref === "string" && r.ref ? r.ref.slice(0, 200) : undefined;
  if (r.kind === "blank") return { source: { kind: "blank" }, files: {} };
  if (r.kind === "github") {
    if (!repo || !parseRepo(repo)) return { error: "That is not a GitHub repository." };
    return { source: { kind: "github", repo, ref }, files: {} };
  }
  if (r.kind === "files") {
    if (!r.files || typeof r.files !== "object" || Array.isArray(r.files)) {
      return { error: "The files are required." };
    }
    const files: Record<string, string> = {};
    let bytes = 0;
    for (const [path, content] of Object.entries(r.files as Record<string, unknown>)) {
      if (typeof content !== "string") continue;
      files[path] = content;
      bytes += content.length;
    }
    if (Object.keys(files).length > MAX_SOURCE_FILES) {
      return { error: `At most ${MAX_SOURCE_FILES} files can be brought in.` };
    }
    if (bytes > MAX_SOURCE_BYTES) {
      return { error: "Those files are larger than the 12 MB a workspace can take in." };
    }
    return { source: { kind: "files", repo, ref }, files };
  }
  return { error: "Unknown source." };
}

/** A public repository, downloaded without a token. */
export async function importPublicRepo(
  repo: string,
  ref?: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ files: Record<string, string>; ref: string; fullName: string } | { error: string }> {
  const target = parseRepo(repo);
  if (!target) return { error: "That is not a GitHub repository. Use owner/name or its URL." };
  let branch = ref;
  let fullName = `${target.owner}/${target.name}`;
  if (!branch) {
    const meta = await fetchImpl(`https://api.github.com/repos/${target.owner}/${target.name}`, {
      headers: { accept: "application/vnd.github+json", "user-agent": "DevStation" },
    }).catch(() => null);
    if (meta?.status === 404) {
      return {
        error: `${fullName} was not found. If it is private, connect GitHub and try again.`,
      };
    }
    const body = (await meta?.json().catch(() => null)) as {
      default_branch?: string;
      full_name?: string;
    } | null;
    branch = body?.default_branch || "HEAD";
    fullName = body?.full_name || fullName;
  }
  const res = await fetchImpl(
    `https://codeload.github.com/${target.owner}/${target.name}/tar.gz/${encodeURIComponent(branch)}`,
    { redirect: "follow" },
  ).catch(() => null);
  if (!res || !res.ok) {
    return {
      error: `Could not download ${fullName}${ref ? ` at ${ref}` : ""}. If it is private, connect GitHub and try again.`,
    };
  }
  const read = filesFromArchive(readTarGz(Buffer.from(await res.arrayBuffer())), {
    maxFiles: MAX_SOURCE_FILES,
    maxBytes: MAX_SOURCE_BYTES,
  });
  if ("error" in read) return { error: read.error };
  return { files: read.files, ref: branch === "HEAD" ? "main" : branch, fullName };
}

// --- lifecycle --------------------------------------------------------------

export interface CreateWorkspaceInput {
  owner: string;
  source: WorkspaceSource;
  files?: Record<string, string>;
  /** Where the workspace goes. Defaults to the runner's state directory. */
  stateDir?: string;
  fetchImpl?: typeof fetch;
}

export async function createWorkspace(
  input: CreateWorkspaceInput,
): Promise<{ ok: true; session: WorkspaceSession } | { ok: false; message: string }> {
  sweepWorkspaces();
  let files = input.files ?? {};
  const source: WorkspaceSource = { ...input.source };

  if (source.kind === "github" && Object.keys(files).length === 0) {
    const imported = await importPublicRepo(source.repo ?? "", source.ref, input.fetchImpl);
    if ("error" in imported) return { ok: false, message: imported.error };
    files = imported.files;
    source.repo = imported.fullName;
    source.ref = imported.ref;
  }

  const id = `ws-${randomBytes(9).toString("hex")}`;
  const dir = input.stateDir ?? baseDir;
  const root = join(dir, id);
  mkdirSync(root, { recursive: true });
  const written = materialise(files, root);
  await initLocalRepo(root, source.ref ?? "workspace");

  const now = Date.now();
  const session: WorkspaceSession = {
    id,
    owner: input.owner,
    root,
    source,
    createdAt: now,
    updatedAt: now,
    phase: "idle",
    status: "",
    prompt: "",
    reply: "",
    events: [],
    turns: 0,
    steps: 0,
    costUsd: 0,
    changed: [],
    handoffs: [],
    error: null,
    revision: 0,
    fileCount: written.written,
    preview: { phase: "none", revision: 0, message: null },
  };
  sessions.set(id, session);
  persist(session);
  return { ok: true, session };
}

export function getWorkspace(id: string): WorkspaceSession | null {
  return sessions.get(id) ?? null;
}

export function workspaceView(session: WorkspaceSession): WorkspaceView {
  const { root, owner, collaborators, ...rest } = session;
  void root;
  void owner;
  void collaborators;
  return rest;
}

// --- other builders -----------------------------------------------------------
//
// A workspace belongs to the wallet that started it. The owner can add other
// wallets as builders: they talk to the same agent over the same files, see the
// same preview, and can publish. Only the owner changes who is in, and the
// agent still runs one message at a time, whoever sent it.

export const MAX_COLLABORATORS = 10;
const WALLET = /^0x[a-fA-F0-9]{40}$/;

export type WorkspaceRole = "owner" | "builder";

export function workspaceRole(id: string, wallet: string): WorkspaceRole | null {
  const s = sessions.get(id);
  if (!s || !wallet) return null;
  const who = wallet.toLowerCase();
  if (s.owner.toLowerCase() === who) return "owner";
  return (s.collaborators ?? []).includes(who) ? "builder" : null;
}

export function workspaceMembers(id: string): { owner: string; collaborators: string[] } | null {
  const s = sessions.get(id);
  return s ? { owner: s.owner.toLowerCase(), collaborators: [...(s.collaborators ?? [])] } : null;
}

export function setCollaborator(
  id: string,
  by: string,
  wallet: string,
  add: boolean,
): { ok: true; collaborators: string[] } | { ok: false; status: number; message: string } {
  const s = sessions.get(id);
  if (!s) return { ok: false, status: 404, message: "That workspace is gone." };
  if (workspaceRole(id, by) !== "owner") {
    return {
      ok: false,
      status: 403,
      message: "Only the wallet that started this workspace can change who builds on it.",
    };
  }
  if (!WALLET.test(wallet))
    return { ok: false, status: 400, message: "That is not a wallet address." };
  const who = wallet.toLowerCase();
  if (who === s.owner.toLowerCase()) {
    return { ok: false, status: 400, message: "That wallet already owns this workspace." };
  }
  const current = s.collaborators ?? [];
  if (add && !current.includes(who)) {
    if (current.length >= MAX_COLLABORATORS) {
      return {
        ok: false,
        status: 400,
        message: `A workspace can have up to ${MAX_COLLABORATORS} other builders.`,
      };
    }
    s.collaborators = [...current, who];
  } else if (!add) {
    s.collaborators = current.filter((c) => c !== who);
  }
  s.updatedAt = Date.now();
  persist(s);
  return { ok: true, collaborators: [...(s.collaborators ?? [])] };
}

export function workspaceFiles(id: string): Record<string, string> | null {
  const s = sessions.get(id);
  if (!s) return null;
  try {
    return readWorkspace(s.root);
  } catch {
    return null;
  }
}

/** The conversation so far, as the model sees it. Exported for tests. */
export function workspaceMessages(id: string): ProviderMessage[] {
  const s = sessions.get(id);
  if (!s) return [];
  return readJson<ProviderMessage[]>(messagesFile(s)) ?? [];
}

export function trimHistory(
  messages: ProviderMessage[],
  maxChars = MAX_HISTORY_CHARS,
): ProviderMessage[] {
  const size = (m: ProviderMessage) =>
    m.content.length + ("toolCalls" in m && m.toolCalls ? JSON.stringify(m.toolCalls).length : 0);
  let total = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i--) {
    total += size(messages[i]);
    if (total > maxChars) break;
    start = i;
  }
  while (start < messages.length && messages[start].role !== "user") start++;
  return messages.slice(start);
}

export function activeWorkspaces(): number {
  return running.size;
}

export function whenWorkspaceIdle(id: string): Promise<void> {
  return settled.get(id) ?? Promise.resolve();
}

export interface SendOptions {
  context?: string;
  provider?: ModelProvider;
  sandbox?: boolean;
  network?: boolean;
  /** Approve every gated action. Defaults to true when commands run in the
   *  sandbox: there is nobody at the other end of a web page to answer a
   *  permission prompt, and the container is what keeps the machine safe, so
   *  asking only made the agent stop and ask for "shell write access". */
  approve?: boolean;
  /** Tests turn the automatic preview off; it builds through the runner's own
   *  HTTP queue, which is not running under a unit test. */
  preview?: boolean;
}

export function sendWorkspaceMessage(
  id: string,
  prompt: string,
  opts: SendOptions = {},
): { ok: true; session: WorkspaceSession } | { ok: false; status: number; message: string } {
  const session = sessions.get(id);
  if (!session) return { ok: false, status: 404, message: "That workspace is gone." };
  if (running.has(id) || session.phase === "running") {
    return { ok: false, status: 409, message: "The agent is still working on the last message." };
  }
  if (running.size >= MAX_RUNNING) {
    return {
      ok: false,
      status: 429,
      message: "The agent is busy with other people's work. Try again in a minute.",
    };
  }
  const text = prompt.trim().slice(0, 20_000);
  if (!text) return { ok: false, status: 400, message: "Say what you want done." };

  Object.assign(session, {
    phase: "running" as const,
    status: "Starting",
    prompt: text,
    reply: "",
    events: [],
    changed: [],
    handoffs: [],
    error: null,
    updatedAt: Date.now(),
  });
  persist(session);

  const controller = new AbortController();
  running.set(id, controller);
  const done = runTurn(session, text, opts, controller.signal).finally(() => running.delete(id));
  settled.set(id, done);
  return { ok: true, session };
}

export function cancelWorkspace(id: string): boolean {
  const controller = running.get(id);
  const session = sessions.get(id);
  if (!controller || !session) return false;
  controller.abort();
  session.status = "Stopping";
  session.updatedAt = Date.now();
  persist(session);
  return true;
}

export function workspaceNetworkEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.DEVSTATION_WORKSPACE_NETWORK ?? "on").toLowerCase() !== "off";
}

export const WORKSPACE_ADDENDUM = `

You are running in DevStation's web console rather than a terminal. The person talks to you in a chat that sits beside a live preview and a file browser, and the workspace persists between their messages, so build on what is already there.

- Anything can be built here: web apps, smart contracts, scripts, APIs, libraries, command-line tools. Scaffold, install, build and test from the shell as you would on your own machine.
- When the work has a web front end, make it previewable: either a static index.html at the project root, or a package.json whose \`npm run build\` writes static files to dist/ (Vite is a good default). DevStation builds and shows the preview after your turn.
- Verify before you finish: run the build or the tests.
- You cannot push to GitHub, publish, or open a pull request yourself. When the person asks for one, call push_to_github, publish_app or open_pull_request; they confirm it with a button and their own account carries it out.
- End each turn with a short, plain summary of what you did and what they can do next.`;

async function runTurn(
  session: WorkspaceSession,
  prompt: string,
  opts: SendOptions,
  signal: AbortSignal,
): Promise<void> {
  let executor: Executor | null = null;
  let memory: MemoryStore | null = null;
  let lastWrite = 0;
  const touch = (patch: Partial<WorkspaceSession>, force = false) => {
    Object.assign(session, patch, { updatedAt: Date.now() });
    if (force || Date.now() - lastWrite > 1000) {
      lastWrite = Date.now();
      persist(session);
    }
  };
  const finish = (patch: Partial<WorkspaceSession>) => {
    let fileCount = session.fileCount;
    try {
      fileCount = Object.keys(readWorkspace(session.root)).length;
    } catch {
      /* keep the last count */
    }
    touch(
      {
        status: "",
        turns: session.turns + 1,
        revision: session.revision + 1,
        fileCount,
        ...patch,
      },
      true,
    );
  };

  try {
    const provider = opts.provider ?? providerFromEnv();
    if (!provider) {
      finish({ phase: "error", error: "No model provider is configured on the runner." });
      return;
    }

    const wantSandbox = opts.sandbox ?? sandboxEnabled();
    const network = opts.network ?? workspaceNetworkEnabled();
    executor = hostExecutor();
    if (wantSandbox) {
      touch({ status: "Preparing the sandbox" });
      const problem = readinessProblem(await sandboxReadiness());
      if (problem) {
        finish({
          phase: "error",
          error: `This runner cannot isolate the agent, so nothing was run. ${problem}`,
        });
        return;
      }
      executor = sandboxExecutor({ workspace: session.root, network });
    }

    const embeddings = embeddingsFromEnv();
    try {
      memory = openStore(session.root);
      await indexWorkspace(session.root, { store: memory, embeddings });
    } catch {
      memory = null;
    }

    touch({ status: "Thinking" });
    const personTools = ["push_to_github", "publish_app"];
    if (session.source.repo) personTools.push("open_pull_request");
    const context = opts.context ? `\n\n${opts.context.slice(0, 2000)}` : "";
    const sandboxNote =
      executor.kind === "sandbox" ? (network ? SANDBOX_NETWORK_ADDENDUM : SANDBOX_ADDENDUM) : "";
    const repoNote = session.source.repo
      ? `\n\nThis workspace is ${session.source.repo}${session.source.ref ? ` at ${session.source.ref}` : ""}.`
      : "";

    const result = await new Orchestrator({
      executor,
      provider,
      workspace: new Workspace(session.root),
      signal,
      maxSteps: MAX_STEPS,
      maxMs: MAX_MS,
      taskId: `${session.id}-${session.turns + 1}`,
      projectId: session.id,
      memory,
      embeddings,
      systemAddendum: sandboxNote + WORKSPACE_ADDENDUM + repoNote + context,
      offerPersonTools: personTools,
      // Without an approver every gated action is refused, which in a web
      // conversation meant no installs, no builds and no scaffolding at all.
      ...((opts.approve ?? executor.kind === "sandbox")
        ? { autonomy: "autonomous" as const, requestApproval: async () => true }
        : {}),
      onDelta: (chunk) => touch({ reply: session.reply + chunk }),
      onEvent: (event) => {
        session.events.push(event);
        if (session.events.length > MAX_EVENTS) {
          session.events.splice(0, session.events.length - MAX_EVENTS);
        }
        if (event.kind !== "usage") touch({ status: event.message.slice(0, 200) });
      },
    }).run(prompt, workspaceMessages(session.id));

    writeAtomic(messagesFile(session), JSON.stringify(trimHistory(result.messages)));
    finish({
      phase: signal.aborted ? "cancelled" : "idle",
      reply: result.summary || session.reply,
      steps: session.steps + result.steps,
      costUsd: session.costUsd + result.costUsd,
      changed: result.filesChanged,
      handoffs: result.handoffs,
    });
    // The turn is over, so it no longer counts as running. The preview refuses
    // to start while a turn runs, and this line used to come first, which
    // meant no preview was ever built automatically.
    running.delete(session.id);
    if (!signal.aborted && opts.preview !== false) startWorkspacePreview(session.id);
  } catch (error) {
    finish({
      phase: signal.aborted ? "cancelled" : "error",
      error: signal.aborted ? null : error instanceof Error ? error.message : String(error),
    });
  } finally {
    memory?.close();
    await executor?.dispose();
  }
}

// --- preview ----------------------------------------------------------------

export type PreviewPlan =
  | { kind: "build"; dir: string; outDir: string }
  | { kind: "static"; dir: string }
  | { kind: "none"; reason: string };

const PREFERRED_DIRS = ["app", "web", "frontend", "client", "site", "www", "ui"];

/** Where the previewable part of a project is, and how to get static files out
 *  of it. The root first, then a conventional front-end folder. */
export function previewPlan(files: Record<string, string>): PreviewPlan {
  const topDirs = new Set<string>();
  for (const path of Object.keys(files)) {
    const [first, ...rest] = path.split("/");
    if (rest.length === 1 && (rest[0] === "package.json" || rest[0] === "index.html")) {
      topDirs.add(first);
    }
  }
  const ordered = [
    "",
    ...PREFERRED_DIRS.filter((d) => topDirs.has(d)).map((d) => `${d}/`),
    ...[...topDirs]
      .filter((d) => !PREFERRED_DIRS.includes(d))
      .sort()
      .map((d) => `${d}/`),
  ];

  for (const dir of ordered) {
    const pkgRaw = files[`${dir}package.json`];
    if (pkgRaw !== undefined) {
      let build = "";
      try {
        const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
        build = pkg.scripts?.build ?? "";
      } catch {
        build = "";
      }
      if (build) {
        const outDir = /react-scripts/.test(build) ? "build" : "dist";
        return { kind: "build", dir, outDir };
      }
    }
    if (`${dir}index.html` in files) return { kind: "static", dir };
  }
  return {
    kind: "none",
    reason:
      "Nothing here has a web page to show: no index.html and no package.json with a build script. The work is in the Files tab.",
  };
}

function under(files: Record<string, string>, dir: string): Record<string, string> {
  if (!dir) return { ...files };
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (path.startsWith(dir)) out[path.slice(dir.length)] = content;
  }
  return out;
}

/** Folders that hold nothing a preview build needs: installs, history and
 *  earlier build output. */
const PREVIEW_SKIP = new Set([
  "node_modules",
  ".git",
  ".agent",
  ".devstation",
  "dist",
  "build",
  ".next",
  ".turbo",
]);
const MAX_ASSET_BYTES = 1024 * 1024;

const previewAssetsFile = (s: { root: string }) => `${s.root}.preview-assets.json`;

/**
 * The files readWorkspace leaves out because they are not text -- images,
 * fonts, icons -- as base64, keyed by path under `dir`.
 *
 * A preview used to be built from the text files alone, so a project that
 * imports ./assets/hero.png, as the Vite template does, failed with "Could not
 * resolve" however correct its code was.
 */
export function readBinaryFiles(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (current: string) => {
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of entries) {
      if (item.isSymbolicLink()) continue;
      const full = join(current, item.name);
      if (item.isDirectory()) {
        if (!PREVIEW_SKIP.has(item.name)) walk(full);
        continue;
      }
      if (!item.isFile()) continue;
      try {
        if (statSync(full).size > MAX_ASSET_BYTES) continue;
        const bytes = readFileSync(full);
        // The same test readWorkspace uses, so every file lands on exactly one side.
        if (!looksBinary(bytes)) continue;
        out[relative(dir, full).split(sep).join("/")] = bytes.toString("base64");
      } catch {
        // A file that vanished mid-walk is not a failed preview.
      }
    }
  };
  walk(dir);
  return out;
}

export function previewDist(id: string): Record<string, string> | null {
  const s = sessions.get(id);
  if (!s) return null;
  return readJson<Record<string, string>>(previewFile(s));
}

/** The preview's images and fonts, as base64, beside previewDist's text. */
export function previewAssets(id: string): Record<string, string> {
  const s = sessions.get(id);
  if (!s) return {};
  return readJson<Record<string, string>>(previewAssetsFile(s)) ?? {};
}

export function startWorkspacePreview(
  id: string,
  buildImpl: typeof buildViaSelf = buildViaSelf,
): { ok: true; session: WorkspaceSession } | { ok: false; status: number; message: string } {
  const session = sessions.get(id);
  if (!session) return { ok: false, status: 404, message: "That workspace is gone." };
  if (session.preview.phase === "building") return { ok: true, session };
  if (running.has(id)) {
    return {
      ok: false,
      status: 409,
      message: "The agent is still working. The preview builds when it finishes.",
    };
  }

  const files = workspaceFiles(id) ?? {};
  const plan = previewPlan(files);
  const revision = session.revision;
  const set = (preview: WorkspaceSession["preview"]) => {
    session.preview = preview;
    session.updatedAt = Date.now();
    persist(session);
  };

  if (plan.kind === "none") {
    set({ phase: "unsupported", revision, message: plan.reason });
    return { ok: true, session };
  }
  if (plan.kind === "static") {
    writeAtomic(previewFile(session), JSON.stringify(under(files, plan.dir)));
    writeAtomic(
      previewAssetsFile(session),
      JSON.stringify(readBinaryFiles(join(session.root, plan.dir))),
    );
    set({ phase: "ready", revision, message: null });
    return { ok: true, session };
  }

  let project = under(files, plan.dir);
  const binary = readBinaryFiles(join(session.root, plan.dir));
  const binaryBytes = Object.values(binary).reduce((n, c) => n + Math.floor((c.length * 3) / 4), 0);
  const binaryCount = Object.keys(binary).length;
  const size = (f: Record<string, string>) =>
    Object.values(f).reduce((n, c) => n + c.length, 0) + binaryBytes;
  const count = (f: Record<string, string>) => Object.keys(f).length + binaryCount;
  // Lockfiles are the largest thing in most projects and npm installs without
  // one, so they go first when a project is over the build limits.
  if (size(project) > LIMITS.maxInputBytes || count(project) > LIMITS.maxFiles) {
    project = Object.fromEntries(
      Object.entries(project).filter(
        ([p]) => !/(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(p),
      ),
    );
  }
  if (size(project) > LIMITS.maxInputBytes || count(project) > LIMITS.maxFiles) {
    set({
      phase: "unsupported",
      revision,
      message: `This project is too large to build a preview here (${LIMITS.maxFiles} files and 2 MB at most). Download it to run it locally.`,
    });
    return { ok: true, session };
  }

  set({ phase: "building", revision, message: "Installing and building" });
  void buildImpl(project, plan.outDir, binary).then((outcome) => {
    if (sessions.get(id) !== session) return;
    if (outcome.ok && outcome.dist && Object.keys(outcome.dist).length > 0) {
      writeAtomic(previewFile(session), JSON.stringify(outcome.dist));
      writeAtomic(previewAssetsFile(session), JSON.stringify(outcome.distBinary ?? {}));
      set({ phase: "ready", revision, message: null });
    } else {
      set({ phase: "error", revision, message: outcome.message });
    }
  });
  return { ok: true, session };
}

/** Builds through this runner's own /jobs endpoint, so previews share the build
 *  queue, its limits and its container isolation. */
export async function buildViaSelf(
  files: Record<string, string>,
  outDir: string,
  binaryFiles: Record<string, string> = {},
): Promise<{
  ok: boolean;
  dist: Record<string, string> | null;
  /** Built images and fonts, as base64. */
  distBinary?: Record<string, string> | null;
  message: string;
}> {
  const port = process.env.PORT ?? "8792";
  try {
    const res = await fetch(`http://127.0.0.1:${port}/jobs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.RUNNER_TOKEN ?? ""}`,
        "x-devstation-caller": "workspace-preview",
      },
      body: JSON.stringify({
        files,
        ...(Object.keys(binaryFiles).length > 0 ? { binaryFiles } : {}),
        phases: ["install", "build"],
        outDir,
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      dist?: Record<string, string> | null;
      distBinary?: Record<string, string> | null;
      message?: string;
      phases?: Array<{ phase: string; ok: boolean; log?: string }>;
    } | null;
    if (body?.ok && body.dist) {
      return { ok: true, dist: body.dist, distBinary: body.distBinary ?? null, message: "" };
    }
    const failed = body?.phases?.find((p) => !p.ok);
    const log = failed?.log ? `\n${failed.log.slice(-1500)}` : "";
    return {
      ok: false,
      dist: null,
      message: failed
        ? `The ${failed.phase} step failed.${log}`
        : body?.message || `The preview build failed (${res.status}).`,
    };
  } catch (error) {
    return {
      ok: false,
      dist: null,
      message: error instanceof Error ? error.message : "The preview build failed.",
    };
  }
}
