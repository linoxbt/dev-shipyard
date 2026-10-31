import { createFileRoute } from "@tanstack/react-router";
import { sandboxHostEnabled, sandboxRunner, splitId } from "@/lib/orchestrator/sandbox.server";
import { modelProblem } from "@/lib/db/access.server";
import { connectorEnvFor } from "@/lib/db/connectors.server";
import { recordTurn } from "@/lib/db/turns.server";
import { bumpMetric } from "@/lib/db/admin.server";
import { isControlPath, looksLikeSecret } from "@/lib/agent/workspace";
import { AUTO_MODEL, MODEL_IDS } from "@/lib/coding-agent/models";
import { accountAddress } from "@/lib/auth/account.server";
import { z } from "zod";
import { linkedGithub } from "@/lib/github-link.server";
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

/** The deletions a pull request may propose. Paths the workspace never reads
 *  back are missing from it without anyone deleting them: skipped directories,
 *  and the tool configuration (.mcp.json, .git) and credential files the
 *  workspace refuses to hold. Proposing those as deletions would remove them
 *  from the user's repository. */
export function deletionsToPropose(deleted: string[]): string[] {
  return deleted.filter(
    (path) => !UNREAD.test(path) && !isControlPath(path) && !looksLikeSecret(path),
  );
}

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

const NOT_YOURS = ["not_yours", "That workspace was not started from this browser.", 403] as const;
const NO_GRANT = ["no_grant", "Sign in with your email to use the agent.", 401] as const;

function runnerConfig() {
  const e = process.env;
  return { url: (e.RUNNER_URL ?? "").replace(/\/+$/, ""), token: e.RUNNER_TOKEN ?? "" };
}

/**
 * Where a request goes: the project's own Vercel Sandbox, in this Vercel
 * account (src/lib/orchestrator). AGENT_HOST=runner sends everything to a
 * separate runner (RUNNER_URL, RUNNER_TOKEN) instead.
 *
 * A project started on the old runner has no sandbox: it is answered as gone,
 * and the browser, which keeps the project's files, recreates it in a
 * sandbox with the next message (the `restore` path below).
 */
async function runner(
  request: Request,
  path: string,
  init: RequestInit & { owner?: string } = {},
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  if (!sandboxHostEnabled()) return httpRunner(request, path, init);
  const creating = path === "/agent/workspaces" && init.method === "POST";
  const id = decodeURIComponent(path.split("/")[3] ?? "");
  if (creating || splitId(id)) {
    return sandboxRunner(path, init, clientKeyFromRequest(request));
  }
  return { ok: false, status: 404, body: { ok: false, message: "That workspace is gone." } };
}

async function httpRunner(
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

/** How the agent should take a message: which model (only those on offer)
 *  and whether to plan first. */
const turnOptions = {
  model: z
    .string()
    .refine((m) => m === AUTO_MODEL || MODEL_IDS.includes(m), "Unknown model.")
    .optional(),
  mode: z.enum(["build", "plan"]).optional(),
  /** Pictures for this message: JPEG or PNG data URLs, resized in the browser. */
  images: z
    .array(
      z
        .string()
        .max(1_500_000)
        .regex(/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/),
    )
    .max(4)
    .optional(),
};

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    source: sourceSchema,
    prompt: z.string().max(20_000).optional(),
    context: z.string().max(2000).optional(),
    ...turnOptions,
  }),
  z.object({
    action: z.literal("message"),
    id: z.string().min(1).max(80),
    prompt: z.string().min(1).max(20_000),
    context: z.string().max(2000).optional(),
    /** Sent with every message: if the runner has swept the workspace, it is
     *  recreated from this and the conversation carries on. */
    restore: sourceSchema.optional(),
    ...turnOptions,
  }),
  z.object({ action: z.literal("cancel"), id: z.string().min(1).max(80) }),
  /** Open somebody else's workspace, as a builder they added. */
  z.object({ action: z.literal("join"), id: z.string().min(1).max(80) }),
  /** Add or remove a builder. Only the owner can; the runner checks. */
  z
    .object({
      action: z.literal("members"),
      id: z.string().min(1).max(80),
      /** A builder's account, by the email they sign in with... */
      email: z.string().trim().toLowerCase().email().max(320).optional(),
      /** ...or by the id the runner knows them by (removing one listed). */
      wallet: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/)
        .optional(),
      remove: z.boolean().optional(),
    })
    .refine((v) => !!v.email !== !!v.wallet, "Give an email or an id."),
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

type Turn = { model?: string; mode?: "build" | "plan"; images?: string[] };

/** What the runner takes: a model it resolves itself, and plan as a flag. */
function turnBody(turn: Turn): { model?: string; plan?: boolean; images?: string[] } {
  return {
    ...(turn.model && turn.model !== AUTO_MODEL ? { model: turn.model } : {}),
    ...(turn.mode === "plan" ? { plan: true } : {}),
    ...(turn.images?.length ? { images: turn.images } : {}),
  };
}

function claimsOf(request: Request) {
  return openClaims(readCookie(request.headers.get("cookie"), CLAIM_COOKIE));
}

function withCookie(payload: unknown, cookie: string | null, status = 200): Response {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (cookie) headers["set-cookie"] = cookie;
  return new Response(JSON.stringify(payload), { status, headers });
}

/** GitHub's answer for an anonymous look at a repository: 200 when public,
 *  404 when private or missing, anything else (rate limits) when unknown. */
