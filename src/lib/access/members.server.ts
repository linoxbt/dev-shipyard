import { dbConfigured, rpc, select, update } from "@/lib/db/admin.server";
import { isAdmin } from "@/lib/db/request.server";

// Who may use DevStation. An admin opens it (anyone can join, up to a limit
// of their choosing) or closes it (new accounts wait on a list until an admin
// lets them in). Decided at every sign-in by admit_account in the database
// (supabase/migrations/20261103150000_access_and_feedback.sql), so two
// sign-ins at once cannot both take the last place.

export interface AccessSettings {
  open: boolean;
  /** How many accounts may have access in all; null for no limit. */
  maxMembers: number | null;
  members: number;
  waiting: number;
  updatedAt: string | null;
}

export type Admission =
  | { status: "member" | "admitted" }
  | { status: "waitlisted"; place: number; held?: boolean };

/** Decide whether an account that just signed in gets in. Admins always do;
 *  without a database, and if the database cannot answer, everyone does
 *  (a hiccup should not lock people out of their work). */
export async function admit(owner: string, email: string): Promise<Admission> {
  if (isAdmin(owner) || !dbConfigured()) return { status: "member" };
  try {
    const r = await rpc<{ status: string; place?: number }>("admit_account", {
      p_owner: owner,
      p_email: email,
    });
    forgetMember(owner);
    if (r?.status === "waitlisted") return { status: "waitlisted", place: Number(r.place) || 1 };
    return { status: r?.status === "admitted" ? "admitted" : "member" };
  } catch (error) {
    console.error("admit", error);
    return { status: "member" };
  }
}

// --------------------------------------------------------------- per request

const cache = new Map<string, { member: boolean; until: number }>();
const CACHE_MS = 60_000;

export function forgetMember(owner: string): void {
  cache.delete(owner);
}

/** Whether an account (signed in earlier) still has access: one whose access
 *  an admin took away keeps its session cookie until it next signs in, so the
 *  costly actions ask. Cached for a minute. */
export async function isMember(owner: string): Promise<boolean> {
  if (isAdmin(owner) || !dbConfigured()) return true;
  const hit = cache.get(owner);
  if (hit && hit.until > Date.now()) return hit.member;
  try {
    const [row] = await select<{ owner: string }>(
      "platform_members",
      `owner=eq.${encodeURIComponent(owner)}&select=owner`,
    );
    const member = !!row;
    cache.set(owner, { member, until: Date.now() + CACHE_MS });
    return member;
  } catch {
    return true;
  }
}

export const WAITLISTED = {
  reason: "waitlisted",
  message: "You are on the DevStation waitlist. You can build as soon as an admin lets you in.",
};

// ------------------------------------------------------------------ admins

export async function accessSettings(): Promise<AccessSettings> {
  const [[s], members, waiting] = await Promise.all([
    select<{ open: boolean; max_members: number | null; updated_at: string }>(
      "platform_access",
      "select=open,max_members,updated_at&id=eq.true",
    ),
    count("platform_members", ""),
    count("waitlist", ""),
  ]);
  return {
    open: s?.open ?? true,
    maxMembers: s?.max_members ?? null,
    members,
    waiting,
    updatedAt: s?.updated_at ?? null,
  };
}

async function count(table: string, filter: string): Promise<number> {
  const url = `${String(process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/+$/, "")}/rest/v1/${table}?select=owner${filter ? `&${filter}` : ""}`;
  const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  const res = await fetch(url, {
    method: "HEAD",
    headers: {
      apikey: key,
      ...(key.startsWith("sb_secret_") ? {} : { authorization: `Bearer ${key}` }),
      prefer: "count=exact",
      range: "0-0",
    },
    signal: AbortSignal.timeout(10_000),
  });
  const total = /\/(\d+)$/.exec(res.headers.get("content-range") ?? "")?.[1];
  return total ? Number(total) : 0;
}

export async function setAccess(
  patch: { open?: boolean; maxMembers?: number | null },
  by: string,
): Promise<void> {
  await update("platform_access", "id=eq.true", {
    ...(patch.open !== undefined ? { open: patch.open } : {}),
    ...(patch.maxMembers !== undefined ? { max_members: patch.maxMembers } : {}),
    updated_at: new Date().toISOString(),
    updated_by: by,
  });
}

export interface WaitingRow {
  owner: string;
  email: string;
  joined_at: string;
  last_seen_at: string;
  held: boolean;
}

export interface MemberRow {
  owner: string;
  email: string | null;
  admitted_at: string;
  via: string;
}

export function waitlist(limit = 500): Promise<WaitingRow[]> {
  return select<WaitingRow>(
    "waitlist",
    `select=owner,email,joined_at,last_seen_at,held&order=joined_at.asc&limit=${limit}`,
  );
}

export function members(limit = 500): Promise<MemberRow[]> {
  return select<MemberRow>(
    "platform_members",
    `select=owner,email,admitted_at,via&order=admitted_at.desc&limit=${limit}`,
  );
}

/** Let these accounts in from the waitlist. */
export async function grantAccess(owners: string[], by: string): Promise<number> {
  const n = await rpc<number>("grant_access", { p_owners: owners, p_by: by });
  owners.forEach(forgetMember);
  return Number(n) || 0;
}

/** Let the first `n` in line in (held accounts are skipped). */
export async function grantNext(n: number, by: string): Promise<number> {
  const next = await select<{ owner: string }>(
    "waitlist",
    `select=owner&held=eq.false&order=joined_at.asc&limit=${Math.max(1, Math.min(n, 500))}`,
  );
  return next.length
    ? grantAccess(
        next.map((r) => r.owner),
        by,
      )
    : 0;
}

/** Take an account's access away: back on the waitlist, held there. */
export async function revokeAccess(owner: string): Promise<boolean> {
  const done = await rpc<boolean>("revoke_access", { p_owner: owner });
  forgetMember(owner);
  return !!done;
}
