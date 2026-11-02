import { promises as dns } from "node:dns";
import { customDomainsEnabled } from "./sites.server";

// Whether a published site can actually be opened at its address: the name
// resolves, it resolves to the host DevStation runs on, the address answers
// over HTTPS with a valid certificate, and what answers is this site's latest
// deploy (serve.server.ts names both in its response headers). Publishing
// only uploads the files; this is what tells the person their link works,
// and if it does not, which of those steps is missing.

export type ReachStage = "dns" | "elsewhere" | "tls" | "http" | "stale" | "live";

export interface Reach {
  host: string;
  ok: boolean;
  stage: ReachStage;
  message: string;
  /** Where the name points, when it was looked up. */
  points?: string[];
  status?: number;
  checkedAt: string;
}

export interface ReachDeps {
  resolveCname: (host: string) => Promise<string[]>;
  resolve4: (host: string) => Promise<string[]>;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}

const defaults: ReachDeps = {
  resolveCname: (h) => dns.resolveCname(h),
  resolve4: (h) => dns.resolve4(h),
  fetch: (url, init) => fetch(url, init),
};

/** Addresses of the host DevStation runs on (Vercel's edge). */
const HOST_IPS = [
  /^76\.76\.21\./,
  /^216\.198\.79\./,
  /^64\.29\.17\./,
  /^66\.33\.60\./,
  /^216\.150\.(1|16)\./,
];
const HOST_NAMES = /(^|\.)vercel-dns(-\d+)?\.com\.?$/i;

export const pointsAtHost = (points: string[]): boolean =>
  points.some((p) => HOST_NAMES.test(p) || HOST_IPS.some((re) => re.test(p)));

const TLS_CODES = /CERT|TLS|SSL|EPROTO|SELF_SIGNED|ALTNAME|UNABLE_TO_VERIFY|ERR_SSL/i;

function codeOf(error: unknown): string {
  let e = error as { code?: string; cause?: unknown; message?: string } | undefined;
  for (let i = 0; e && i < 4; i++) {
    if (e.code) return e.code;
    e = e.cause as typeof e;
  }
  return String((error as Error)?.message ?? "");
}

async function lookup(host: string, deps: ReachDeps): Promise<string[] | null> {
  const [cname, a] = await Promise.all([
    deps.resolveCname(host).catch(() => [] as string[]),
    deps.resolve4(host).catch(() => [] as string[]),
  ]);
  const points = [...cname, ...a];
  return points.length ? points : null;
}

/**
 * Check one address. `expect` is the site's slug and the deploy it should be
 * serving; `custom` marks a domain of the person's own (its DNS is theirs to
 * set, where a devstation.online address's is DevStation's).
 */
export async function checkReach(
  host: string,
  expect: { slug: string; deploy: string | null },
  opts: { custom?: boolean; deps?: Partial<ReachDeps> } = {},
): Promise<Reach> {
  const deps = { ...defaults, ...opts.deps };
  const at = new Date().toISOString();
  const base = { host, checkedAt: at };
  const ours = opts.custom ? "your domain's DNS" : "DevStation's DNS";

  const points = await lookup(host, deps);
  if (!points) {
    return {
      ...base,
      ok: false,
      stage: "dns",
      message: opts.custom
        ? `${host} does not resolve yet. Add the DNS record shown below at your domain's registrar; it can take a few minutes to an hour to spread.`
        : `${host} does not resolve yet. This is on DevStation's side: its DNS has no record for the address.`,
    };
  }

  let res: Response;
  try {
    res = await deps.fetch(`https://${host}/`, {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": "DevStation reachability check" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const code = codeOf(error);
    if (!pointsAtHost(points)) {
      return {
        ...base,
        ok: false,
        stage: "elsewhere",
        points,
        message: `${host} points at ${points.join(", ")}, not at DevStation, so it cannot open your app. ${
          opts.custom
            ? "Change the DNS record at your registrar to the one shown below."
            : "This is on DevStation's side: the address's DNS record needs to point here."
        }`,
      };
    }
    if (TLS_CODES.test(code)) {
      return {
        ...base,
        ok: false,
        stage: "tls",
        points,
        message:
          !opts.custom && !customDomainsEnabled()
            ? `${host} reaches DevStation but has no HTTPS certificate, and DevStation cannot issue one for new addresses yet. This is on DevStation's side.`
            : `${host} reaches DevStation, but its HTTPS certificate is not ready yet. New addresses usually get one within a few minutes.`,
      };
    }
    return {
      ...base,
      ok: false,
      stage: "http",
      points,
      message: `${host} did not answer (${code || "no response"}). Try the check again in a minute.`,
    };
  }
  void res.body?.cancel().catch(() => undefined);

  const site = res.headers.get("x-devstation-site");
  const deploy = res.headers.get("x-devstation-deploy");
  if (site !== expect.slug) {
    if (!pointsAtHost(points)) {
      return {
        ...base,
        ok: false,
        stage: "elsewhere",
        points,
        status: res.status,
        message: `${host} answers, but from another server (${points.join(", ")}), not DevStation. Point ${ours} record at DevStation${opts.custom ? " as shown below" : ""}.`,
      };
    }
    return {
      ...base,
      ok: false,
      stage: "http",
      points,
      status: res.status,
      message: `${host} reaches DevStation, but DevStation does not serve this app there yet (it answered ${res.status}). Check again in a minute.`,
    };
  }
  if (expect.deploy && deploy !== expect.deploy) {
    return {
      ...base,
      ok: false,
      stage: "stale",
      points,
      status: res.status,
      message: `${host} still shows the version before this one. The new one takes up to a minute to replace it everywhere.`,
    };
  }
  if (res.status !== 200) {
    return {
      ...base,
      ok: false,
      stage: "http",
      points,
      status: res.status,
      message: `${host} answered ${res.status} instead of your app's page.`,
    };
  }
  return { ...base, ok: true, stage: "live", points, status: 200, message: `${host} is live.` };
}

/** Check until it is live or `tries` run out, `gapMs` apart: a new deploy
 *  takes a moment to replace the one cached before it. A missing record or
 *  the wrong server does not fix itself in seconds, so those end it early. */
export async function waitForReach(
  host: string,
  expect: { slug: string; deploy: string | null },
  opts: { custom?: boolean; tries?: number; gapMs?: number; deps?: Partial<ReachDeps> } = {},
): Promise<Reach> {
  const tries = opts.tries ?? 3;
  let last = await checkReach(host, expect, opts);
  for (let i = 1; i < tries && !last.ok && (last.stage === "stale" || last.stage === "http"); i++) {
    await new Promise((r) => setTimeout(r, opts.gapMs ?? 4000));
    last = await checkReach(host, expect, opts);
  }
  return last;
}
