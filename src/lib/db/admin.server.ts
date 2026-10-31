// DevStation's own database (Supabase), reached only from this server with
// the service role key. Plans, launch credits, every agent turn, daily site
// figures and connected accounts live there (supabase/migrations/), behind
// row level security with no policies: the public key cannot touch them.
//
// SUPABASE_SERVICE_ROLE_KEY is set on the Vercel project. Without it these
// helpers answer "not configured" and the features that need them say so.

const url = () =>
  String(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
const key = () => String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

export function dbConfigured(): boolean {
  return Boolean(url() && key());
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const k = key();
  return {
    apikey: k,
    // A legacy service_role key is a JWT and goes in Authorization as well;
    // a new sb_secret_ key is sent as the apikey alone.
    ...(k.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${k}` }),
    "content-type": "application/json",
    ...extra,
  };
}

export class DbError extends Error {}

async function call(path: string, init: RequestInit = {}): Promise<unknown> {
  if (!dbConfigured()) throw new DbError("The database is not configured.");
  const res = await fetch(`${url()}/rest/v1/${path}`, {
    ...init,
    headers: headers((init.headers as Record<string, string>) ?? {}),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await res.text();
  if (!res.ok) throw new DbError(`Database ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

/** Call a database function. */
export function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  return call(`rpc/${name}`, { method: "POST", body: JSON.stringify(args) }) as Promise<T>;
}

/** Insert rows; with `ignoreDuplicates`, a row whose key exists is skipped. */
export async function insert(
  table: string,
  rows: Record<string, unknown> | Record<string, unknown>[],
  opts: { ignoreDuplicates?: boolean; upsertOn?: string } = {},
): Promise<void> {
  const prefer = opts.upsertOn
    ? "resolution=merge-duplicates,return=minimal"
    : opts.ignoreDuplicates
      ? "resolution=ignore-duplicates,return=minimal"
      : "return=minimal";
  const on = opts.upsertOn ? `?on_conflict=${encodeURIComponent(opts.upsertOn)}` : "";
  await call(`${table}${on}`, {
    method: "POST",
    headers: { prefer },
    body: JSON.stringify(rows),
  });
}

/** Read rows with a PostgREST query string, e.g. "owner=eq.0x…&select=*". */
export function select<T>(table: string, query = "select=*"): Promise<T[]> {
  return call(`${table}?${query}`) as Promise<T[]>;
}

export async function remove(table: string, query: string): Promise<void> {
  await call(`${table}?${query}`, { method: "DELETE", headers: { prefer: "return=minimal" } });
}

/** Count something on today's line of the site figures. Never throws. */
export async function bumpMetric(metric: string, by = 1): Promise<void> {
  if (!dbConfigured()) return;
  try {
    await rpc("bump_metric", { p_metric: metric, p_by: by });
  } catch {
    // Figures are best effort; a request never fails because of them.
  }
}
