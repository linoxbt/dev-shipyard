import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { COOKIE_NAME, openSession, readCookie } from "@/lib/github-oauth.server";
import {
  branchNameFor,
  fetchTarball,
  getRepo,
  listRepos,
  openPullRequest,
  parseRepo,
} from "@/lib/github-repos";
import { filesFromArchive, readTarGz } from "@/lib/repo-archive";
import { checkRateLimit, clientKeyFromRequest } from "@/lib/rateLimit.server";

// The one place that holds both halves.
//
// The GitHub token lives in an httpOnly cookie and is read here, on the
// server. The runner holds the workspace and does the work. Neither has what
// the other has, and this route is the seam: it downloads the repository with
// the person's session, sends only text to the runner, and later takes the
// runner's changed files and opens a pull request with the person's session
// again, once they have said yes.
//
// The browser never receives the token, and the runner never receives it
// either. That is not incidental: it is what keeps opening a pull request the
// person's action rather than the agent's.

const PER_IP_START_LIMIT = 20;
const PER_IP_POLL_LIMIT = 2000;
const WINDOW_MS = 60 * 60 * 1000;

function fail(reason: string, message: string, status: number) {
  return Response.json({ ok: false, reason, message }, { status });
}

/** Read per request: some hosts bind env per request, where a module-level
 *  read is undefined. */
function runnerConfig() {
  const e = process.env;
  return { url: (e.RUNNER_URL ?? "").replace(/\/+$/, ""), token: e.RUNNER_TOKEN ?? "" };
}

