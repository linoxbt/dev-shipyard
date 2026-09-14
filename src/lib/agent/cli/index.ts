#!/usr/bin/env bun
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import {
  CLI_NAME,
  HELP,
  OFFLINE_COMMANDS,
  VERSION,
  completeSlash,
  parseArgs,
  type ParsedArgs,
} from "./args";
import { listSkills } from "./skills";
import {
  checkpointsCommand,
  configCommand,
  configEditCommand,
  diffCommand,
  doctorCommand,
  indexCommand,
  loginCommand,
  logoutCommand,
  mcpCommand,
  memoryCommand,
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
import { repoCommand } from "./repo-command";
import { colourEnabled } from "./render";
import { lineReader } from "./line-reader";
import { pickerKey, renderPicker, type Choice, type KeyInfo } from "./picker";
import { slashMenuItems, slashMenuLines } from "./slash-menu";
import { boxLines, composerView, messageBlock } from "./composer";
import { providerFromSettings, resolveSettings } from "../providers";
import { notifyIfOutdated, upgradeCommand } from "./upgrade";

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

  // readline echoes what is typed through its output. Routing that through a
  // switchable stream is what lets a key be entered without appearing on screen.
  let muted = false;
  // At a terminal the CLI draws the input row itself, so readline's own echo
  // is kept off the screen for the whole session.
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  const composing = tty;
  let composerPrompt = "";
  let secret = false;
  const output = new Writable({
    write(chunk, encoding, done) {
      if (!muted && !composing) process.stdout.write(chunk, encoding);
      done();
    },
  });
  // Set for the length of one Shift+Tab, so readline's own Tab completion does
  // not also fire for it.
  let cyclingMode = false;
  const readline = createInterface({
    input: process.stdin,
    output,
    terminal: Boolean(process.stdin.isTTY),
    // Tab after "/" offers the session commands and the skills found here.
    completer: (line: string) =>
      cyclingMode
        ? ([[], line] as [string[], string])
        : completeSlash(line, () => listSkills(root).map((s) => s.name)),
  });
  // At a terminal, a burst of lines is a paste and becomes one message; a pipe
  // is read line by line, as scripts expect.
  const input = lineReader(
    readline,
    (text) => {
      if (!tty) {
        process.stdout.write(text);
        return;
      }
      composerPrompt = text;
      menu = [];
      drawBox();
    },
    {
      coalesceMs: process.stdin.isTTY ? 30 : 0,
      onPasteHeld: (lines) => {
        if (tty) drawBox();
        else process.stdout.write(`  (${lines} lines pasted. Press Enter to send them.)\n`);
      },
      // A sent message replaces the input row with a shaded block.
      onDeliver: (text) => {
        if (!tty || secret || !text.trim()) return;
        menu = [];
        eraseBox();
        const block = messageBlock(text, process.stdout.columns || 80, colourEnabled());
        process.stdout.write(`${block}\n`);
      },
    },
  );

  // Arrow keys, the command list and Shift+Tab, at a real terminal only. A pipe
  // answers prompts with typed lines, which is what scripts send.
  let picking = false;

  const choose = (choices: Choice[]): Promise<number> =>
    new Promise((resolve) => {
      picking = true;
      const release = input.hold();
      muted = true;
      let selected = 0;
      let drawn = 0;
      const draw = (finished = false) => {
        const lines = renderPicker(choices, selected, colourEnabled(), finished);
        const up = drawn > 0 ? `\x1b[${drawn}A` : "";
        process.stdout.write(`${up}${lines.map((line) => `\r\x1b[2K${line}`).join("\n")}\n`);
        drawn = lines.length;
      };
      const onKey = (sequence: string | undefined, key: KeyInfo | undefined) => {
        const step = pickerKey({ ...key, sequence: key?.sequence ?? sequence }, selected, choices);
        selected = step.selected;
        if (step.done === undefined) {
          draw();
          return;
        }
        process.stdin.off("keypress", onKey);
        selected = step.done;
        draw(true);
        process.stdout.write("\x1b[?25h");
        // Whatever the keys put in readline's own line is not a message.
        (readline as unknown as { write(data: null, key: object): void }).write(null, {
          ctrl: true,
          name: "u",
        });
        muted = false;
        picking = false;
        setTimeout(release, 50);
        resolve(step.done);
      };
      process.stdout.write("\x1b[?25l");
      draw();
      process.stdin.on("keypress", onKey);
    });

  // The input box, drawn by hand the way Claude Code draws it: a rule, the ❯
  // prompt, a rule, and the footer under it, with the command list below when
  // "/" is typed. It follows the conversation rather than being pinned, so it
  // never covers what the agent said, and a pasted brief is one tidy line.
  let boxDrawn = false;
  let footerText = "";
  let boxTitle = "";
  let menu: string[] = [];
  let skillNames: string[] | null = null;
  const drawBox = () => {
    if (!tty || picking || secret || !input.waiting()) return;
    const rl = readline as unknown as { line?: string; cursor?: number };
    const line = rl.line ?? "";
    const columns = process.stdout.columns || 80;
    const view = composerView({
      prompt: composerPrompt,
      line,
      cursor: rl.cursor ?? line.length,
      columns,
      pastedLines: input.pending().pastedLines,
      colour: colourEnabled(),
    });
    const lines = boxLines({
      input: view.text,
      footer: footerText,
      columns,
      title: boxTitle,
      menu,
      colour: colourEnabled(),
    });
    // From the input line, up to the top rule and clear; draw; then back up
    // from the last line to the input line.
    const start = boxDrawn ? "\x1b[1A\r\x1b[J" : "\r\x1b[J";
    const up = lines.length - 2;
    process.stdout.write(
      `${start}${lines.join("\n")}${up > 0 ? `\x1b[${up}A` : ""}\r` +
        (view.column > 0 ? `\x1b[${view.column}C` : ""),
    );
    boxDrawn = true;
  };
  const eraseBox = () => {
    if (!boxDrawn) return;
    process.stdout.write("\x1b[1A\r\x1b[J");
    boxDrawn = false;
  };
  const onPromptKey = (
    _sequence: string | undefined,
    key: (KeyInfo & { shift?: boolean }) | undefined,
  ) => {
    if (picking || secret || !input.waiting()) return;
    if (key?.name === "tab" && key.shift && terminal.onCycleMode) {
      // The mode shows in the footer; nothing is printed into the conversation.
      terminal.onCycleMode();
      drawBox();
      return;
    }
    if (key?.name === "return" || key?.name === "enter") {
      menu = [];
      return;
    }
    const line = (readline as unknown as { line?: string }).line ?? "";
    skillNames ??= listSkills(root).map((s) => s.name);
    menu = slashMenuLines(line, slashMenuItems(skillNames), {
      colour: colourEnabled(),
      maxRows: Math.max(3, Math.min(8, (process.stdout.rows ?? 24) - 10)),
    });
    drawBox();
  };
  if (tty) {
    process.stdin.prependListener(
      "keypress",
      (_s: string, key: { name?: string; shift?: boolean }) => {
        cyclingMode = Boolean(key?.name === "tab" && key.shift);
      },
    );
    process.stdin.on("keypress", onPromptKey);
  }

  const terminal: Terminal = {
    out: (text) => {
      const hadBox = boxDrawn;
      eraseBox();
      process.stdout.write(`${text}\n`);
      if (hadBox) drawBox();
    },
    err: (text) => {
      const hadBox = boxDrawn;
      eraseBox();
      process.stderr.write(`${text}\n`);
      if (hadBox) drawBox();
    },
    ask: (question) => input.ask(question),
    ended: () => input.ended(),
    choose: tty ? choose : undefined,
    setFooter: tty
      ? (text, title) => {
          footerText = text;
          if (title !== undefined) boxTitle = title;
          drawBox();
        }
      : undefined,
    askSecret: async (question) => {
      process.stdout.write(question);
      muted = true;
      secret = true;
      try {
        return await input.ask("");
      } finally {
        muted = false;
        secret = false;
        if (process.stdin.isTTY) process.stdout.write("\n");
      }
    },
    // Only when somebody is actually watching. Into a pipe, a half-written
    // line is a broken log rather than a live one.
    write: process.stdout.isTTY ? (text) => process.stdout.write(text) : undefined,
    colour: colourEnabled(),
    get columns() {
      return process.stdout.columns;
    },
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
        return parsed.rest.trim()
          ? configEditCommand(offline, parsed.rest, { project: parsed.project })
          : configCommand(offline);
      case "login":
        return await loginCommand(offline, parsed.rest);
      case "logout":
        return logoutCommand(offline, parsed.rest);
      case "upgrade":
        return await upgradeCommand(offline, { check: parsed.check });
      case "doctor":
        return await doctorCommand(offline);
      case "index":
        return await indexCommand(offline);
      case "memory":
        return memoryCommand(offline);
      case "mcp":
        return await mcpCommand(offline);
      default:
        break;
    }

    // A conversation gets a screen of its own, the way claude and codex open:
    // a clean terminal with the banner at the top, not a banner under whatever
    // the shell printed last. Scrollback is left alone.
    if (parsed.command === "chat" && process.stdout.isTTY) {
      process.stdout.write("\u001b[H\u001b[2J");
    }

    const settings = resolveSettings({ root, model: parsed.model });
    for (const warning of settings.warnings) terminal.err(`warning: ${warning}`);
    const provider = providerFromSettings(settings);
    if (!provider) {
      terminal.err(settings.problem ?? "No model provider is configured.");
      terminal.err(`Run \`${CLI_NAME} doctor\` to see what else is missing.`);
      return 2;
    }

    // Reads yesterday's answer from a cache and refreshes it in the background:
    // never a network round trip in front of the first prompt.
    void notifyIfOutdated(terminal);

    const ctx = context(root, terminal, parsed, provider);
    ctx.signal = controller.signal;

    if (parsed.command === "repo") {
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      if (!token) {
        terminal.err(
          "Set GITHUB_TOKEN to a token that can push to that repository, then try again.",
        );
        return 2;
      }
      // The first word is the repository, the rest is the goal.
      const [target, ...words] = parsed.rest.split(/\s+/);
      const { code } = await repoCommand(ctx, target ?? "", words.join(" "), { token });
      return code;
    }
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
    terminal.out(`using ${provider.name}/${provider.model}`);
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
    sandbox: parsed.sandbox,
    json: parsed.json,
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