async function publicRepoStatus(owner: string, name: string): Promise<number> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`,
      {
        headers: { accept: "application/vnd.github+json", "user-agent": "devstation" },
        signal: AbortSignal.timeout(8_000),
      },
    );
    return res.status;
  } catch {
    return 0;
  }
}

/** A private repository the person has connected is read here with their
 *  session. Anything else goes to the runner as it is. */
async function resolveSource(request: Request, source: Source): Promise<Source | Response> {
  if (source.kind !== "github") return source;
  const target = parseRepo(source.repo);
  if (!target)
    return fail("invalid_repo", "That is not a GitHub repository. Use owner/name or its URL.", 400);
  // A private repository is read with the person's session only when that
  // session is the GitHub account linked to the signed-in wallet. Otherwise it
  // goes to the runner as a public one.
  const linked = await linkedGithub(request, "import a private repository");
  if (!linked.ok) {
    // Fine for a public repository. For one that is not public, say why it
    // cannot be read, rather than letting the runner fail with "not found".
    if ((await publicRepoStatus(target.owner, target.name)) === 404) {
      return fail(
        linked.reason,
        `${linked.message} ${source.repo} is not public, so it can only be imported with the GitHub account linked to your wallet.`,
        linked.status,
      );
    }
    return source;
  }
  const { token } = linked;
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

/** The person's connected accounts, for the agent to act as them this turn:
 *  saved connectors, and the GitHub account linked to their session. */
async function turnEnv(request: Request, owner: string): Promise<Record<string, string>> {
  const env = await connectorEnvFor(owner).catch(() => ({}) as Record<string, string>);
  if (!env.GH_TOKEN) {
    const linked = await linkedGithub(request).catch(() => null);
    if (linked?.ok) {
      env.GH_TOKEN = linked.token;
      env.GITHUB_TOKEN = linked.token;
    }
  }
  return env;
}

async function create(
  request: Request,
  owner: string,
  source: Source,
  prompt: string | undefined,
  context: string | undefined,
  turn: Turn = {},
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
        body: JSON.stringify({
          prompt,
          context,
          ...turnBody(turn),
          env: await turnEnv(request, owner),
        }),
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
          return Response.json({
            configured: sandboxHostEnabled() || Boolean(runnerUrl && token),
          });
        }
        if (!holdsClaim(claimsOf(request), id)) return fail(...NOT_YOURS);
        if (
          !(await checkRateLimit(
            `workspace:poll:${clientKeyFromRequest(request)}`,
            POLL_LIMIT,
            WINDOW_MS,
          ))
        ) {
          return fail("rate_limited", "Too many requests. Wait a moment.", 429);
        }
        const members = url.searchParams.get("members");
        const shot = url.searchParams.get("shot");
        const suffix = shot
          ? /^shot-[a-z0-9]+-\d+$/.test(shot)
            ? `/shot/${shot}`
            : "/shot/invalid"
          : url.searchParams.get("files")
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
        // A finished turn is recorded once, for the stats and credit spend.
        if (!suffix && result.ok) {
          await recordTurn(ownerOf(claimsOf(request)), id, result.body.workspace);
        }
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
          if (!(await checkRateLimit(`workspace:start:${key}`, START_LIMIT, WINDOW_MS))) {
            return fail("rate_limited", "Too many workspaces started. Try again later.", 429);
          }
          const { url, token } = runnerConfig();
          // A sandbox is its own isolation; a separate runner proves it has some.
          if (!sandboxHostEnabled() && url && token) {
            const isolation = await runnerIsolation(url, token);
            if (!isolation.ok) return fail("not_isolated", isolation.why, 503);
          }
          if (data.prompt?.trim()) {
            const locked = await modelProblem(owner, data.model);
            if (locked) return fail("upgrade_required", locked, 402);
          }
          const made = await create(request, owner, data.source, data.prompt, data.context, data);
          if (made instanceof Response) return made;
          await bumpMetric("projects_created");
          return withCookie(made, claimCookieHeader(withClaim(claims, made.workspace.id, owner)));
        }

        if (data.action === "message") {
          if (!holdsClaim(claims, data.id)) return fail(...NOT_YOURS);
          const owner = ownerOf(claims);
          if (!owner) return fail(...NO_GRANT);
          if (!(await checkRateLimit(`workspace:message:${key}`, MESSAGE_LIMIT, WINDOW_MS))) {
            return fail("rate_limited", "Too many messages. Try again later.", 429);
          }
          const locked = await modelProblem(owner, data.model);
          if (locked) return fail("upgrade_required", locked, 402);
          await bumpMetric("messages");
          const sent = await runner(
            request,
            `/agent/workspaces/${encodeURIComponent(data.id)}/messages`,
            {
              method: "POST",
              owner,
              body: JSON.stringify({
                prompt: data.prompt,
                context: data.context,
                ...turnBody(data),
                env: await turnEnv(request, owner),
              }),
            },
          );
          if (sent.ok) return Response.json(sent.body);
          if (sent.status === 404 && data.restore) {
            const made = await create(
              request,
              owner,
              data.restore,
              data.prompt,
              data.context,
              data,
            );
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
          if (!(await checkRateLimit(`workspace:join:${key}`, START_LIMIT, WINDOW_MS))) {
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
              // A builder added by email is known to the runner by the account
              // id that email signs in as (lib/auth/account.server.ts).
              body: JSON.stringify({
                wallet: data.email ? accountAddress(data.email) : data.wallet,
                remove: data.remove === true,
              }),
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
        const linked = await linkedGithub(request, "open a pull request");
        if (!linked.ok) return fail(linked.reason, linked.message, linked.status);
        const { token } = linked;
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
          const deleted = deletionsToPropose(change.deleted);
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
