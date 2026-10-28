import { runnerIsolation } from "@/lib/agent-access/runner-health.server";

// What /api/health reports: whether this deployment has what production
// needs, without saying what any value is. Each check names its fix.
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

  checks.push({
    name: "session_secret",
    ok: has("SESSION_SECRET"),
    required: production,
    detail: has("SESSION_SECRET")
      ? "set"
      : "SESSION_SECRET is not set: wallet sign-ins fall back to another key or a per-process one.",
  });

  const runnerConfigured = has("RUNNER_URL") && has("RUNNER_TOKEN");
  if (runnerConfigured) {
    const isolation = await runnerIsolation(
      env.RUNNER_URL!.replace(/\/+$/, ""),
      env.RUNNER_TOKEN!,
    ).catch(() => ({ ok: false, why: "The runner could not be reached." }));
    checks.push({
      name: "runner",
      ok: isolation.ok,
      required: true,
      detail: isolation.ok ? "reachable, agent runs isolated" : isolation.why,
    });
  } else {
    checks.push({
      name: "runner",
      ok: false,
      required: false,
      detail: "RUNNER_URL / RUNNER_TOKEN not set: builds, agents and publishing are off.",
    });
  }

  const limits =
    has("UPSTASH_REDIS_REST_URL") && has("UPSTASH_REDIS_REST_TOKEN")
      ? "upstash"
      : runnerConfigured
        ? "runner"
        : "memory";
  checks.push({
    name: "shared_rate_limits",
    ok: limits !== "memory",
    required: false,
    detail:
      limits === "memory"
        ? "Rate limits are per instance: configure the runner or Upstash."
        : `shared through ${limits}`,
  });

  const ai =
    has("OPENROUTER_API_KEY") ||
    has("OPENAI_API_KEY") ||
    has("ANTHROPIC_API_KEY") ||
    has("AI_API_KEY");
  checks.push({
    name: "ai_proxy",
    ok: ai,
    required: false,
    detail: ai ? "configured" : "No server AI key: the assistant needs each user's own key.",
  });

  const labels = has("AUTOLABELER_PRIVATE_KEY");
  checks.push({
    name: "auto_labels",
    ok: labels,
    required: false,
    detail: labels
      ? "configured"
      : "No AUTOLABELER_PRIVATE_KEY: deploys get community labels, not verified ones.",
  });

  const relaxed = ["1", "true", "on"].includes(
    (env.EXPLORER_ALLOW_EXPIRED_CERT ?? "").trim().toLowerCase(),
  );
  checks.push({
    name: "explorer_tls",
    ok: !relaxed,
    required: false,
    detail: relaxed
      ? "EXPLORER_ALLOW_EXPIRED_CERT is on: explorer reads may skip certificate checks."
      : "verified",
  });

  return { ok: checks.every((c) => c.ok || !c.required), checks };
}
