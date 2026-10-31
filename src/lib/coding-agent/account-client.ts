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

export interface ConnectorState {
  available: boolean;
  /** Which providers the site has an OAuth app for. */
  configured: Partial<Record<ConnectorId, boolean>>;
  connected: Connected[];
}

export async function fetchConnectors(): Promise<ConnectorState> {
  const r = await call<ConnectorState>("/api/connectors");
  return r.ok
    ? { ...r.data, configured: r.data.configured ?? {} }
    : { available: false, configured: {}, connected: [] };
}

/** Go to the provider to approve access; it sends the person back here. */
export function connect(provider: ConnectorId) {
  const back = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/api/oauth/${provider}?back=${encodeURIComponent(back)}`);
}

/** What a failed connection's reason (in the address) means, in words. */
export function connectError(reason: string, provider: string | null): string {
  const name = provider ? provider[0].toUpperCase() + provider.slice(1) : "That account";
  switch (reason) {
    case "denied":
      return `${name} was not connected: access was declined.`;
    case "sign_in":
      return "Sign in with your email first, then connect your accounts.";
    case "not_configured":
      return `Connecting ${name} is not set up on DevStation yet.`;
    case "bad_state":
      return "That connection link expired or was not yours. Start again from Connected accounts.";
    case "rejected":
      return `${name} did not accept the connection. Try again.`;
    default:
      return `${name} could not be connected. Try again in a moment.`;
  }
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
