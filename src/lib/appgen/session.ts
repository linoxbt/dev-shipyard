// The App Builder's conversation.
//
// A build is a conversation, not a one-shot: you describe an app, look at it,
// and say what is wrong. So the model keeps the full history, and each turn is
// given the things it cannot see for itself — which files currently exist,
// what the validator found, and any error the running preview reported.
//
// That last part is the difference between "the preview is blank" and a fix:
// the agent is told the actual exception, so it does not have to guess.

import { chatStream, type ChatMessage } from "@/lib/ai";
import { appBuilderSystemPrompt, parseGeneratedFiles, type PromptContext } from "./prompt";
import { issuesForModel, validateApp, type ValidationIssue } from "./validate";
import type { PreviewError } from "./preview";

/** How many auto-repair rounds a single turn may take before handing back. */
export const MAX_REPAIR_ROUNDS = 2;

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
  /** Live prose from the model, so the chat reads as it thinks rather than
   *  sitting on a spinner. */
  onProse?: (text: string) => void;
  /** Fired as each file is written, so progress is visible file by file. */
  onFile?: (path: string) => void;
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
}

/** What the model is told about the state it cannot see. */
export function stateBriefing(
  files: Record<string, string>,
  previewErrors: PreviewError[] = [],
  dir = "app",
): string {
  const prefix = dir ? `${dir}/` : "";
  const names = Object.keys(files)
    .filter((p) => p.startsWith(prefix))
    .map((p) => p.slice(prefix.length));

  const parts: string[] = [];
  if (names.length) parts.push(`Current files: ${names.join(", ")}.`);

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
  const dir = input.dir ?? "app";
  const system = appBuilderSystemPrompt(input.context ?? {});

  const briefing = stateBriefing(input.files, input.previewErrors, dir);
  const messages: ChatMessage[] = [
    ...input.history,
    { role: "user", content: briefing ? `${briefing}\n\n---\n\n${input.prompt}` : input.prompt },
  ];

  let files = input.files;
  let reply = "";
  let changed: string[] = [];
  let issues: ValidationIssue[] = [];
  let repaired = 0;

  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    if (round > 0) input.onStatus?.(`Fixing what would not run (${round}/${MAX_REPAIR_ROUNDS})…`);
    input.onStatus?.(
      round === 0
        ? "Planning the app…"
        : `Fixing what would not run (${round}/${MAX_REPAIR_ROUNDS})…`,
    );
    let streamed = "";
    reply = await chatStream({
      system,
      messages,
      signal: input.signal,
      onDelta: (chunk) => {
        streamed += chunk;
        input.onDelta?.(chunk);
        // Surface the prose as it arrives; the code blocks are reported
        // separately as files land.
        input.onProse?.(stripCodeBlocks(streamed));
        const open = (streamed.match(/```/g) ?? []).length;
        if (open % 2 === 1) {
          const name = /```[^\n]*?([A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)/.exec(
            streamed.slice(streamed.lastIndexOf("```")),
          )?.[1];
          if (name) input.onStatus?.(`Writing ${name}…`);
        }
      },
    });
    messages.push({ role: "assistant", content: reply });

    const produced = parseGeneratedFiles(reply, dir);
    if (produced.length === 0) {
      // No files: treat it as conversation, not a failed build.
      issues = validateApp(files, dir);
      break;
    }

    const applied = applyFiles(files, produced);
    files = applied.files;
    changed = [...new Set([...changed, ...applied.changed])];
    for (const path of applied.changed) input.onFile?.(path);

    input.onStatus?.("Checking it runs…");
    issues = validateApp(files, dir);
    const problem = issuesForModel(issues);
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
    reply: stripCodeBlocks(reply),
    repaired,
  };
}

/** The prose around the code, for the chat transcript. */
export function stripCodeBlocks(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
