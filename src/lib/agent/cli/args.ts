// Argument parsing kept separate from the process, so the shapes below can be
// tested without spawning anything.

export const CLI_NAME = "devstation";

/** The CLI's own version. Deliberately not the web app's package version: the
 *  two ship on different clocks and pinning them together would make one lie
 *  about the other. */
export const VERSION = "0.1.0";

export type Command =
  | "chat"
  | "run"
  | "repo"
  | "index"
  | "memory"
  | "status"
  | "sessions"
  | "resume"
  | "undo"
  | "checkpoints"
  | "diff"
  | "tools"
  | "config"
  | "doctor"
  | "version"
  | "help";

export interface ParsedArgs {
  command: Command;
  /** Free text: the goal for `run` and `resume`, the id for `status`. */
  rest: string;
  id?: string;
  follow: boolean;
  yes: boolean;
  json: boolean;
  root: string;
  autonomy?: "ask_sensitive" | "ask_integrations" | "ask_deploy" | "autonomous";
  model?: string;
  maxSteps?: number;
  maxCostUsd?: number;
  error?: string;
}

/** Every command the parser accepts. Exported so the help text can be checked
 *  against it rather than against a second list that can drift. */
export const COMMANDS = new Set<Command>([
  "chat",
  "run",
  "repo",
  "index",
  "memory",
  "status",
  "sessions",
  "resume",
  "undo",
  "checkpoints",
  "diff",
  "tools",
  "config",
  "doctor",
  "version",
  "help",
]);

/** Commands that never reach a model, so they run without a key configured. */
export const OFFLINE_COMMANDS = new Set<Command>([
  "status",
  "sessions",
  "undo",
  "checkpoints",
  "diff",
  "tools",
  "config",
  "doctor",
  "version",
  "help",
  "index",
  "memory",
]);

export function parseArgs(argv: string[], cwd = process.cwd()): ParsedArgs {
  const parsed: ParsedArgs = {
    // No arguments starts a conversation, the way the coding agents people
    // already use behave. `run` stays for one-shot and scripted use.
    command: "chat",
    rest: "",
    follow: false,
    yes: false,
    json: false,
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
      case "--json":
        parsed.json = true;
        break;
      case "-h":
      case "--help":
        parsed.command = "help";
        break;
      case "-v":
      case "--version":
        parsed.command = "version";
        break;
      case "-C":
      case "--root":
        parsed.root = next() ?? cwd;
        break;
      case "--model":
        parsed.model = next();
        if (!parsed.model) parsed.error = "--model needs a model name.";
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

  // An explicit --help or --version wins over whatever else was typed.
  if (parsed.command === "help" || parsed.command === "version") {
    parsed.rest = words.join(" ");
    return parsed;
  }

  const first = words[0] as Command | undefined;
  if (first && COMMANDS.has(first)) {
    parsed.command = first;
    words.shift();
  } else if (words.length > 0) {
    // `devstation "fix the failing test"` should work without typing `run`.
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

export const HELP = `DevStation, the coding agent.

  ${CLI_NAME}                      start a session and talk to it
  ${CLI_NAME} run <goal>           do one thing and stop
  ${CLI_NAME} repo <owner/name> <goal>
                               work on a GitHub repository and propose a pull request
  ${CLI_NAME} resume [id] [note]   carry on from a stopped or crashed run
  ${CLI_NAME} status [id] [-f]     show what a run is doing (-f to follow)
  ${CLI_NAME} sessions             list runs in this workspace
  ${CLI_NAME} undo                 rewind the last agent checkpoint
  ${CLI_NAME} checkpoints          list the checkpoints it can rewind to
  ${CLI_NAME} diff                 show what the agent has changed
  ${CLI_NAME} index                index this project so the agent can search it
  ${CLI_NAME} memory               show what it has been told about this project
  ${CLI_NAME} tools                list the tools it can use, and which ones ask first
  ${CLI_NAME} config               show the settings this run would use
  ${CLI_NAME} doctor               check this machine is set up to run it
  ${CLI_NAME} version              print the version
  ${CLI_NAME} help                 this

In a session, type /help for the commands available there.

Options
  -C, --root <dir>    work somewhere other than the current directory
  --model <name>      override the model for this run
  --autonomy <mode>   ask_sensitive (default), ask_integrations, ask_deploy, autonomous
  --max-steps <n>     stop after n tool calls
  --budget <dollars>  stop before a turn that would exceed this
  -y, --yes           approve every gated action without asking
  -f, --follow        keep watching (status only)
  --json              machine-readable output where it makes sense
  -h, --help          this
  -v, --version       the version

The repo command also needs GITHUB_TOKEN, with permission to push to that repository.

Set ANTHROPIC_API_KEY, or OPENROUTER_API_KEY, before running.
`;

export const SESSION_HELP = `  /undo          rewind the last checkpoint
  /status        what this session has done so far
  /sessions      list runs in this workspace
  /checkpoints   the checkpoints it can rewind to
  /diff          what has changed on disk
  /tools         the tools it can use
  /memory        what it has been told about this project
  /cost          what this session has spent
  /config        the settings in force
  /clear         start a fresh transcript, keeping the same workspace
  /help          this
  /exit          leave
`;
