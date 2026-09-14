import { PLAN_CHOICES } from "./picker";
import { footerLine } from "./composer";
import { SESSION_HELP, slashNames } from "./args";
import {
  buildExecutor,
  checkpointsCommand,
  configCommand,
  diffCommand,
  doctorCommand,
  indexCommand,
  isYes,
  loginCommand,
  logoutCommand,
  mcpCommand,
  memoryCommand,
  runCommand,
  sessionsCommand,
  statusCommand,
  toolsCommand,
  undoCommand,
  type CommandContext,
} from "./commands";
import { formatTokens } from "./live";
import { renderSessionLine, renderUsage } from "./render";
import { banner, openingHelp, promptRule, shortPath } from "./banner";
import { findSkill, listSkills, skillGoal } from "./skills";
import { upgradeCommand } from "./upgrade";
import { readMemory } from "../memory/project-memory";
import { openStore } from "../memory/workspace-index";
import { providerFromSettings, resolveSettings } from "../providers";
import { SessionStore, type SessionRecord } from "./../session-store";

// A session, rather than one command and out.
//
// The transcript carries across turns, which is the whole point: the second
// thing you ask is usually about the first. Slash commands are handled here and
// never reach the model, so asking what it has changed cannot cost a turn or be
// answered from memory instead of from disk.

/** What a slash command asks the loop to do next. `{ run }` is a turn to send
 *  to the model, which is how a skill becomes work. */
export type SlashOutcome = "handled" | "exit" | "clear" | "not-a-command" | { run: string };

/** The parts of a conversation slash commands can change. */
export interface ChatState {
  session: SessionRecord | null;
  /** Look and propose, change nothing. */
  planMode: boolean;
}

/** How much of this project is indexed, for the banner. Opening the store is
 *  cheap and a missing one is the ordinary first-run case, not an error. */
function indexedCount(root: string): number | null {
  try {
    const store = openStore(root);
    const count = store.chunkCount;
    store.close();
    return count || null;
  } catch {
    return null;
  }
}

function onOff(value: string, current: boolean): boolean {
  if (/^(on|yes|true|1)$/i.test(value)) return true;
  if (/^(off|no|false|0)$/i.test(value)) return false;
  return !current;
}

function usageText(session: SessionRecord | null): string {
  if (!session) return "Nothing spent yet in this conversation.";
  const u = session.usage;
  const cached = u.cacheReadTokens ? `, ${formatTokens(u.cacheReadTokens)} read from cache` : "";
  return [
    `tokens  ${formatTokens(u.inputTokens)} in, ${formatTokens(u.outputTokens)} out${cached}`,
    `cost    about $${session.costUsd.toFixed(4)}`,
    `work    ${renderUsage(session.costUsd, session.steps, session.filesChanged)}`,
  ].join("\n");
}

/** A conversation named by id, id prefix or title, or chosen from a list. */
async function pickSession(
  context: CommandContext,
  arg: string,
  verb: string,
): Promise<SessionRecord | null> {
  const { terminal } = context;
  const store = new SessionStore(context.root);
  if (arg) {
    const wanted = arg.toLowerCase();
    const found = store
      .list({ includeArchived: true })
      .find(
        (record) => record.id.startsWith(wanted) || (record.title ?? "").toLowerCase() === wanted,
      );
    if (!found) terminal.err(`No conversation "${arg}" in this workspace. /sessions lists them.`);
    return found ?? null;
  }
  const choices = store.list().slice(0, 10);
  if (choices.length === 0) {
    terminal.out("No earlier conversations in this workspace.");
    return null;
  }
  choices.forEach((record, index) =>
    terminal.out(`  ${String(index + 1).padStart(2)}. ${renderSessionLine(record)}`),
  );
  const answer = (
    await terminal.ask(`Which one to ${verb}? [1-${choices.length}, Enter to cancel] `)
  ).trim();
  if (!answer) return null;
  const number = Number(answer);
  const pick =
    Number.isInteger(number) && number >= 1 && number <= choices.length
      ? choices[number - 1]
      : choices.find((record) => record.id.startsWith(answer.toLowerCase()));
  if (!pick) terminal.err(`"${answer}" is not one of those.`);
  return pick ?? null;
}

