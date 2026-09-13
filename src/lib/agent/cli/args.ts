// Argument parsing kept separate from the process, so the shapes below can be
// tested without spawning anything.

export const CLI_NAME = "devstation";

/** The CLI's own version. Deliberately not the web app's package version: the
 *  two ship on different clocks and pinning them together would make one lie
 *  about the other. */
export const VERSION = "0.2.4";

export type Command =
  | "chat"
  | "run"
  | "repo"
  | "index"
  | "memory"
  | "mcp"
  | "status"
  | "sessions"
  | "resume"
  | "undo"
  | "checkpoints"
  | "diff"
  | "tools"
  | "config"
  | "login"
  | "logout"
  | "upgrade"
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
  /** Run commands in a container. On unless turned off, so the weaker mode is
   *  always something somebody chose. */
  sandbox: boolean;
  /** `config set --project` writes .devstation/config.json in the workspace
   *  instead of the global file. */
  project: boolean;
  /** `upgrade --check`: report whether a newer version exists, change nothing. */
  check: boolean;
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
  "mcp",
  "status",
  "sessions",
  "resume",
  "undo",
  "checkpoints",
  "diff",
  "tools",
  "config",
  "login",
  "logout",
  "upgrade",
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
  "login",
  "logout",
  "upgrade",
  "doctor",
  "version",
  "help",
  "index",
  "memory",
  "mcp",
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
    // DEVSTATION_SANDBOX=off is the environment equivalent of --no-sandbox,
    // for a machine where passing the flag every time is not practical.
    sandbox: (process.env.DEVSTATION_SANDBOX ?? "").toLowerCase() !== "off",
    project: false,
    check: false,
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
      case "--sandbox":
        parsed.sandbox = true;
        break;
      case "--no-sandbox":
        parsed.sandbox = false;
        break;
      case "--project":
        parsed.project = true;
        break;
      case "--check":
        parsed.check = true;
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
  ${CLI_NAME} mcp                  the MCP servers configured here, and their tools
  ${CLI_NAME} tools                list the tools it can use, and which ones ask first
  ${CLI_NAME} login [provider]     store an API key and choose a model
  ${CLI_NAME} logout [provider]    remove stored API keys
  ${CLI_NAME} upgrade [--check]    update to the latest version (--check only reports)
  ${CLI_NAME} config               show the settings a run would use, and where each came from
  ${CLI_NAME} config set <key> <value> [--project]
                               set provider, model or baseUrl
  ${CLI_NAME} config get|unset <key>, config path
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
  --json              JSON from config, sessions, checkpoints and tools
  --no-sandbox        run commands on this machine instead of in a container
  --project           with config set/unset: write this workspace's config, not the global one
  --check             with upgrade: say whether a newer version exists, change nothing
  -h, --help          this
  -v, --version       the version

The repo command also needs GITHUB_TOKEN, with permission to push to that repository.

Set up a model with \`${CLI_NAME} login\`, or export ANTHROPIC_API_KEY or OPENROUTER_API_KEY.
Settings live in ~/.devstation/config.json, keys in ~/.devstation/credentials.json.
`;

export interface SlashCommand {
  name: string;
  args?: string;
  help: string;
  aliases?: string[];
}

/** Every command a session answers. The help, Tab completion and the "did you
 *  mean" suggestion all read this one list. */
export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "new", help: "start a fresh conversation in the same workspace", aliases: ["clear"] },
  { name: "resume", args: "[id]", help: "pick up an earlier conversation" },
  { name: "rename", args: "<title>", help: "name this conversation" },
  { name: "archive", args: "[id]", help: "hide a conversation from the list" },
  { name: "delete", args: "[id]", help: "delete a conversation for good" },
  { name: "sessions", help: "list conversations in this workspace" },
  { name: "model", args: "[name]", help: "show or switch the model" },
  { name: "plan", args: "[on|off]", help: "plan mode: look and propose, change nothing" },
  {
    name: "approve",
    args: "[on|off]",
    help: "run every action without asking",
    aliases: ["approvals"],
  },
  { name: "skill", args: "[name] [task]", help: "list skills, or run one", aliases: ["skills"] },
  { name: "usage", help: "tokens and cost of this conversation", aliases: ["cost"] },
  { name: "status", help: "what this conversation has done so far" },
  { name: "diff", help: "what has changed on disk" },
  { name: "undo", help: "rewind the last checkpoint" },
  { name: "checkpoints", help: "the checkpoints it can rewind to" },
  { name: "tools", help: "the tools it can use" },
  { name: "mcp", help: "the MCP servers attached to this project" },
  { name: "memory", help: "what it has been told about this project" },
  { name: "index", help: "re-index this project for search" },
  { name: "config", help: "the settings in force" },
  { name: "doctor", help: "check this machine is set up" },
  { name: "login", args: "[provider]", help: "store an API key and choose a model" },
  { name: "logout", args: "[provider]", help: "remove stored API keys" },
  { name: "upgrade", help: "update DevStation to the latest version" },
  { name: "help", help: "this list" },
  { name: "exit", help: "leave", aliases: ["quit"] },
];

export function slashNames(): string[] {
  return SLASH_COMMANDS.flatMap((command) => [command.name, ...(command.aliases ?? [])]);
}

/** readline's completer: Tab after `/` offers the commands, and skills. */
export function completeSlash(line: string, extra: () => string[] = () => []): [string[], string] {
  if (!line.startsWith("/") || /\s/.test(line)) return [[], line];
  const names = [...new Set([...slashNames(), ...extra()])].map((name) => `/${name}`);
  return [names.filter((name) => name.startsWith(line)).sort(), line];
}

export const SESSION_HELP =
  SLASH_COMMANDS.map(
    (command) =>
      `  /${`${command.name}${command.args ? ` ${command.args}` : ""}`.padEnd(22)} ${command.help}`,
  ).join("\n") +
  "\n\n  Skills run as /<name>. Tab completes commands. Ctrl-C interrupts, Ctrl-D leaves.\n";
