#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { CLI_NAME, HELP, OFFLINE_COMMANDS, VERSION, parseArgs, type ParsedArgs } from "./args";
import {
  checkpointsCommand,
  configCommand,
  diffCommand,
  doctorCommand,
  resumeCommand,
  runCommand,
  sessionsCommand,
  statusCommand,
  toolsCommand,
  undoCommand,
  type CommandContext,
  type Terminal,
} from "./commands";
import { chatCommand } from "./interactive";
import { colourEnabled } from "./render";
import { lineReader } from "./line-reader";
import { configuredProviderName, providerFromEnv } from "../providers";

// The terminal front end. Everything below the parsing and the readline lives
// in commands.ts and interactive.ts, which is what makes this a thin third
// consumer of the same core the web app and the runner use rather than a
// second implementation.

export async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);

  if (parsed.error) {
    process.stderr.write(`${parsed.error}\n\n${HELP}`);
    return 2;
  }
  if (parsed.command === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (parsed.command === "version") {
    process.stdout.write(`${CLI_NAME} ${VERSION}\n`);
    return 0;
  }

  const root = resolve(parsed.root);
  if (!existsSync(root)) {
    process.stderr.write(`There is no directory at ${root}.\n`);
    return 2;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const input = lineReader(readline, (text) => process.stdout.write(text));
  const terminal: Terminal = {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    ask: (question) => input.ask(question),
    colour: colourEnabled(),
  };

  // Ctrl-C stops the run rather than killing the process outright, so the
  // session is saved and the summary still prints.
  const controller = new AbortController();
  const interrupt = () => {
    terminal.err(`\nStopping. The session is saved; resume it with \`${CLI_NAME} resume\`.`);
    controller.abort();
  };
  process.on("SIGINT", interrupt);

  try {
    // The read-only commands never reach a model, so they work on a machine
    // with nothing configured. That is exactly when `doctor` is needed.
    const offline = context(root, terminal, parsed, null);
    switch (parsed.command) {
      case "sessions":
        return sessionsCommand(offline);
      case "status":
        return await statusCommand(offline, parsed.id, { follow: parsed.follow });
      case "undo":
        return await undoCommand(offline);
      case "checkpoints":
        return await checkpointsCommand(offline);
      case "diff":
        return await diffCommand(offline);
      case "tools":
        return toolsCommand(offline);
      case "config":
        return configCommand(offline);
      case "doctor":
        return await doctorCommand(offline);
      default:
        break;
    }

    const provider = providerFromEnv(process.env, parsed.model);
    if (!provider) {
      terminal.err(
        "No model provider is configured. Set ANTHROPIC_API_KEY (or OPENROUTER_API_KEY) and try again.",
      );
      terminal.err(`Run \`${CLI_NAME} doctor\` to see what else is missing.`);
      return 2;
    }

    const ctx = context(root, terminal, parsed, provider);
    ctx.signal = controller.signal;

    if (parsed.command === "resume") {
      return await resumeCommand(ctx, parsed.id, parsed.rest);
    }
    if (parsed.command === "chat") {
      return await chatCommand(ctx, parsed.rest);
    }
    if (!parsed.rest.trim()) {
      terminal.err(`Give it something to do: ${CLI_NAME} run "fix the failing test in src/lib"`);
      return 2;
    }
    terminal.out(`using ${configuredProviderName()}`);
    const { code } = await runCommand(ctx, parsed.rest);
    return code;
  } finally {
    process.off("SIGINT", interrupt);
    input.close();
  }
}

function context(
  root: string,
  terminal: Terminal,
  parsed: ParsedArgs,
  provider: CommandContext["provider"] | null,
): CommandContext {
  return {
    root,
    terminal,
    provider: provider as CommandContext["provider"],
    autonomy: parsed.autonomy,
    maxSteps: parsed.maxSteps,
    maxCostUsd: parsed.maxCostUsd,
    yes: parsed.yes,
  };
}

/** Commands that run with nothing configured, exported so the help text and
 *  the switch above cannot disagree about which those are. */
export const RUNS_WITHOUT_A_KEY = OFFLINE_COMMANDS;

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
