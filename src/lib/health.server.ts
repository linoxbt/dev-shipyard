import { runnerIsolation } from "@/lib/agent-access/runner-health.server";
import { sandboxHostEnabled } from "@/lib/orchestrator/sandbox.server";
import { oauthConfigured } from "@/lib/db/oauth.server";

// What /api/health reports: whether this deployment has what the Coding Agent
// needs in production, without saying what any value is. Each check names its
// fix.
//
// "required" checks fail the endpoint (503) so a monitor or a deploy gate can
// stop on them; the rest are reported so an operator sees a weaker setup
// before it costs them.

export interface HealthCheck {
  name: string;
  ok: boolean;
  required: boolean;
  detail: string;
}

export interface Health {
  ok: boolean;
  checks: HealthCheck[];
}

export async function readiness(env: NodeJS.ProcessEnv = process.env): Promise<Health> {
  const production = env.NODE_ENV === "production";
  const checks: HealthCheck[] = [];
  const has = (k: string) => Boolean(env[k] && env[k]!.trim());

  // Signs sessions (and, without CONNECTOR_KEY, protects stored accounts).
  // RUNNER_TOKEN is the accepted fallback for both.
  const sessionKey = has("SESSION_SECRET") || has("RUNNER_TOKEN");
  checks.push({
    name: "session_secret",
    ok: sessionKey,
    required: production,
    detail: has("SESSION_SECRET")
      ? "set"
      : sessionKey
        ? "RUNNER_TOKEN is used: set SESSION_SECRET so the two can rotate separately."
        : "SESSION_SECRET is not set: sessions use a per-process key and break across instances.",
  });

  checks.push({
    name: "model",
    ok: has("FORTYTWO_API_KEY"),
    required: production,
    detail: has("FORTYTWO_API_KEY")
      ? "Fortytwo (Qwen, the default model) configured"
      : "FORTYTWO_API_KEY is not set: the default model cannot answer.",
  });

  const premium = has("ANTHROPIC_API_KEY") || has("OPENROUTER_API_KEY");
  checks.push({
    name: "premium_models",
    ok: premium,
    required: false,
    detail: premium
      ? "configured"
      : "No ANTHROPIC_API_KEY or OPENROUTER_API_KEY: premium models are unavailable.",
  });

  const db = has("SUPABASE_SERVICE_ROLE_KEY") && (has("SUPABASE_URL") || has("VITE_SUPABASE_URL"));
  checks.push({
    name: "database",
    ok: db,
    required: production,
    detail: db
      ? "configured"
      : "SUPABASE_SERVICE_ROLE_KEY is not set: plans, credit, connected accounts and stats are off.",
  });

  const signIn =
    (has("SUPABASE_URL") || has("VITE_SUPABASE_URL")) &&
    (has("SUPABASE_PUBLISHABLE_KEY") || has("VITE_SUPABASE_PUBLISHABLE_KEY"));
  checks.push({
    name: "sign_in",
    ok: signIn,
    required: production,
    detail: signIn
      ? "configured"
      : "The Supabase URL and publishable key are not set: nobody can sign in.",
  });

  if (sandboxHostEnabled(env)) {
    const sandbox =
      has("VERCEL_OIDC_TOKEN") ||
      (has("VERCEL_TOKEN") && has("VERCEL_TEAM_ID") && has("VERCEL_PROJECT_ID")) ||
      env.VERCEL === "1";
    checks.push({
      name: "agent_host",
      ok: sandbox,
      required: production,
      detail: sandbox
        ? "Vercel Sandbox"
        : "No access to Vercel Sandbox: turn on OIDC for the project, or set VERCEL_TOKEN, VERCEL_TEAM_ID and VERCEL_PROJECT_ID.",
    });
  } else {
    const runnerConfigured = has("RUNNER_URL") && has("RUNNER_TOKEN");
    const isolation = runnerConfigured
      ? await runnerIsolation(env.RUNNER_URL!.replace(/\/+$/, ""), env.RUNNER_TOKEN!).catch(() => ({
          ok: false,
          why: "The runner could not be reached.",
        }))
      : { ok: false, why: "AGENT_HOST=runner but RUNNER_URL / RUNNER_TOKEN are not set." };
    checks.push({
      name: "agent_host",
      ok: isolation.ok,
      required: true,
      detail: isolation.ok ? "runner reachable, agent runs isolated" : isolation.why,
    });
  }

  const limits = has("UPSTASH_REDIS_REST_URL") && has("UPSTASH_REDIS_REST_TOKEN");
  checks.push({
    name: "shared_rate_limits",
    ok: limits,
    required: false,
    detail: limits
      ? "Upstash"
      : "Rate limits are per instance: set UPSTASH_REDIS_REST_URL and _TOKEN.",
  });

  const connectors = Object.entries(oauthConfigured(env));
  const on = connectors.filter(([, ok]) => ok).map(([id]) => id);
  checks.push({
    name: "connectors",
    ok: on.length === connectors.length,
    required: false,
    detail: on.length
      ? `OAuth apps set for: ${on.join(", ")}`
      : "No OAuth apps set: Connected accounts show as coming soon.",
  });

  checks.push({
    name: "sandbox_cleanup",
    ok: has("CRON_SECRET"),
    required: false,
    detail: has("CRON_SECRET")
      ? "daily clean-up of abandoned sandboxes is on"
      : "CRON_SECRET is not set: abandoned sandboxes are never deleted.",
  });

  return { ok: checks.every((c) => c.ok || !c.required), checks };
}
