import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { COOKIE_NAME, openSession } from "@/lib/github-oauth.server";
import {
  branchNameFor,
  changedFiles,
  fetchTarball,
  getRepo,
  openPullRequest,
  parseRepo,
} from "@/lib/github-repos";
import { filesFromArchive, readTarGz } from "@/lib/repo-archive";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";
import {
  CLAIM_COOKIE,
  claimCookieHeader,
  holdsClaim,
  openClaims,
  ownerOf,
  readCookie,
  withClaim,
} from "@/lib/agent-access/claims.server";
import { runnerIsolation } from "@/lib/agent-access/runner-health.server";

// The Coding Agent's one route.
//
// Starts a workspace on the runner, sends it messages, reads it back, builds
// its preview, and -- only when someone asks -- opens a pull request with their
// GitHub session. Starting and talking need a wallet, the same one signature
// the rest of the agent uses, because a run spends model credits and executes
// commands on DevStation's hardware. They do NOT need GitHub: a public
// repository is downloaded by the runner without a token, and a private one is
// read here with the person's session only if they have connected it.
//
// Everything a browser can touch is checked against the sealed claim cookie, so
// knowing a workspace id is not enough to read or drive somebody else's.

const START_LIMIT = 30;
const MESSAGE_LIMIT = 200;
const POLL_LIMIT = 4000;
const WINDOW_MS = 60 * 60 * 1000;

/** What a private repository may bring in when read here, inside a serverless
 *  function's time and body limits. Public ones are fetched by the runner. */
const PRIVATE_IMPORT = { maxFiles: 3000, maxBytes: 8 * 1024 * 1024 };

/** Directories the workspace never reads back, so they are not reported as
 *  deleted when a pull request is compared against the repository. */
const UNREAD = /^(|.*\/)(\.git|\.agent|\.devstation|node_modules|\.next|dist|build|\.turbo)\//;

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

const NOT_YOURS = ["not_yours", "That workspace was not started from this browser.", 403] as const;
const NO_GRANT = [
  "no_grant",
  "Connect a wallet and sign once to use the agent. It costs no gas.",
  401,
] as const;

function runnerConfig() {
  const e = process.env;
  return { url: (e.RUNNER_URL ?? "").replace(/\/+$/, ""), token: e.RUNNER_TOKEN ?? "" };
}

