// Hackathon submission, built from what is verifiably on chain.
//
// There was a generator for this already, but it lived inside the deploy route
// and only covered the single contract you had just deployed, on the one screen
// you saw immediately afterwards. Come back tomorrow and it was gone.
//
// A submission is usually about a body of work rather than one transaction, so
// this takes the developer's whole registry footprint — every deployment, on
// every network, with explorer links a judge can actually open — plus the
// reputation summary derived from the same data.
//
// Deliberately not an API integration with any particular hackathon: their
// submission endpoints differ and none is known here. This produces the
// artefact a human pastes, which works for all of them.

import { deriveReputation, reputationSummary, TIER_LABEL, type DeploymentLike } from "./reputation";

export interface SubmissionEntry extends DeploymentLike {
  /** Explorer URL for the contract, ready to open. */
  explorerUrl?: string;
  verified?: boolean;
}

export interface SubmissionInput {
  projectName: string;
  developer: string;
  entries: SubmissionEntry[];
  /** Filled in by the developer; kept as prompts so nothing is invented. */
  repoUrl?: string;
  demoUrl?: string;
  description?: string;
}

function line(label: string, value: string): string {
  return `${label}: ${value}`;
}

/** A complete, paste-ready submission. */
export function generateSubmission(input: SubmissionInput): string {
  const { projectName, developer, entries } = input;
  const reputation = deriveReputation(entries);
  const verifiedCount = entries.filter((e) => e.verified).length;

  const header = [
    line("Project", projectName || "Untitled"),
    line("Developer", developer),
    line("Built with", "DevStation — the AI Developer OS for QIE and Web3"),
  ];

  const track = [
    "",
    "## Onchain footprint",
    line("Deployments", String(reputation.deployments)),
    line("Networks", reputation.networks.join(", ") || "—"),
    line("Verified contracts", `${verifiedCount} of ${entries.length}`),
    line("Developer standing", `${TIER_LABEL[reputation.tier]} — ${reputationSummary(reputation)}`),
  ];

  const contracts =
    entries.length > 0
      ? [
          "",
          "## Contracts",
          ...entries.map((e) => {
            const bits = [
              `- ${e.projectName || e.templateId || "Contract"} — \`${e.contractAddress}\``,
              e.network ? ` on ${e.network}` : "",
              e.verified ? " (verified)" : "",
            ].join("");
            return e.explorerUrl ? `${bits}\n  ${e.explorerUrl}` : bits;
          }),
        ]
      : ["", "## Contracts", "- No deployments recorded on chain yet."];

  // Left as prompts rather than blanks: a submission with "<add your repo URL>"
  // still in it is obviously unfinished, which is better than one that quietly
  // omits the field.
  const manual = [
    "",
    "## About",
    line("Repository", input.repoUrl || "<add your repo URL>"),
    line("Demo", input.demoUrl || "<add your demo URL>"),
    "",
    input.description || "<one paragraph about what you built and why>",
  ];

  return [...header, ...track, ...contracts, ...manual].join("\n") + "\n";
}

/** True when the submission still contains an unfilled prompt. */
export function isSubmissionComplete(text: string): boolean {
  return !/<add your|<one paragraph/.test(text);
}