function label(record: SessionRecord): string {
  return record.title ? `"${record.title}"` : record.id;
}

/** After login or a model change, the provider this conversation talks to. */
function switchProvider(context: CommandContext, model?: string): boolean {
  const settings = resolveSettings({ root: context.root, model });
  const provider = providerFromSettings(settings);
  if (!provider) {
    context.terminal.err(settings.problem ?? "No model provider is configured.");
    return false;
  }
  context.provider = provider;
  return true;
}

export async function handleSlash(
  context: CommandContext,
  line: string,
  chat: ChatState | SessionRecord | null,
): Promise<SlashOutcome> {
  if (!line.startsWith("/")) return "not-a-command";
  // Older callers pass the session itself; a conversation passes its state.
  const state: ChatState =
    chat && "planMode" in chat
      ? chat
      : { session: (chat as SessionRecord | null) ?? null, planMode: false };
  const { terminal } = context;
  const [rawWord = "", ...words] = line.slice(1).trim().split(/\s+/);
  const word = rawWord.toLowerCase();
  const rest = words.join(" ").trim();
  const store = () => new SessionStore(context.root);

  switch (word) {
    case "exit":
    case "quit":
      return "exit";
    case "clear":
    case "new":
      return "clear";
    case "":
    case "?":
    case "help":
      terminal.out(SESSION_HELP);
      return "handled";
    case "undo":
      await undoCommand(context);
      return "handled";
    case "status":
      await statusCommand(context, state.session?.id);
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
    case "memory":
      memoryCommand(context);
      return "handled";
    case "mcp":
      await mcpCommand(context);
      return "handled";
    case "index":
      await indexCommand(context);
      return "handled";
    case "doctor":
      await doctorCommand(context);
      return "handled";
    case "upgrade":
      await upgradeCommand(context, { check: rest === "--check" });
      return "handled";
    case "cost":
    case "usage":
      terminal.out(usageText(state.session));
      return "handled";

    case "model": {
      if (!rest) {
        terminal.out(`model  ${context.provider.name}/${context.provider.model}`);
        terminal.out(
          "Switch with /model <name>, for example /model anthropic/claude-sonnet-5. " +
            "`devstation config set model <name>` makes it the default.",
        );
        return "handled";
      }
      if (switchProvider(context, rest)) {
        terminal.out(`Now using ${context.provider.name}/${context.provider.model}.`);
      }
      return "handled";
    }

    case "plan": {
      state.planMode = onOff(rest, state.planMode);
      terminal.out(
        state.planMode
          ? "Plan mode on. It will read, search and look things up, then propose a plan without changing anything."
          : "Plan mode off. It can make changes again.",
      );
      return "handled";
    }

    case "approve":
    case "approvals": {
      context.yes = onOff(rest, !!context.yes);
      terminal.out(
        context.yes
          ? "Auto-approve on. Every action runs without asking, for the rest of this session. /approve off to be asked again."
          : "Auto-approve off. Actions that change things will ask first.",
      );
      return "handled";
    }

    case "resume": {
      const picked = await pickSession(context, rest, "resume");
      if (!picked) return "handled";
      state.session = picked;
      terminal.out(
        `Resumed ${label(picked)} (${picked.messages.length} messages). Carry on where it left off.`,
      );
      if (picked.summary) terminal.out(picked.summary.split("\n").slice(0, 6).join("\n"));
      return "handled";
    }

    case "rename": {
      if (!rest) {
        terminal.err("Give it a name: /rename fix the login page");
        return "handled";
      }
      if (!state.session) {
        terminal.err("Nothing to rename yet: this conversation starts with your first message.");
        return "handled";
      }
      state.session.title = rest.slice(0, 80);
      store().save(state.session);
      terminal.out(`Renamed to "${state.session.title}".`);
      return "handled";
    }

    case "archive": {
      const target =
        rest || !state.session ? await pickSession(context, rest, "archive") : state.session;
      if (!target) return "handled";
      target.archived = true;
      store().save(target);
      terminal.out(`Archived ${label(target)}. /resume ${target.id} still opens it.`);
      if (state.session?.id === target.id) return "clear";
      return "handled";
    }

    case "delete": {
      const target =
        rest || !state.session ? await pickSession(context, rest, "delete") : state.session;
      if (!target) return "handled";
      const answer = await terminal.ask(
        `Delete ${label(target)} and its history for good? This cannot be undone. [y/N] `,
      );
      if (!isYes(answer)) {
        terminal.out("Kept.");
        return "handled";
      }
      store().remove(target.id);
      terminal.out(`Deleted ${label(target)}.`);
      if (state.session?.id === target.id) return "clear";
      return "handled";
    }

    case "login": {
      const code = await loginCommand(context, rest);
      if (code === 0 && switchProvider(context)) {
        terminal.out(`This session now uses ${context.provider.name}/${context.provider.model}.`);
      }
      return "handled";
    }
    case "logout":
      logoutCommand(context, rest);
      return "handled";

    case "skill":
    case "skills": {
      const [name = "", ...task] = words;
      if (!name) {
        const skills = listSkills(context.root);
        if (skills.length === 0) {
          terminal.out("No skills yet. A skill is a Markdown file of instructions, kept in:");
          terminal.out("  .devstation/skills/<name>.md      for this project");
          terminal.out("  ~/.devstation/skills/<name>.md    for every project");
          terminal.out(
            "Skills in .claude/skills work too. Run one with /skill <name> [task] or /<name>.",
          );
          return "handled";
        }
        const width = Math.max(...skills.map((s) => s.name.length));
        for (const skill of skills) {
          const about =
            skill.description.length > 72
              ? `${skill.description.slice(0, 71)}…`
              : skill.description;
          terminal.out(`  /${skill.name.padEnd(width)}  ${about}  (${skill.scope})`);
        }
        return "handled";
      }
      const skill = findSkill(context.root, name);
      if (!skill) {
        terminal.err(`No skill called "${name}". /skill lists them.`);
        return "handled";
      }
      return { run: skillGoal(skill, task.join(" ")) };
    }

    default: {
      // A skill can be called by its own name, the way Claude Code does it.
      const skill = findSkill(context.root, word);
      if (skill) return { run: skillGoal(skill, rest) };
      const close = slashNames().filter((name) => name.startsWith(word.slice(0, 2)));
      terminal.err(
        `No such command: /${word}.${close.length ? ` Did you mean ${close.map((n) => `/${n}`).join(", ")}?` : ""} Type /help for the list.`,
      );
      return "handled";
    }
  }
}

