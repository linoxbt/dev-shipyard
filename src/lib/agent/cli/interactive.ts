import { SESSION_HELP } from "./args";
import {
  checkpointsCommand,
  configCommand,
  diffCommand,
  runCommand,
  sessionsCommand,
  statusCommand,
  toolsCommand,
  undoCommand,
  type CommandContext,
} from "./commands";
import { renderUsage } from "./render";
import type { SessionRecord } from "./../session-store";

// A session, rather than one command and out.
//
// The transcript carries across turns, which is the whole point: the second
// thing you ask is usually about the first. Slash commands are handled here and
// never reach the model, so asking what it has changed cannot cost a turn or be
// answered from memory instead of from disk.

export type SlashOutcome = "handled" | "exit" | "clear" | "not-a-command";

export async function handleSlash(
  context: CommandContext,
  line: string,
  session: SessionRecord | null,
): Promise<SlashOutcome> {
  if (!line.startsWith("/")) return "not-a-command";
  const [word] = line.slice(1).trim().split(/\s+/);

  switch (word) {
    case "exit":
    case "quit":
      return "exit";
    case "clear":
      return "clear";
    case "help":
      context.terminal.out(SESSION_HELP);
      return "handled";
    case "undo":
      await undoCommand(context);
      return "handled";
    case "status":
      await statusCommand(context, session?.id);
      return "handled";
    case "sessions":
      sessionsCommand(context);
      return "handled";
    case "checkpoints":
      await checkpointsCommand(context);
      return "handled";
    case "diff":
      await diffCommand(context);
      return "handled";
    case "tools":
      toolsCommand(context);
      return "handled";
    case "config":
      configCommand(context);
      return "handled";
    case "cost":
      context.terminal.out(
        session
          ? renderUsage(session.costUsd, session.steps, session.filesChanged)
          : "Nothing spent yet in this session.",
      );
      return "handled";
    default:
      context.terminal.err(`No such command: /${word}. Type /help for the list.`);
      return "handled";
  }
}

export async function chatCommand(context: CommandContext, opening = ""): Promise<number> {
  const { terminal } = context;
  terminal.out(`DevStation  ${context.provider.name}/${context.provider.model}`);
  terminal.out(`workspace ${context.root}`);
  terminal.out("Type what you want done. /help for commands, /exit to leave.");
  terminal.out("");

  let session: SessionRecord | null = null;
  let pending = opening.trim();

  for (;;) {
    const line = pending || (await terminal.ask("> "));
    pending = "";
    const text = line.trim();
    if (!text) {
      // An empty line at a closed pipe would otherwise spin forever.
      if (line === "") return 0;
      continue;
    }

    const outcome = await handleSlash(context, text, session);
    if (outcome === "exit") return 0;
    if (outcome === "clear") {
      session = null;
      terminal.out("Starting a fresh transcript. The workspace is untouched.");
      continue;
    }
    if (outcome === "handled") continue;

    // Each turn continues the same session rather than starting a new one, so
    // the agent still knows what it just did.
    const result = await runCommand(context, text, session ? { resume: session } : {});
    session = result.session;
    terminal.out("");
  }
}
