// Argument parsing kept separate from the process, so the shapes below can be
// tested without spawning anything.

export type Command = "run" | "status" | "sessions" | "undo" | "resume" | "help";

export interface ParsedArgs {
  command: Command;
  /** Free text: the goal for `run` and `resume`, the id for `status`. */
  rest: string;
  id?: string;
  follow: boolean;
  yes: boolean;
  root: string;
  autonomy?: "ask_sensitive" | "ask_integrations" | "ask_deploy" | "autonomous";
  maxSteps?: number;
  maxCostUsd?: number;
  error?: string;
}

const COMMANDS = new Set<Command>(["run", "status", "sessions", "undo", "resume", "help"]);

export function parseArgs(argv: string[], cwd = process.cwd()): ParsedArgs {
  const parsed: ParsedArgs = {
    command: "help",
    rest: "",
    follow: false,
    yes: false,
    root: cwd,
  };

  const words: string[] = [];
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    const next = () => argv[++index];
    switch (argument) {
      case "-f":
      case "--follow":
        parsed.follow = true;
        break;
      case "-y":
      case "--yes":
        parsed.yes = true;
        break;
      case "--root":
        parsed.root = next() ?? cwd;
        break;
      case "--autonomy": {
        const value = next();
        if (
          value === "ask_sensitive" ||
          value === "ask_integrations" ||
          value === "ask_deploy" ||
          value === "autonomous"
        ) {
          parsed.autonomy = value;
        } else {
          parsed.error = `Unknown autonomy "${value}".`;
        }
        break;
      }
      case "--max-steps": {
        const value = Number(next());
        if (Number.isFinite(value) && value > 0) parsed.maxSteps = value;
        else parsed.error = "--max-steps needs a positive number.";
        break;
      }
      case "--budget": {
        const value = Number(next());
        if (Number.isFinite(value) && value > 0) parsed.maxCostUsd = value;
        else parsed.error = "--budget needs a positive number of dollars.";
        break;
      }
      case "--session":
        parsed.id = next();
        break;
      default:
        if (argument.startsWith("-")) parsed.error = `Unknown option "${argument}".`;
        else words.push(argument);
    }
  }

  const first = words[0] as Command | undefined;
  if (first && COMMANDS.has(first)) {
    parsed.command = first;
    words.shift();
  } else if (words.length > 0) {
    // `agent "fix the failing test"` should work without typing `run`.
    parsed.command = "run";
  }

  parsed.rest = words.join(" ");
  // `status <id>` and `resume <id> <instruction>` both take the id first.
  if ((parsed.command === "status" || parsed.command === "resume") && !parsed.id && words[0]) {
    // An id is eight hex characters; anything else is an instruction.
    if (/^[0-9a-f]{8}$/.test(words[0])) {
      parsed.id = words.shift();
      parsed.rest = words.join(" ");
    }
  }

  return parsed;
}

export const HELP = `coding agent

  agent run <goal>            work on a goal in this directory
  agent status [id] [-f]      show what a run is doing (-f to follow)
  agent sessions              list runs in this workspace
  agent resume [id] [note]    carry on from a stopped or crashed run
  agent undo                  undo the last agent checkpoint commit

Options
  --root <dir>        work somewhere other than the current directory
  --autonomy <mode>   ask_sensitive (default), ask_integrations, ask_deploy, autonomous
  --max-steps <n>     stop after n tool calls
  --budget <dollars>  stop before a turn that would exceed this
  -y, --yes           approve every gated action without asking
  -f, --follow        keep watching (status only)

Set ANTHROPIC_API_KEY, or OPENROUTER_API_KEY, before running.
`;