export async function chatCommand(context: CommandContext, opening = ""): Promise<number> {
  const { terminal } = context;

  // Built before the banner, because the banner says which mode you are in and
  // a sandbox that cannot start should say so instead of printing a banner and
  // then failing.
  //
  // One container for the conversation, not one per turn: otherwise every turn
  // pays to start one and loses /tmp, the package cache and anything running in
  // the background between them.
  const built = await buildExecutor(context.root, context.sandbox ?? true);
  if ("problem" in built) {
    terminal.err(built.problem);
    return 2;
  }
  const executor = built.executor;
  // One set for the whole conversation: "always" means for this session, not
  // for this turn.
  const withExecutor: CommandContext = { ...context, executor, alwaysAllow: new Set() };

  terminal.out(
    banner(
      {
        model: `${context.provider.name}/${context.provider.model}`,
        workspace: context.root,
        indexed: indexedCount(context.root),
        memory: readMemory(context.root).length,
        executor: executor.describe,
      },
      { colour: terminal.colour },
    ),
  );
  terminal.out(openingHelp(terminal.colour));

  const state: ChatState = { session: null, planMode: false };
  let spent = 0;
  const footerNow = () =>
    footerLine(
      {
        mode: state.planMode ? "plan" : withExecutor.yes ? "auto" : "normal",
        model: withExecutor.provider.model,
        path: shortPath(context.root),
        costUsd: spent,
      },
      terminal.columns || Number(process.env.COLUMNS) || 80,
      terminal.colour,
    );

  // Shift+Tab at the prompt: normal, then auto mode, then plan mode, then back.
  terminal.onCycleMode = () => {
    if (state.planMode) {
      state.planMode = false;
      withExecutor.yes = false;
      return "Normal mode: anything that changes things asks first. (Shift+Tab to switch)";
    }
    if (withExecutor.yes) {
      withExecutor.yes = false;
      state.planMode = true;
      return "⏸ Plan mode: it looks and proposes a plan, and changes nothing. (Shift+Tab to switch)";
    }
    withExecutor.yes = true;
    return "⏵⏵ Auto mode: actions run without asking; critical ones still ask. (Shift+Tab to switch)";
  };
  let pending = opening.trim();
  // A turn queued by the loop itself, such as carrying out an accepted plan.
  // Never read as a slash command.
  let queued = "";
  let turns = 0;

  const finish = async () => {
    await executor.dispose();
    return 0;
  };

  // The footer follows the mode the moment Shift+Tab changes it.
  const cycle = terminal.onCycleMode;
  terminal.onCycleMode = () => {
    const label = cycle ? cycle() : "";
    terminal.setFooter?.(footerNow(), state.session?.title ?? "");
    return label;
  };
  terminal.setFooter?.(footerNow(), state.session?.title ?? "");

  for (;;) {
    let goal = queued;
    queued = "";
    if (!goal) {
      if (!pending && terminal.write && terminal.setFooter) {
        terminal.setFooter(footerNow(), state.session?.title ?? "");
      } else if (!pending && terminal.write) {
        const parts = [
          withExecutor.provider.model,
          shortPath(context.root),
          state.planMode ? "plan mode" : "",
          withExecutor.yes ? "auto mode" : "",
          state.session?.title ?? "",
          "/help",
        ].filter(Boolean);
        terminal.write(
          promptRule(parts.join(" · "), {
            columns: terminal.columns || Number(process.env.COLUMNS) || 80,
            colour: terminal.colour,
          }),
        );
      }
      const line = pending || (await terminal.ask(terminal.setFooter ? "❯ " : "> "));
      pending = "";
      const text = line.trim();
      if (!text) {
        // The end of the input closes the session; an empty line does not. A
        // person pressing Enter on an empty prompt, or a blank line in a paste,
        // used to end the session on the spot. Where the terminal cannot say,
        // an empty answer is the end, which is what a closed pipe gives.
        const ended = terminal.ended ? terminal.ended() : line === "";
        if (ended) return finish();
        continue;
      }

      const outcome = await handleSlash(withExecutor, text, state);
      if (outcome === "exit") return finish();
      if (outcome === "clear") {
        state.session = null;
        terminal.out("Starting a fresh conversation. The workspace is untouched.");
        continue;
      }
      if (outcome === "handled") continue;
      goal = typeof outcome === "object" ? outcome.run : text;
    }

    // Each turn continues the same session rather than starting a new one, so
    // the agent still knows what it just did.
    turns++;
    const planning = state.planMode;
    const result = await runCommand(withExecutor, goal, {
      ...(state.session ? { resume: state.session } : {}),
      // The first turn prints the session id and the goal; after that it is
      // the same session and the same goal is on screen two lines up.
      quiet: turns > 1,
      readOnly: planning,
    });
    state.session = result.session;
    spent += result.result?.costUsd ?? 0;
    terminal.out("");

    // Plan mode ends the way Claude Code's does: with the plan on screen and a
    // question. Only asked of a person at a terminal; a pipe keeps planning.
    if (planning && result.result?.ok && terminal.write) {
      let approved: boolean;
      if (terminal.choose) {
        terminal.out("  Carry out this plan?");
        approved = (await terminal.choose(PLAN_CHOICES)) === 0;
      } else {
        approved = isYes(await terminal.ask("Carry out this plan? [y]es / [N]o, keep planning "));
      }
      if (approved) {
        state.planMode = false;
        queued = "The plan above is approved. Carry it out now, then verify it works.";
      }
    }
  }
}