async function runner(
  request: Request,
  path: string,
  init: RequestInit & { owner?: string } = {},
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const { url, token } = runnerConfig();
  if (!url || !token) {
    return { ok: false, status: 503, body: { message: "The agent service is not configured." } };
  }
  try {
    const res = await fetch(`${url}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        "x-devstation-caller": clientKeyFromRequest(request),
        ...(init.owner ? { "x-devstation-owner": init.owner } : {}),
      },
    });
    const body = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
    return { ok: res.ok, status: res.status, body };
  } catch {
    return { ok: false, status: 502, body: { message: "The agent service could not be reached." } };
  }
}

const filesSchema = z.record(z.string().max(400), z.string());
const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("blank") }),
  z.object({
    kind: z.literal("files"),
    files: filesSchema,
    repo: z.string().max(200).optional(),
    ref: z.string().max(200).optional(),
  }),
  z.object({
    kind: z.literal("github"),
    repo: z.string().min(1).max(200),
    ref: z.string().max(200).optional(),
  }),
]);
type Source = z.infer<typeof sourceSchema>;

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    source: sourceSchema,
    prompt: z.string().max(20_000).optional(),
    context: z.string().max(2000).optional(),
  }),
  z.object({
    action: z.literal("message"),
    id: z.string().min(1).max(80),
    prompt: z.string().min(1).max(20_000),
    context: z.string().max(2000).optional(),
    /** Sent with every message: if the runner has swept the workspace, it is
     *  recreated from this and the conversation carries on. */
    restore: sourceSchema.optional(),
  }),
  z.object({ action: z.literal("cancel"), id: z.string().min(1).max(80) }),
  /** Open somebody else's workspace, as a builder they added. */
  z.object({ action: z.literal("join"), id: z.string().min(1).max(80) }),
  /** Add or remove a builder. Only the owner can; the runner checks. */
  z.object({
    action: z.literal("members"),
    id: z.string().min(1).max(80),
    wallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    remove: z.boolean().optional(),
  }),
  z.object({ action: z.literal("preview"), id: z.string().min(1).max(80) }),
  z.object({
    action: z.literal("pull_request"),
    id: z.string().min(1).max(80),
    repo: z.string().min(1).max(200),
    base: z.string().min(1).max(200),
    title: z.string().min(1).max(120),
    body: z.string().max(60_000).default(""),
  }),
]);

function claimsOf(request: Request) {
  return openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE));
}

function withCookie(payload: unknown, cookie: string | null, status = 200): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(JSON.stringify(payload), { status, headers });
}

/** A private repository the person has connected is read here with their
 *  session. Anything else goes to the runner as it is. */
async function resolveSource(request: Request, source: Source): Promise<Source | Response> {
  if (source.kind !== "github") return source;
  const target = parseRepo(source.repo);
  if (!target)
    return fail("invalid_repo", "That is not a GitHub repository. Use owner/name or its URL.", 400);
  const token = openSession(readCookie(request.headers.get("cookie"), COOKIE_NAME));
  if (!token) return source;
  try {
    const repo = await getRepo(token, target.owner, target.name);
    if (!repo.private) return { kind: "github", repo: repo.fullName, ref: source.ref };
    const ref = source.ref || repo.defaultBranch;
    const read = filesFromArchive(
      readTarGz(await fetchTarball(token, repo.owner, repo.name, ref)),
      PRIVATE_IMPORT,
    );
    if ("error" in read) return fail("too_large", read.error, 413);
    return { kind: "files", files: read.files, repo: repo.fullName, ref };
  } catch {
    // Not visible to this account: let the runner try it as a public one and
    // report what it finds.
    return source;
  }
}

async function create(
  request: Request,
  owner: string,
  source: Source,
  prompt: string | undefined,
  context: string | undefined,
): Promise<{ ok: true; workspace: { id: string } & Record<string, unknown> } | Response> {
  const resolved = await resolveSource(request, source);
  if (resolved instanceof Response) return resolved;
  const made = await runner(request, "/agent/workspaces", {
    method: "POST",
    owner,
    body: JSON.stringify({ source: resolved }),
  });
  if (!made.ok) return fail("runner", String(made.body.message ?? "Could not start."), made.status);
  let workspace = made.body.workspace as { id: string } & Record<string, unknown>;
  if (prompt?.trim()) {
    const sent = await runner(
      request,
      `/agent/workspaces/${encodeURIComponent(workspace.id)}/messages`,
      {
        method: "POST",
        owner,
        body: JSON.stringify({ prompt, context }),
      },
    );
    if (!sent.ok)
      return fail("runner", String(sent.body.message ?? "Could not send."), sent.status);
    workspace = sent.body.workspace as typeof workspace;
  }
  return { ok: true, workspace };
}

export const Route = createFileRoute("/api/workspace")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const id = url.searchParams.get("id");
        if (!id) {
          const { url: runnerUrl, token } = runnerConfig();
          return Response.json({ configured: Boolean(runnerUrl && token) });
        }
        if (!holdsClaim(claimsOf(request), id)) return fail(...NOT_YOURS);
        if (
          !checkRateLimit(`workspace:poll:${clientKeyFromRequest(request)}`, POLL_LIMIT, WINDOW_MS)
        ) {
          return fail("rate_limited", "Too many requests. Wait a moment.", 429);
        }
        const members = url.searchParams.get("members");
        const suffix = url.searchParams.get("files")
          ? "/files"
          : url.searchParams.get("preview")
            ? "/preview"
            : members
              ? "/members"
              : "";
        const result = await runner(
          request,
          `/agent/workspaces/${encodeURIComponent(id)}${suffix}`,
          members ? { owner: ownerOf(claimsOf(request)) ?? "" } : {},
        );
        return Response.json(result.body, { status: result.status });
      },

      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);
        const data = parsed.data;
        const claims = claimsOf(request);
        const key = clientKeyFromRequest(request);

        if (data.action === "create") {
          const owner = ownerOf(claims);
          if (!owner) return fail(...NO_GRANT);
          if (!checkRateLimit(`workspace:start:${key}`, START_LIMIT, WINDOW_MS)) {
            return fail("rate_limited", "Too many workspaces started. Try again later.", 429);
          }
          const { url, token } = runnerConfig();
          if (url && token) {
            const isolation = await runnerIsolation(url, token);
            if (!isolation.ok) return fail("not_isolated", isolation.why, 503);
          }
          const made = await create(request, owner, data.source, data.prompt, data.context);
          if (made instanceof Response) return made;
          return withCookie(made, claimCookieHeader(withClaim(claims, made.workspace.id, owner)));
        }

        if (data.action === "message") {
          if (!holdsClaim(claims, data.id)) return fail(...NOT_YOURS);
          const owner = ownerOf(claims);
          if (!owner) return fail(...NO_GRANT);
          if (!checkRateLimit(`workspace:message:${key}`, MESSAGE_LIMIT, WINDOW_MS)) {
            return fail("rate_limited", "Too many messages. Try again later.", 429);
          }
          const sent = await runner(
            request,
            `/agent/workspaces/${encodeURIComponent(data.id)}/messages`,
            {
              method: "POST",
              owner,
              body: JSON.stringify({ prompt: data.prompt, context: data.context }),
            },
          );
          if (sent.ok) return Response.json(sent.body);
          if (sent.status === 404 && data.restore) {
            const made = await create(request, owner, data.restore, data.prompt, data.context);
            if (made instanceof Response) return made;
            return withCookie(
              { ...made, replaced: true },
              claimCookieHeader(withClaim(claims, made.workspace.id, owner)),
            );
          }
          return fail("runner", String(sent.body.message ?? "Could not send."), sent.status);
        }

        if (data.action === "join") {
          const owner = ownerOf(claims);
          if (!owner) return fail(...NO_GRANT);
          if (!checkRateLimit(`workspace:join:${key}`, START_LIMIT, WINDOW_MS)) {
            return fail("rate_limited", "Too many workspaces opened. Try again later.", 429);
          }
          const path = `/agent/workspaces/${encodeURIComponent(data.id)}`;
          const members = await runner(request, `${path}/members`, { owner });
          if (!members.ok) {
            return fail(
              "runner",
              String(members.body.message ?? "That workspace is gone."),
              members.status,
            );
          }
          if (!members.body.role) {
            return fail(
              "not_invited",
              "This wallet has not been added to that app. Ask its owner to add it.",
              403,
            );
          }
          const [view, files] = await Promise.all([
            runner(request, path),
            runner(request, `${path}/files`),
          ]);
          if (!view.ok) {
            return fail(
              "runner",
              String(view.body.message ?? "That workspace is gone."),
              view.status,
            );
          }
          return withCookie(
            {
              ok: true,
              role: members.body.role,
              workspace: view.body.workspace,
              files: files.body.files ?? {},
            },
            claimCookieHeader(withClaim(claims, data.id, owner)),
          );
        }

        if (!holdsClaim(claims, data.id)) return fail(...NOT_YOURS);

        if (data.action === "members") {
          const owner = ownerOf(claims);
          if (!owner) return fail(...NO_GRANT);
          const result = await runner(
            request,
            `/agent/workspaces/${encodeURIComponent(data.id)}/members`,
            {
              method: "POST",
              owner,
              body: JSON.stringify({ wallet: data.wallet, remove: data.remove === true }),
            },
          );
          return Response.json(result.body, { status: result.status });
        }

        if (data.action === "cancel" || data.action === "preview") {
          const result = await runner(
            request,
            `/agent/workspaces/${encodeURIComponent(data.id)}/${data.action}`,
            { method: "POST" },
          );
          return Response.json(result.body, { status: result.status });
        }

        // Opening a pull request is the one thing here that needs GitHub, and
        // it is the person's own action, with their own session.
        const token = openSession(readCookie(request.headers.get("cookie"), COOKIE_NAME));
        if (!token) return fail("not_signed_in", "Connect GitHub to open a pull request.", 401);
        const target = parseRepo(data.repo);
        if (!target) return fail("invalid_repo", "That is not a repository.", 400);

        const current = await runner(
          request,
          `/agent/workspaces/${encodeURIComponent(data.id)}/files`,
        );
        if (!current.ok)
          return fail("runner", String(current.body.message ?? "No files."), current.status);
        const files = current.body.files as Record<string, string>;

        try {
          const base = filesFromArchive(
            readTarGz(await fetchTarball(token, target.owner, target.name, data.base)),
          );
          if ("error" in base) return fail("too_large", base.error, 413);
          const change = changedFiles(base.files, files);
          const deleted = change.deleted.filter((path) => !UNREAD.test(path));
          if (Object.keys(change.files).length === 0 && deleted.length === 0) {
            return fail(
              "empty",
              "Nothing differs from the repository, so there is nothing to propose.",
              400,
            );
          }
          const pull = await openPullRequest(
            token,
            target.owner,
            target.name,
            {
              files: change.files,
              deleted,
              message: `${data.title}\n\nOpened from DevStation.`,
              branch: branchNameFor(data.title),
              base: data.base,
            },
            { title: data.title, body: data.body },
          );
          return Response.json({ ok: true, pull });
        } catch (e) {
          return fail("github", e instanceof Error ? e.message : "The pull request failed.", 400);
        }
      },
    },
  },
});
