import type { AgentEvent, ApprovalRequest } from "../orchestrator";
import type { SessionRecord } from "../session-store";

// Formatting lives apart from the terminal so it can be tested without one,
// and so the same renderer can back `run` (live) and `status` (replayed from
// the log). Colour is opt-out: a pipe or a dumb terminal gets plain text.

const ESC = String.fromCharCode(27);

const CODES = {
  reset: `${ESC}[0m`,
  dim: `${ESC}[2m`,
  bold: `${ESC}[1m`,
  red: `${ESC}[31m`,
  green: `${ESC}[32m`,
  yellow: `${ESC}[33m`,
  blue: `${ESC}[34m`,
  grey: `${ESC}[90m`,
  // DevStation's orange, in 256-colour. Terminals that only do 16 colours
  // render this as their nearest, which is close enough and better than
  // picking a duller colour that is exactly right nowhere.
  brand: `${ESC}[38;5;208m`,
} as const;

export function colourEnabled(env: NodeJS.ProcessEnv = process.env, tty = process.stdout.isTTY) {
  if (env.NO_COLOR) return false;
  if (env.FORCE_COLOR) return true;
  return Boolean(tty);
}

export function paint(text: string, colour: keyof typeof CODES, enabled: boolean) {
  return enabled ? `${CODES[colour]}${text}${CODES.reset}` : text;
}

const MARKS: Record<string, { mark: string; colour: keyof typeof CODES }> = {
  plan: { mark: "*", colour: "blue" },
  "step.started": { mark: ">", colour: "grey" },
  "step.completed": { mark: "+", colour: "green" },
  "step.failed": { mark: "!", colour: "red" },
  "approval.requested": { mark: "?", colour: "yellow" },
  "approval.granted": { mark: "+", colour: "green" },
  "approval.denied": { mark: "-", colour: "yellow" },
  verification: { mark: "=", colour: "blue" },
  checkpoint: { mark: "#", colour: "grey" },
  "task.completed": { mark: "+", colour: "green" },
  "task.aborted": { mark: "!", colour: "red" },
};

/** Returns null for events that should not be printed, rather than an empty
 *  string, so a caller cannot accidentally print a blank line for them. */
export function renderEvent(event: AgentEvent, colour = false): string | null {
  // Usage is tracked on every turn but only worth showing at the end; printing
  // a token count between each step buries the actual work.
  if (event.kind === "usage") return null;
  // The approval prompt itself says this, and says it better.
  if (event.kind === "approval.requested") return null;

  const style = MARKS[event.kind] ?? { mark: "-", colour: "grey" as const };
  const tool = event.tool ? paint(`${event.tool} `, "dim", colour) : "";
  return `${paint(style.mark, style.colour, colour)} ${tool}${event.message}`;
}

export function renderApproval(request: ApprovalRequest, colour = false): string {
  const lines = [
    "",
    paint(`Approval needed: ${request.operation}`, "bold", colour),
    `  tool:  ${request.tool}`,
    `  risk:  ${request.riskLevel}`,
  ];
  if (request.resources.length > 0) {
    lines.push(`  what:  ${request.resources.join(", ")}`);
  }
  lines.push(`  why:   ${request.why}`, "");
  return lines.join("\n");
}

export function renderUsage(costUsd: number, steps: number, files: string[]): string {
  const filePart = files.length === 0 ? "no files changed" : `${files.length} file(s) changed`;
  return `${steps} step(s), ${filePart}, about $${costUsd.toFixed(4)}`;
}

export function renderSessionLine(record: SessionRecord): string {
  const when = record.updatedAt.replace("T", " ").slice(0, 16);
  const name = record.title ?? record.goal;
  const goal = name.length > 56 ? `${name.slice(0, 55)}...` : name;
  return `${record.id}  ${when}  ${record.status.padEnd(8)}  ${goal}`;
}

export function renderSessions(records: SessionRecord[]): string {
  if (records.length === 0) return "No sessions yet in this workspace.";
  return records.map(renderSessionLine).join("\n");
}
