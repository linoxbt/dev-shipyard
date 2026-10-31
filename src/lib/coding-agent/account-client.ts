// The browser's side of plans, launch credit, connected accounts and visit
// counting (src/routes/api.plan.ts, api.connectors.ts, api.metrics.ts).

export interface Access {
  plan: "free" | "pro";
  proRequested: boolean;
  claimed: number;
  spent: number;
  balance: number;
  slotsLeft: number;
  premium: boolean;
  available: boolean;
  admin?: boolean;
}

export type ConnectorId = "github" | "vercel" | "netlify" | "railway" | "supabase";

export interface Connected {
  provider: ConnectorId;
  label: string | null;
  connectedAt: string;
}

type Reply<T> = { ok: true; data: T } | { ok: false; message: string };

async function call<T>(path: string, init?: RequestInit): Promise<Reply<T>> {
  try {
    const res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    const body = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) return { ok: false, message: body.message || "That did not work." };
    return { ok: true, data: body };
  } catch {
    return { ok: false, message: "DevStation could not be reached." };
  }
}

export async function fetchAccess(): Promise<Access | null> {
  const r = await call<{ access: Access; admin?: boolean }>("/api/plan");
  return r.ok ? { ...r.data.access, admin: r.data.admin } : null;
}

export async function changePlan(action: "claim" | "request_pro"): Promise<Reply<Access>> {
  const r = await call<{ access: Access }>("/api/plan", {
    method: "POST",
    body: JSON.stringify({ action }),
  });
  return r.ok ? { ok: true, data: r.data.access } : r;
}

export async function fetchConnectors(): Promise<{ available: boolean; connected: Connected[] }> {
  const r = await call<{ available: boolean; connected: Connected[] }>("/api/connectors");
  return r.ok ? r.data : { available: false, connected: [] };
}

export function connect(provider: ConnectorId, token: string) {
  return call<{ label: string }>("/api/connectors", {
    method: "POST",
    body: JSON.stringify({ provider, token }),
  });
}

export function disconnect(provider: ConnectorId) {
  return call<{ ok: true }>("/api/connectors", {
    method: "DELETE",
    body: JSON.stringify({ provider }),
  });
}

/** Count this visit once per browser session. */
export function countVisit(): void {
  try {
    if (sessionStorage.getItem("devstation-visit")) return;
    sessionStorage.setItem("devstation-visit", "1");
  } catch {
    // No session storage: count it anyway, once per page load.
  }
  void fetch("/api/metrics", { method: "POST" }).catch(() => undefined);
}