async function runner(
  path: string,
  init: RequestInit = {},
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  const { url, token } = runnerConfig();
  if (!url || !token) {
    return { ok: false, status: 503, message: "The agent service is not configured." };
  }
  try {
    const res = await fetch(`${url}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
        ...(init.headers ?? {}),
      },
    });
    const body = (await res.json().catch(() => null)) as { message?: string } | null;
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        message: body?.message ?? "The run failed to start.",
      };
    }
    return { ok: true, body };
  } catch {
    return { ok: false, status: 502, message: "The agent service could not be reached." };
  }
}

const startSchema = z.object({
  action: z.literal("start"),
  repo: z.string().min(1).max(200),
  goal: z.string().min(1).max(4000),
  ref: z.string().max(200).optional(),
});

const pullSchema = z.object({
  action: z.literal("pull_request"),
  id: z.string().min(1).max(80),
  repo: z.string().min(1).max(200),
  base: z.string().min(1).max(200),
  title: z.string().min(1).max(120),
  body: z.string().max(60_000).default(""),
});

const cancelSchema = z.object({
  action: z.literal("cancel"),
  id: z.string().min(1).max(80),
});

const bodySchema = z.discriminatedUnion("action", [startSchema, pullSchema, cancelSchema]);

export const Route = createFileRoute("/api/repo-agent")({
  server: {
    handlers: {
      // Either the repositories this account can push to, or one run's state.
      GET: async ({ request }) => {
        const token = openSession(readCookie(request.headers.get("cookie"), COOKIE_NAME));
        if (!token) return fail("not_signed_in", "Connect your GitHub account first.", 401);

        const url = new URL(request.url);
        const id = url.searchParams.get("id");

        if (!id) {
          try {
            return Response.json({ ok: true, repos: await listRepos(token) });
          } catch (e) {
            return fail("github", e instanceof Error ? e.message : "Could not list repos.", 400);
          }
        }

        if (
          !checkRateLimit(
            `repo-agent:poll:${clientKeyFromRequest(request)}`,
            PER_IP_POLL_LIMIT,
            WINDOW_MS,
          )
        ) {
          return fail("rate_limited", "Too many requests. Wait a moment.", 429);
        }
        const result = await runner(`/agent/repo-jobs/${encodeURIComponent(id)}`);
        if (!result.ok) return fail("runner", result.message, result.status);
        return Response.json(result.body);
      },

      POST: async ({ request }) => {
        const token = openSession(readCookie(request.headers.get("cookie"), COOKIE_NAME));
        if (!token) return fail("not_signed_in", "Connect your GitHub account first.", 401);

        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return fail("invalid_body", "Malformed request.", 400);

        if (parsed.data.action === "cancel") {
          const result = await runner(
            `/agent/repo-jobs/${encodeURIComponent(parsed.data.id)}/cancel`,
            {
              method: "POST",
            },
          );
          if (!result.ok) return fail("runner", result.message, result.status);
          return Response.json({ ok: true });
        }

        if (parsed.data.action === "start") {
          if (
            !checkRateLimit(
              `repo-agent:start:${clientKeyFromRequest(request)}`,
              PER_IP_START_LIMIT,
              WINDOW_MS,
            )
          ) {
            return fail("rate_limited", "Too many runs started. Try again later.", 429);
          }
          return start(token, parsed.data);
        }

        return pullRequest(token, parsed.data);
      },
    },
  },
});

async function start(token: string, input: z.infer<typeof startSchema>): Promise<Response> {
  const target = parseRepo(input.repo);
  if (!target) return fail("invalid_repo", "That is not a repository. Use owner/name.", 400);

  let repo;
  try {
    repo = await getRepo(token, target.owner, target.name);
  } catch (e) {
    return fail("github", e instanceof Error ? e.message : "Could not open that repo.", 400);
  }

  const ref = input.ref || repo.defaultBranch;
  let files: Record<string, string>;
  let skipped: number;
  try {
    const archive = readTarGz(await fetchTarball(token, repo.owner, repo.name, ref));
    const read = filesFromArchive(archive);
    if ("error" in read) return fail("too_large", read.error, 413);
    files = read.files;
    skipped = read.skipped.length;
  } catch (e) {
    return fail("github", e instanceof Error ? e.message : "Could not download the repo.", 400);
  }

  if (Object.keys(files).length === 0) {
    return fail("empty", "There is nothing in that repository the agent can read.", 400);
  }

  const result = await runner("/agent/repo-jobs", {
    method: "POST",
    body: JSON.stringify({ repo: repo.fullName, ref, goal: input.goal, files }),
  });
  if (!result.ok) return fail("runner", result.message, result.status);

  const body = result.body as { job?: { id?: string } };
  return Response.json({
    ok: true,
    job: body.job,
    repo: { fullName: repo.fullName, defaultBranch: repo.defaultBranch, private: repo.private },
    ref,
    fileCount: Object.keys(files).length,
    skipped,
  });
}

async function pullRequest(token: string, input: z.infer<typeof pullSchema>): Promise<Response> {
  const target = parseRepo(input.repo);
  if (!target) return fail("invalid_repo", "That is not a repository.", 400);

  // Fetched from the runner rather than accepted from the browser. A page
  // cannot be allowed to say what goes into the commit: the change is whatever
  // the run actually produced, and that lives on the runner.
  const change = await runner(`/agent/repo-jobs/${encodeURIComponent(input.id)}/change`);
  if (!change.ok) return fail("runner", change.message, change.status);

  const { files, deleted } = change.body as { files: Record<string, string>; deleted: string[] };
  if (Object.keys(files).length === 0 && deleted.length === 0) {
    return fail("empty", "Nothing changed, so there is no pull request to open.", 400);
  }

  try {
    const pull = await openPullRequest(
      token,
      target.owner,
      target.name,
      {
        files,
        deleted,
        message: `${input.title}\n\nOpened from DevStation.`,
        branch: branchNameFor(input.title),
        base: input.base,
      },
      { title: input.title, body: input.body },
    );
    return Response.json({ ok: true, pull });
  } catch (e) {
    // GitHub's own message is the useful one, including "a branch called x
    // already exists", which tells the person exactly what to do next.
    return fail("github", e instanceof Error ? e.message : "The pull request failed.", 400);
  }
}
