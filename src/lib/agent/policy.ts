import type { ProtectedAction, RiskLevel } from "./authorization";

// What the platform will let the agent do on its own.
//
// This is the layer that decides, not the model. The agent proposes an action;
// this classifies its risk and says whether it may proceed. A model cannot
// argue its way past it, because it never gets asked: the answer comes from
// the operation name and the resources, not from anything the model wrote.
//
// The bar for interrupting someone is deliberately high. Ordinary development
//, writing a component, restyling, running tests, fixing an error, is safe
// and must never prompt. Interruptions are reserved for actions that lose data,
// spend money, change who can get in, or reach production.

export type Verdict =
  | { decision: "allow" }
  | { decision: "confirm"; riskLevel: Exclude<RiskLevel, "low">; why: string };

/** Operation prefixes that are ordinary development work. */
const SAFE = [
  "file.read",
  "file.write",
  "file.create",
  "project.inspect",
  "component.create",
  "component.edit",
  "style.edit",
  "route.create",
  "test.run",
  "build.dev",
  "dependency.audit",
  "code.refactor",
  "code.analyze",
];

/** Operations that need a person, with the reason stated in their terms. */
const GATED: Array<{ prefix: string; risk: Exclude<RiskLevel, "low">; why: string }> = [
  {
    prefix: "file.delete",
    risk: "high",
    why: "Deleting files removes work that may be referenced elsewhere in the project.",
  },
  {
    prefix: "project.delete",
    risk: "critical",
    why: "This permanently removes the entire project and everything in it.",
  },
  {
    prefix: "dependency.install",
    risk: "medium",
    why: "Installing a package runs its code during install and adds it to the build.",
  },
  {
    prefix: "config.write",
    risk: "medium",
    why: "Configuration changes affect how the whole application runs.",
  },
  {
    prefix: "auth.modify",
    risk: "high",
    why: "Changing authentication affects who can get into the application.",
  },
  {
    prefix: "secret.read",
    risk: "critical",
    why: "This reads stored credentials, which are meant to stay in the secret store and never enter a reply.",
  },
  {
    prefix: "secret.write",
    risk: "high",
    why: "This stores a credential the application will use.",
  },
  {
    prefix: "database.migration",
    risk: "high",
    why: "A migration can alter or drop columns, and existing rows cannot always be recovered.",
  },
  { prefix: "database.delete", risk: "critical", why: "This permanently destroys stored records." },
  {
    prefix: "database.drop",
    risk: "critical",
    why: "This permanently destroys a table and everything in it.",
  },
  {
    prefix: "database.truncate",
    risk: "critical",
    why: "This empties the table permanently, and the removed rows cannot be recovered from the application.",
  },
  {
    prefix: "payment.configure",
    risk: "high",
    why: "Payment configuration decides where real money goes.",
  },
  {
    prefix: "funds.transfer",
    risk: "critical",
    why: "This moves real funds out of the connected account, and a completed transfer cannot be reversed.",
  },
  {
    prefix: "deploy.publish",
    risk: "high",
    why: "This publishes the build to a live URL where people will reach it.",
  },
  {
    prefix: "vcs.repo.create",
    risk: "medium",
    why: "This creates a repository in your GitHub account.",
  },
  {
    prefix: "vcs.push",
    risk: "high",
    why: "This puts the code in a repository under your account, where it can be seen and cloned by anyone who can reach it.",
  },
  { prefix: "shell.exec", risk: "critical", why: "This runs an arbitrary command on the host." },
];

/** Environment can raise the stakes even for an otherwise routine action. */
function escalateForProduction(risk: Exclude<RiskLevel, "low">): Exclude<RiskLevel, "low"> {
  return risk === "medium" ? "high" : risk === "high" ? "critical" : risk;
}

export interface PolicyOptions {
  /** How much the user has asked to be consulted. Cannot lower a critical
   *  action below confirmation: that floor belongs to the platform. */
  autonomy?: "ask_sensitive" | "ask_integrations" | "ask_deploy" | "autonomous";
}

export function evaluate(action: ProtectedAction, opts: PolicyOptions = {}): Verdict {
  const op = action.operation;
  const gate = GATED.find((g) => op === g.prefix || op.startsWith(`${g.prefix}.`));

  if (!gate) {
    const safe = SAFE.some((s) => op === s || op.startsWith(`${s}.`));
    // Unknown operations are NOT assumed safe. A new tool has to be classified
    // before it can run unattended.
    if (safe) return { decision: "allow" };
    return {
      decision: "confirm",
      riskLevel: "medium",
      why: `"${op}" is not a recognised safe operation, so it needs your approval.`,
    };
  }

  let risk = gate.risk;
  if (action.environment === "production") risk = escalateForProduction(risk);

  // Autonomy can widen what proceeds unattended, but never below the floor:
  // anything critical always asks, whatever the setting says.
  if (opts.autonomy === "autonomous" && risk !== "critical") {
    return { decision: "allow" };
  }
  if (opts.autonomy === "ask_deploy" && risk !== "critical" && !op.startsWith("deploy.")) {
    return { decision: "allow" };
  }
  return { decision: "confirm", riskLevel: risk, why: gate.why };
}

/** True when this action may never proceed without a person, whatever the
 *  autonomy setting. */
export function alwaysRequiresPerson(action: ProtectedAction): boolean {
  const v = evaluate(action, { autonomy: "autonomous" });
  return v.decision === "confirm";
}
