#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { HELP, parseArgs } from "./args";
import {
  resumeCommand,
  runCommand,
  sessionsCommand,
  statusCommand,
  undoCommand,
  type CommandContext,
  type Terminal,
} from "./commands";
import { colourEnabled } from "./render";
import { configuredProviderName, providerFromEnv } from "../providers";

// The terminal front end. Everything below the parsing and the readline lives
// in commands.ts, which is what makes this a thin third consumer of the same
// core the web app and the runner use rather than a second implementation.

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

  const root = resolve(parsed.root);
  if (!existsSync(root)) {
    process.stderr.write(`There is no directory at ${root}.\n`);
    return 2;
  }

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const terminal: Terminal = {
    out: (text) => process.stdout.write(`${text}\n`),
    err: (text) => process.stderr.write(`${text}\n`),
    ask: (question) => readline.question(question),
    colour: colourEnabled(),
  };

  // Ctrl-C stops the run rather than killing the process outright, so the
  // session is saved and the summary still prints.
  const controller = new AbortController();
  const interrupt = () => {
    terminal.err("\nStopping. The session is saved; resume it with `agent resume`.");
    controller.abort();
  };
  process.on("SIGINT", interrupt);

  try {
    if (parsed.command === "sessions") {
      return sessionsCommand(context(root, terminal, parsed, null));
    }
    if (parsed.command === "status") {
      return await statusCommand(context(root, terminal, parsed, null), parsed.id, {
        follow: parsed.follow,
      });
    }
    if (parsed.command === "undo") {
      return await undoCommand(context(root, terminal, parsed, null));
    }

    const provider = providerFromEnv();
    if (!provider) {
      terminal.err(
        "No model provider is configured. Set ANTHROPIC_API_KEY (or OPENROUTER_API_KEY) and try again.",
      );
      return 2;
    }
    terminal.out(`using ${configuredProviderName()}`);

    const ctx = context(root, terminal, parsed, provider);
    ctx.signal = controller.signal;

    if (parsed.command === "resume") {
      return await resumeCommand(ctx, parsed.id, parsed.rest);
    }
    if (!parsed.rest.trim()) {
      terminal.err('Give it something to do: agent run "fix the failing test in src/lib"');
      return 2;
    }
    const { code } = await runCommand(ctx, parsed.rest);
    return code;
  } finally {
    process.off("SIGINT", interrupt);
    readline.close();
  }
}

function context(
  root: string,
  terminal: Terminal,
  parsed: ReturnType<typeof parseArgs>,
  provider: CommandContext["provider"] | null,
): CommandContext {
  return {
    root,
    terminal,
    // The read-only commands never reach a model; this keeps them from
    // needing a key to run.
    provider: provider as CommandContext["provider"],
    autonomy: parsed.autonomy,
    maxSteps: parsed.maxSteps,
    maxCostUsd: parsed.maxCostUsd,
    yes: parsed.yes,
  };
}

if (import.meta.main) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    });
}
