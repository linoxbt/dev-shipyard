// The App Builder's conversation.
//
// A build is a conversation, not a one-shot: you describe an app, look at it,
// and say what is wrong. So the model keeps the full history, and each turn is
// given the things it cannot see for itself — which files currently exist,
// what the validator found, and any error the running preview reported.
//
// That last part is the difference between "the preview is blank" and a fix:
// the agent is told the actual exception, so it does not have to guess.
//
// When a build runner is configured the same idea goes further: the project is
// installed, linted, built and driven in a real browser, and whatever fails
// comes back as another message for the model to repair from. A build error, a
// lint error and a failing Playwright test are all just tool output, handled
// the way compile errors already are elsewhere in DevStation.

import { chatStream, type ChatMessage } from "../ai";
import {
  appBuilderSystemPrompt,
  parseGeneratedFiles,
  reviewSystemPrompt,
  type PromptContext,
} from "./prompt";
import { issuesForModel, validateApp, type ValidationIssue } from "./validate";
import {
  classifyIntent,
  parseStatusMarkers,
  stripStatusMarkers,
  type AgentProgress,
  type AgentState,
  type TurnMode,
} from "./intent";
import type { PreviewError } from "./preview";

/** How many auto-repair rounds a single turn may take before handing back. */
export const MAX_REPAIR_ROUNDS = 2;

/** Enough of a failing log to diagnose from. The useful part of a build, type
 *  or test failure is almost always at the end, so this keeps the tail. */
const LOG_TAIL_CHARS = 2500;

export interface BuildPhaseResult {
  phase: string;
  ok: boolean;
  log: string;
}

export interface BuildOutcome {
  ok: boolean;
  phases: BuildPhaseResult[];
  /** The built site, when the build succeeded. */
  dist: Record<string, string> | null;
  /** Set when the build could not be attempted — no runner configured, rate
   *  limited, unreachable. Not a failure of the app, so it is reported to the
   *  user rather than fed back to the model as something to fix. */
  unavailable?: string;
}

/** Turn a failed job into something the model can act on.
 *
 *  Only the first failing phase is reported. Later phases were never run, and
 *  a lint error printed underneath a build error just buries the thing that
 *  actually has to be fixed first. */
export function buildFeedback(outcome: BuildOutcome): string | null {
  if (outcome.ok || outcome.unavailable) return null;
  const failed = outcome.phases.find((p) => !p.ok);
  if (!failed) return null;

  const log = failed.log.trim();
  const tail = log.length > LOG_TAIL_CHARS ? `…\n${log.slice(log.length - LOG_TAIL_CHARS)}` : log;

  const what: Record<string, string> = {
    install: "Installing the dependencies failed",
    lint: "The linter rejected the code",
    typecheck: "Type checking failed",
    build: "The build failed",
    test: "The browser test failed",
  };
  return [
    `${what[failed.phase] ?? `The ${failed.phase} step failed`}. Fix it and return the full contents of every file you change.`,
    "",
    "```",
    tail || "(no output)",
    "```",
  ].join("\n");
}

export interface TurnInput {
  prompt: string;
  /** Files as they stand now; the model edits these. */
  files: Record<string, string>;
  history: ChatMessage[];
  context?: PromptContext;
  /** Errors the preview reported since the last turn. */
  previewErrors?: PreviewError[];
  dir?: string;
  signal?: AbortSignal;
  onDelta?: (chunk: string) => void;
  /** Called between repair rounds, so the UI can say what is happening. */
  onStatus?: (status: string) => void;
  /** Every state change, with a message describing the ACTUAL action. The UI
   *  renders these instead of a fixed Planning → Coding → Testing sequence. */
  onProgress?: (event: AgentProgress) => void;
  /** Live prose from the model, so the chat reads as it thinks rather than
   *  sitting on a spinner. */
  onProse?: (text: string) => void;
  /** Fired as each file is written, so progress is visible file by file. */
  onFile?: (path: string) => void;
  /** "review" reads the app over and reports findings without touching it.
   *  Nothing is written, nothing is built, and no repair rounds run. */
  /** Force a mode. Left unset, the turn decides for itself from the message and
   *  the conversation — a greeting must never reach the build pipeline. */
  mode?: TurnMode;
  /** Runs the project's real toolchain. Absent when no build runner is
   *  configured, in which case static validation is the only feedback there
   *  is — which is exactly how this worked before, and still works. */
  runBuild?: (files: Record<string, string>) => Promise<BuildOutcome>;
  /** How to reach the model. Injected for the same reason runBuild is: the
   *  identical turn logic has to run in two places. In the browser it posts to
   *  /api/ai; inside the build runner it calls the provider directly, because
   *  a turn that lives in the page dies the moment the page is refreshed. */
  chat?: (opts: {
    system: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
    onDelta: (chunk: string) => void;
  }) => Promise<string>;
}

