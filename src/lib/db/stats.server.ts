import { createHash, createHmac, randomBytes } from "node:crypto";
import { insertReturning, rpc, select, selectAll, update } from "./admin.server";
import { openToken, sealToken } from "./connectors.server";
import { billingConfig } from "@/lib/billing/config.server";

// DevStation's figures, read for the admins (routes/api.admin.stats.ts) and
// for whoever holds a share link (routes/api.stats.shared.ts): the dashboard
// for a period, and the three downloads. A shared copy never names an
// account: each one is a stable pseudonym instead.

type Row = Record<string, unknown>;

export function csv(rows: Row[], columns: string[]): string {
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? "" : String(v);
    // A cell a spreadsheet would run as a formula is kept as text.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join(
    "\n",
  );
}

/** A stable stand-in for an account in published figures. The account id is
 *  an unkeyed hash of an email, so anyone could hash an address and find that
 *  person's rows; this is keyed with the server's secret. */
export function pseudonym(owner: unknown): string {
  const key = process.env.SESSION_SECRET || process.env.RUNNER_TOKEN || "devstation";
  return `acct_${createHmac("sha256", key).update(String(owner)).digest("hex").slice(0, 12)}`;
}

/** The first day of the last 90. */
export function since90(now = new Date()): string {
  return new Date(now.getTime() - 89 * 24 * 60 * 60_000).toISOString().slice(0, 10);
}

function download(name: string, body: string, type: string): Response {
  return new Response(body, {
    headers: {
      "content-type": `${type}; charset=utf-8`,
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}

const TURN_COLUMNS = [
  "created_at",
  "account",
  "workspace",
  "turn",
  "model",
  "mode",
  "phase",
  "steps",
  "cost_usd",
  "files_changed",
  "premium",
];

export const DOWNLOADS = ["turns.csv", "daily.csv", "summary.json"] as const;
export type Download = (typeof DOWNLOADS)[number];

/** One of the downloads. Accounts are pseudonymised in every one of them. */
export async function statsDownload(what: Download): Promise<Response> {
  if (what === "turns.csv") {
    const rows = await selectAll<Row>(
      "agent_turns",
      `select=${TURN_COLUMNS.map((c) => (c === "account" ? "owner" : c)).join(",")}&order=created_at.asc,id.asc`,
    );
    const published = rows.map(({ owner: who, ...rest }) => ({ account: pseudonym(who), ...rest }));
    return download("devstation-turns.csv", csv(published, TURN_COLUMNS), "text/csv");
  }
  if (what === "daily.csv") {
    const rows = await selectAll<Row>(
      "site_daily",
      "select=day,metric,count&order=day.asc,metric.asc",
    );
    return download("devstation-daily.csv", csv(rows, ["day", "metric", "count"]), "text/csv");
  }
  const [summary, daily] = await Promise.all([
    rpc<Row>("devstation_stats"),
    selectAll<Row>("site_daily", `select=day,metric,count&day=gte.${since90()}&order=day.desc`),
  ]);
  return download(
    "devstation-stats.json",
    JSON.stringify({ summary, daily }, null, 2),
    "application/json",
  );
}

export function rangeDays(raw: string | null): 7 | 30 | 90 {
  const n = Number(raw);
  return n === 7 || n === 90 ? n : 30;
}

interface AccountRow {
  account: string;
  owner: string;
  [key: string]: unknown;
}

/**
 * The dashboard for the last `days` days (devstation_dashboard). `shared`
 * replaces every email and account id with its pseudonym.
 */
export async function statsDashboard(days: number, shared: boolean): Promise<Row> {
  const raw = await rpc<Row>("devstation_dashboard", { p_days: days });
  // The price recurring revenue is counted at.
  const d: Row = { ...raw, pro_price_usd: billingConfig().proPriceUsd };
  if (!shared) return d;
  const hide = (rows: unknown) =>
    (Array.isArray(rows) ? (rows as AccountRow[]) : []).map((r) => {
      const name = pseudonym(r.owner);
      return { ...r, account: name, owner: name };
    });
  return { ...d, top_accounts: hide(d.top_accounts), recent_accounts: hide(d.recent_accounts) };
}

// ------------------------------------------------------------- share links

export interface ShareRow {
  id: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
  last_viewed_at: string | null;
  views: number;
  token_sealed?: string;
}

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");
const TOKEN = /^[A-Za-z0-9_-]{16,80}$/;

/** A new link's secret: 32 random bytes, URL-safe. */
export function newShareToken(): string {
  return randomBytes(32).toString("base64url");
}

export async function createShare(
  createdBy: string,
  label: string,
): Promise<{ id: string; token: string }> {
  const token = newShareToken();
  const row = await insertReturning<{ id: string }>("stats_shares", {
    token_hash: hashOf(token),
    token_sealed: sealToken(token),
    label: label.slice(0, 80),
    created_by: createdBy,
  });
  if (!row) throw new Error("The link could not be saved.");
  return { id: row.id, token };
}

/** Every link, newest first, each with its secret when it can be opened (so
 *  the admin can copy it again). A revoked link's secret is not returned. */
export async function listShares(): Promise<(ShareRow & { token: string | null })[]> {
  const rows = await select<ShareRow>(
    "stats_shares",
    "select=id,label,created_at,revoked_at,last_viewed_at,views,token_sealed&order=created_at.desc&limit=200",
  );
  return rows.map(({ token_sealed, ...r }) => ({
    ...r,
    token: !r.revoked_at && token_sealed ? openToken(token_sealed) : null,
  }));
}

export async function revokeShare(id: string): Promise<boolean> {
  const rows = await update("stats_shares", `id=eq.${encodeURIComponent(id)}&revoked_at=is.null`, {
    revoked_at: new Date().toISOString(),
  });
  return rows.length > 0;
}

/** The link a token opens, if it exists and has not been revoked. */
export async function openShare(token: string | null): Promise<ShareRow | null> {
  if (!token || !TOKEN.test(token)) return null;
  const [row] = await select<ShareRow & { views: number }>(
    "stats_shares",
    `select=id,label,created_at,revoked_at,last_viewed_at,views&token_hash=eq.${hashOf(token)}&revoked_at=is.null`,
  );
  return row ?? null;
}

/** Count a view (best effort: a view is never refused over it). */
export async function countView(share: ShareRow): Promise<void> {
  await update("stats_shares", `id=eq.${encodeURIComponent(share.id)}`, {
    views: (share.views ?? 0) + 1,
    last_viewed_at: new Date().toISOString(),
  }).catch(() => undefined);
}
