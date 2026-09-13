import type { AgentEvent, ApprovalRequest } from "../orchestrator";
import type { SessionRecord } from "../session-store";
import { formatElapsed } from "./live";

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

/** The command a gated step would run, when it is one. */
export function approvalCommand(request: ApprovalRequest): string {
  const input = request.input ?? {};
  switch (request.tool) {
    case "run_shell":
      return String(input.command ?? "");
    case "git":
      return `git ${String(input.op ?? "")} ${Array.isArray(input.args) ? input.args.join(" ") : ""}`.trim();
    case "install_dependency":
      return `install ${String(input.name ?? "")}`;
    default:
      return "";
  }
}

/** A permission prompt laid out like Codex's: the question, the reason, the
 *  exact command, and numbered answers. */
export function renderApproval(request: ApprovalRequest, colour = false): string {
  const command = approvalCommand(request);
  const lines = [
    "",
    paint(
      command
        ? "  Would you like to run the following command?"
        : `  Would you like to allow ${request.operation}?`,
      "bold",
      colour,
    ),
    `  Reason: ${request.why}`,
  ];
  if (command) {
    const commandLines = command.split("\n");
    commandLines.slice(0, 8).forEach((line, i) => lines.push(`  ${i === 0 ? "$" : " "} ${line}`));
    if (commandLines.length > 8) lines.push(`    … +${commandLines.length - 8} lines`);
  } else if (request.resources.length > 0) {
    lines.push(`  What: ${request.resources.join(", ")}`);
  }
  lines.push(
    paint(`  Risk: ${request.riskLevel}`, "grey", colour),
    "",
    `${paint("›", "brand", colour)} 1. Yes, proceed ${paint("(y)", "grey", colour)}`,
    `  2. Yes, and don't ask again this session ${paint("(a)", "grey", colour)}`,
    `  3. No, skip it ${paint("(n)", "grey", colour)}`,
    "",
  );
  return lines.join("\n");
}

/** The rule under a finished turn: "─ Worked for 1m 20s · 6 steps ─". */
export function renderReceipt(
  elapsedMs: number,
  steps: number,
  files: string[],
  costUsd: number,
  colour = false,
  columns = 80,
): string {
  const parts = [`Worked for ${formatElapsed(elapsedMs)}`];
  if (steps > 0) parts.push(`${steps} step${steps === 1 ? "" : "s"}`);
  if (files.length > 0) parts.push(`${files.length} file${files.length === 1 ? "" : "s"} changed`);
  parts.push(`$${costUsd.toFixed(2)}`);
  const label = ` ${parts.join(" · ")} `;
  const width = Math.max(label.length + 2, Math.min(columns, 100));
  return paint(`─${label}${"─".repeat(width - label.length - 1)}`, "grey", colour);
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