export interface TurnResult {
  files: Record<string, string>;
  /** Files this turn actually changed. */
  changed: string[];
  history: ChatMessage[];
  issues: ValidationIssue[];
  /** Prose the model wrote alongside the code. */
  reply: string;
  repaired: number;
  /** The last build attempt, when one was made. */
  build?: BuildOutcome;
}

/** Per-file ceiling in the briefing. Generated apps sit well under this; a
 *  runaway file is truncated in the middle, where the least is lost. */
const MAX_FILE_CHARS = 12_000;
/** Ceiling across all files, so a large project cannot crowd out the
 *  conversation itself. */
const MAX_BRIEFING_CHARS = 45_000;

function clip(content: string): string {
  if (content.length <= MAX_FILE_CHARS) return content;
  const half = Math.floor(MAX_FILE_CHARS / 2);
  return `${content.slice(0, half)}\n\n… ${content.length - MAX_FILE_CHARS} characters omitted …\n\n${content.slice(-half)}`;
}

/** What the model is told about the state it cannot see.
 *
 *  This sends the ACTUAL CONTENTS of the current files, not just their names.
 *  Names alone were the single worst bug in this loop: the model's only
 *  knowledge of the code was whatever it had written earlier in the
 *  conversation, so on a follow-up it reconstructed whole files from memory
 *  rather than editing what was there. That looks like the agent throwing away
 *  your app and starting again, because that is exactly what it was doing —
 *  and it got worse the longer the conversation ran, as its recollection drifted
 *  further from the files on disk.
 *
 *  Sent fresh every turn, so it is always authoritative. Stale code blocks in
 *  the history are stripped for the same reason (see trimHistory). */
export function stateBriefing(
  files: Record<string, string>,
  previewErrors: PreviewError[] = [],
  dir = "app",
): string {
  const prefix = dir ? `${dir}/` : "";
  const own = Object.entries(files)
    .filter(([p]) => p.startsWith(prefix))
    .map(([p, c]) => [p.slice(prefix.length), c] as const)
    .sort(([a], [b]) => a.localeCompare(b));

  const parts: string[] = [];

  if (own.length) {
    let budget = MAX_BRIEFING_CHARS;
    const blocks: string[] = [];
    for (const [name, content] of own) {
      const body = clip(content);
      if (body.length > budget) {
        blocks.push(`--- ${name} (omitted, too large to include) ---`);
        continue;
      }
      budget -= body.length;
      const generated = /(^|\/)contract\.js$/.test(name)
        ? " [GENERATED — read it, never output it]"
        : "";
      blocks.push(`--- ${name}${generated} ---\n${body}`);
    }
    parts.push(
      "The app as it stands right now. This is the real code — edit THESE files,\n" +
        "do not rewrite them from memory and do not start over:\n\n" +
        blocks.join("\n\n"),
    );
  }

  if (previewErrors.length) {
    const seen = new Set<string>();
    const lines = previewErrors
      .filter((e) => !seen.has(e.message) && seen.add(e.message))
      .slice(0, 5)
      .map(
        (e) => `  - [${e.kind}] ${e.message}${e.source ? ` (${e.source}:${e.line ?? "?"})` : ""}`,
      );
    parts.push(
      `The running preview reported these errors — this is why it looks blank or broken:\n${lines.join("\n")}`,
    );
  }
  return parts.join("\n\n");
}

/** Strip code blocks out of earlier assistant turns.
 *
 *  Two reasons, and they compound. The current files are sent fresh every turn
 *  by stateBriefing, so old code in the transcript is at best duplication and
 *  at worst a contradiction — a model that sees three versions of app.js has to
 *  guess which is live, and it guesses wrong. And an app's worth of code
 *  repeated over ten turns crowds out the thing that actually matters: what you
 *  asked for, and why.
 *
 *  The prose survives, so the conversation keeps its intent and its memory.
 *  Only the code goes, because the code is supplied authoritatively elsewhere. */
