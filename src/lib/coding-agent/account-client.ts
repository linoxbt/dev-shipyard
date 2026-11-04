// The browser's side of plans, launch credit, connected accounts and visit
// counting (src/routes/api.plan.ts, api.connectors.ts, api.metrics.ts).

import { fetchWithGrant } from "@/lib/agent-access/grant";

export interface Access {
  plan: "free" | "pro";
  /** Pro granted by an admin: no allowance, no charge. */
  unlimited?: boolean;
  /** How Pro was bought: "subscription" (renews), "pass" (30 days), or null. */
  billing?: "subscription" | "pass" | null;
  /** When paid Pro ends or renews. */
  proUntil?: string | null;
  /** A Stripe customer exists: the billing portal can open. */
  portal?: boolean;
  subscribed?: boolean;
  proRequested: boolean;
  /** Launch credit claimed. */
  launch?: number;
  /** All credit added: launch, top-ups, Pro's included credit. */
  claimed: number;
  spent: number;
  balance: number;
  slotsLeft: number;
  premium: boolean;
  /** The free model's cost today that was not charged, and today's allowance. */
  freeUsedToday?: number;
  freeDailyUsd?: number | null;
  available: boolean;
  admin?: boolean;
  /** The launch credit an account gets (0: none offered). */
  launchCreditUsd?: number;
  /** The limits an admin set for this account (null: no limit). */
  limits?: {
    runLimitUsd: number | null;
    dailyLimitUsd: number | null;
    runsPerDay: number | null;
    freeDailyUsd: number | null;
    paused: boolean;
  };
  /** What today used, against those limits. */
  today?: { spent: number; runs: number } | null;
}

/** What credit costs and buys (api/billing). */
export interface BillingConfig {
  markup: number;
  freeDailyUsd: number | null;
  proFreeDailyUsd: number | null;
  proPriceUsd: number;
  proIncludedUsd: number;
  topUps: number[];
  minTopUpUsd: number;
  maxTopUpUsd: number;
  providers: ("stripe" | "paystack")[];
  paystackCurrency: string;
  launchCreditUsd?: number;
  runLimitUsd?: number | null;
  dailyLimitUsd?: number | null;
  runsPerDay?: number | null;
}

export async function fetchBilling(): Promise<BillingConfig | null> {
  try {
    const res = await fetch("/api/billing", { cache: "no-store" });
    return res.ok ? ((await res.json()) as BillingConfig) : null;
  } catch {
    return null;
  }
}

/** Open a payment page (the browser leaves for the gateway on success). */
export async function startCheckout(input: {
  kind: "topup" | "pro";
  provider: "stripe" | "paystack";
  amount?: number;
}): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const r = await call<{ url: string }>("/api/billing", {
    method: "POST",
    body: JSON.stringify({ action: "checkout", ...input }),
  });
  return r.ok ? { ok: true, url: r.data.url } : r;
}

export async function openBillingPortal(): Promise<
  { ok: true; url: string } | { ok: false; message: string }
> {
  const r = await call<{ url: string }>("/api/billing", {
    method: "POST",
    body: JSON.stringify({ action: "portal" }),
  });
  return r.ok ? { ok: true, url: r.data.url } : r;
}

/** Back from paying: have it applied now (the webhook may still be on its way). */
export async function confirmPayment(
  provider: "stripe" | "paystack",
  id: string,
): Promise<{ ok: true; paid: boolean; applied: boolean } | { ok: false; message: string }> {
  const r = await call<{ paid: boolean; applied: boolean }>("/api/billing", {
    method: "POST",
    body: JSON.stringify({ action: "confirm", provider, id }),
  });
  return r.ok ? { ok: true, paid: r.data.paid, applied: r.data.applied } : r;
}

export type ConnectorId = "github" | "vercel" | "netlify" | "railway" | "supabase";

export interface Connected {
  provider: ConnectorId;
  /** The provider stopped accepting it: connect again. */
  needsReconnect?: boolean;
  label: string | null;
  connectedAt: string;
}

type Reply<T> = { ok: true; data: T } | { ok: false; message: string };

async function call<T>(path: string, init?: RequestInit): Promise<Reply<T>> {
  try {
    // Through the session helper: a missing or stale session is renewed from
    // the email sign-in and the request retried, instead of a signed-in
    // person being shown signed-out states.
    const res = await fetchWithGrant(path, {
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

/** How each provider is written. */
export const PROVIDER_NAMES: Record<ConnectorId, string> = {
  github: "GitHub",
  vercel: "Vercel",
  netlify: "Netlify",
  railway: "Railway",
  supabase: "Supabase",
};

export function providerName(id: string | null): string {
  return (id && PROVIDER_NAMES[id as ConnectorId]) || "That account";
}

/** What a failed connection's reason (in the address) means, in words. */
export function connectError(reason: string, provider: string | null): string {
  const name = providerName(provider);
  switch (reason) {
    case "denied":
      return `${name} was not connected: access was declined.`;
    case "sign_in":
      return "Sign in with your email first, then connect your accounts.";
    case "not_configured":
      return `Connecting ${name} is not set up on DevStation yet.`;
    case "bad_state":
      return "That connection link expired, was already used, or was not yours. Start again from Connected accounts.";
    case "rate_limited":
      return "Too many connection attempts. Wait a few minutes, then try again.";
    case "exchange_failed":
      return `${name} did not complete the connection. Try again; if it keeps failing, the app may need its settings checked.`;
    case "no_code":
      return `${name} sent no approval back. Try connecting again.`;
    case "save_failed":
      return `${name} approved, but the connection could not be saved. Try again in a moment.`;
    case "unknown":
      return "That is not an account DevStation can connect.";
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