export function trimHistory(history: ChatMessage[]): ChatMessage[] {
  return history.map((m) => {
    if (m.role !== "assistant") return m;
    const prose = stripCodeBlocks(m.content);
    return {
      ...m,
      content: prose || "(wrote the files described above)",
    };
  });
}

/** Merge the model's files over the current set, protecting the binding. */
function applyFiles(
  current: Record<string, string>,
  produced: Array<{ path: string; content: string }>,
): { files: Record<string, string>; changed: string[] } {
  const files = { ...current };
  const changed: string[] = [];
  for (const f of produced) {
    // contract.js is generated from the deployed contract; a model rewrite
    // would silently repoint the app. Dropped rather than merged.
    if (/(^|\/)contract\.js$/.test(f.path)) continue;
    if (files[f.path] !== f.content) {
      files[f.path] = f.content;
      changed.push(f.path);
    }
  }
  return { files, changed };
}

/**
 * One turn of the conversation, including up to MAX_REPAIR_ROUNDS automatic
 * repairs when the result would not run. Repairing here rather than handing a
 * broken app back is the whole point: a blank preview is not a useful reply.
 */
export async function runTurn(input: TurnInput): Promise<TurnResult> {
  const chat = input.chat ?? chatStream;
  const dir = input.dir ?? "app";

  const report = (state: AgentState, message: string) => {
    input.onProgress?.({ state, message, timestamp: Date.now() });
    // onStatus is the older, single-string surface. It carries the same
    // message so nothing shows a label that contradicts the event.
    input.onStatus?.(message);
  };

  // Decide what this message actually is before doing anything. Skipped only
  // when the caller has already decided — the Review button, for instance.
  let mode: TurnMode = input.mode ?? "build";
  if (!input.mode) {
    const intent = await classifyIntent({
      prompt: input.prompt,
      history: input.history,
      files: input.files,
      chat,
      signal: input.signal,
    });
    mode = intent.mode;

    // A conversation ends here. No files are written, no build runs, and no
    // build-shaped status is ever shown — which is the entire point.
    if (mode === "converse" && intent.reply) {
      report(
        intent.needsClarification ? "asking_clarification" : "conversational",
        intent.needsClarification ? "Asking about one detail…" : "Answering…",
      );
      input.onProse?.(intent.reply);
      const history: ChatMessage[] = [
        ...input.history,
        { role: "user", content: input.prompt },
        { role: "assistant", content: intent.reply },
      ];
      return {
        files: input.files,
        changed: [],
        history,
        issues: [],
        reply: intent.reply,
        repaired: 0,
      };
    }
    if (intent.understanding) {
      report(mode === "review" ? "reviewing" : "planning", intent.understanding);
    }
  }

  const review = mode === "review";
  const system = review
    ? reviewSystemPrompt(input.context ?? {})
    : appBuilderSystemPrompt(input.context ?? {});

  const briefing = stateBriefing(input.files, input.previewErrors, dir);
  const messages: ChatMessage[] = [
    ...trimHistory(input.history),
    { role: "user", content: briefing ? `${briefing}\n\n---\n\n${input.prompt}` : input.prompt },
  ];

  let files = input.files;
  let reply = "";
  let changed: string[] = [];
  let issues: ValidationIssue[] = [];
  let repaired = 0;
  let build: BuildOutcome | undefined;

  // A review is one pass: ask, read the answer, stop. No files, no build, no
  // repair rounds — there is nothing to repair.
  if (review) {
    let streamed = "";
    let reviewStatuses = 0;
    reply = await chat({
      system,
      messages,
      signal: input.signal,
      onDelta: (chunk) => {
        streamed += chunk;
        input.onDelta?.(chunk);
        // A review narrates itself the same way a build does, so nothing here
        // announces a status the model has not actually claimed.
        const markers = parseStatusMarkers(streamed);
        for (const m of markers.slice(reviewStatuses)) {
          input.onProgress?.(m);
          input.onStatus?.(m.message);
        }
        reviewStatuses = markers.length;
        input.onProse?.(stripStatusMarkers(streamed));
      },
    });
    messages.push({ role: "assistant", content: reply });
    return {
      files: input.files,
      changed: [],
      history: messages,
      issues: [],
      reply,
      repaired: 0,
    };
  }

  let forcedBuild = false;
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    // No status is announced here. The model emits its own as it works (see
    // STATUS_PROTOCOL); announcing one now would be a guess about what it is
    // about to do, which is the habit this replaced.
    let streamed = "";
    let reportedStatuses = 0;
    let lastFileReported = "";
    reply = await chat({
      system,
      messages,
      signal: input.signal,
      onDelta: (chunk) => {
        streamed += chunk;
        input.onDelta?.(chunk);
        // Show each completed marker once, in the order the model wrote it.
        const markers = parseStatusMarkers(streamed);
        for (const m of markers.slice(reportedStatuses)) {
          input.onProgress?.(m);
          input.onStatus?.(m.message);
        }
        reportedStatuses = markers.length;
        // Surface the prose as it arrives; the code blocks are reported
        // separately as files land, and the markers are not prose.
        input.onProse?.(stripStatusMarkers(stripCodeBlocks(streamed)));
        const open = (streamed.match(/```/g) ?? []).length;
        if (open % 2 === 1) {
          const name = /```[^\n]*?([A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)/.exec(
            streamed.slice(streamed.lastIndexOf("```")),
          )?.[1];
          // Once per file, not once per chunk: this fired on every delta, so
          // "Writing app.js…" appeared nine times in a row.
          if (name && name !== lastFileReported) {
            lastFileReported = name;
            report("implementing", `Writing ${name}…`);
          }
        }
      },
    });
    messages.push({ role: "assistant", content: reply });

    const produced = parseGeneratedFiles(reply, dir);
    if (produced.length === 0) {
      // A build request that comes back as prose is the model deferring —
      // asking permission, proposing stages, or declining because an API key
      // is missing. Observed live on a long, highly-detailed spec: the reply
      // was a plan ending in "Do you want me to build Stage 1 now?", which
      // parsed to zero files and surfaced as an empty turn with nothing to
      // preview. Push back once and make it build; only then fall through to
      // treating the reply as conversation.
      if (input.mode !== "review" && !forcedBuild) {
        forcedBuild = true;
        report("implementing", "That came back without any code — asking again…");
        messages.push({
          role: "user",
          content:
            "You did not produce any files. Do not ask questions, propose stages, or explain what you would do. Build it now and return the COMPLETE contents of every file you change in fenced code blocks, each fence labelled with its path. If the request is too large for one reply, build the most valuable slice that RUNS and say in one sentence what comes next.",
        });
        continue;
      }
      // No files: treat it as conversation, not a failed build.
      issues = validateApp(files, dir, input.context?.target);
      break;
    }

    const applied = applyFiles(files, produced);
    files = applied.files;
    changed = [...new Set([...changed, ...applied.changed])];
    for (const path of applied.changed) input.onFile?.(path);

    report("validating", "Checking it runs…");
    issues = validateApp(files, dir, input.context?.target);
    const problem = issuesForModel(issues);

    // Static checks first. They are instant and catch the obvious breakages,
    // so there is no sense spending a minute of build time to be told the
    // same thing more slowly.
    if (!problem && input.runBuild) {
      report("validating", "Installing dependencies, building and running the tests…");
      build = await input.runBuild(files);
      const failure = buildFeedback(build);
      if (!failure) break;
      if (round === MAX_REPAIR_ROUNDS) break;
      repaired++;
      messages.push({ role: "user", content: failure });
      continue;
    }
    if (!problem) break;

    if (round === MAX_REPAIR_ROUNDS) break; // hand back with issues surfaced
    repaired++;
    messages.push({ role: "user", content: problem });
  }

  return {
    files,
    changed,
    history: messages,
    issues,
    reply: stripStatusMarkers(stripCodeBlocks(reply)),
    repaired,
    build,
  };
}

// The keyword classifier that used to live here is gone. It routed on a
// regular expression — any message without a "building verb" that opened
// with "review" was a review, everything else was a build — so "hello" set
// the status to "Planning the app…" and went looking for files to write.
// Intent is now read from meaning by classifyIntent() in ./intent.ts.

/** The prose around the code, for the chat transcript. */
export function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
