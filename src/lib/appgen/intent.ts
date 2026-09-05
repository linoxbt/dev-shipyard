import type { ChatMessage } from "../ai";

// What the user actually wants, decided before anything is built.
//
// The builder used to route on a regular expression: any message without a
// "building verb" that opened with "review" was a code review, and everything
// else was a build. So "hello" set the status to "Planning the app…" and went
// looking for files to write. The status was a lie before the model had been
// asked anything at all.
//
// Intent is now read from meaning. One model call decides the mode AND, when
// the answer is simply an answer, writes it, so a greeting costs a single
// round trip rather than a build pipeline.

export type TurnMode = "converse" | "build" | "review";

/** What the agent is genuinely doing. Not a fixed sequence: each value is only
 *  ever set at the moment the corresponding work is actually happening. */
export type AgentState =
  | "understanding"
  | "conversational"
  | "asking_clarification"
  | "inspecting"
  | "planning"
  | "implementing"
  | "validating"
  | "debugging"
  | "reviewing"
  | "completing";

export interface AgentProgress {
  state: AgentState;
  /** Written for this turn, describing this action. Never a fixed label. */
  message: string;
  timestamp: number;
}

export interface IntentResult {
  mode: TurnMode;
  /** The model's own words for what it understood: shown while it works. */
  understanding: string;
  /** Present only for `converse`: the whole answer, already written. */
  reply?: string;
  /** True when the request cannot be acted on without an answer first. */
  needsClarification: boolean;
}

/** Describes the project so intent can be judged against what exists: "make
 *  the cards smaller" is a modification when there is something to modify and a
 *  vague idea when there is not. */
export function projectSummary(files: Record<string, string>): string {
  const paths = Object.keys(files).filter((p) => !p.endsWith("/"));
  if (paths.length === 0) return "There is no app yet: nothing has been built in this project.";
  return [
    `The project currently has ${paths.length} file(s):`,
    paths
      .slice(0, 40)
      .map((p) => `  ${p}`)
      .join("\n"),
  ].join("\n");
}

const SYSTEM = `You are the router for DevStation's App Builder. Decide what the user's
message actually calls for, then respond with a single JSON object and nothing else.

{
  "mode": "converse" | "build" | "review",
  "understanding": "one short sentence describing what you take the user to mean",
  "reply": "your full answer: ONLY when mode is converse",
  "needsClarification": true | false
}

mode meanings:
- "converse": a greeting, a question, an explanation, brainstorming, feedback,
  a comment, or a request so under-specified that building would be guessing.
  Put your entire natural answer in "reply". Do not write code.
- "build": the user wants an app created, changed, extended, fixed or deployed.
- "review": the user is asking you to look over existing code and report back
  WITHOUT changing it.

Judge by meaning and by the conversation so far, never by keywords. "Hello" is
converse. "Make the cards smaller" is build when an app exists, and a question
about what they mean when nothing has been built. A long specification is build.
"Any bugs in this?" is review.

Set needsClarification true only when you genuinely cannot proceed without an
answer, and then put the question in "reply" with mode "converse". Prefer making
a sensible decision over asking. Ask when necessary, infer when possible.

"reply" is what the user reads: answer them directly, in their language, without
narrating your own reasoning. Return only the JSON object.`;

/** Pull the JSON object out of a reply that may be fenced or padded. */
export function parseIntent(raw: string): IntentResult | null {
  const text = raw.replace(/```(?:json)?/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const mode = o.mode === "build" || o.mode === "review" ? o.mode : "converse";
    const understanding = typeof o.understanding === "string" ? o.understanding.trim() : "";
    const reply = typeof o.reply === "string" ? o.reply.trim() : undefined;
    // A converse turn with no reply would render as an empty message, which is
    // worse than the old behaviour; treat it as unusable so the caller falls
    // back rather than showing nothing.
    if (mode === "converse" && !reply) return null;
    return {
      mode,
      understanding,
      reply,
      needsClarification: o.needsClarification === true,
    };
  } catch {
    return null;
  }
}

export interface ClassifyInput {
  prompt: string;
  history: ChatMessage[];
  files: Record<string, string>;
  chat: (opts: {
    system: string;
    messages: ChatMessage[];
    signal?: AbortSignal;
    onDelta: (chunk: string) => void;
  }) => Promise<string>;
  signal?: AbortSignal;
}

/** Decide the mode. Falls back to "build" when the router cannot be reached or
 *  answers unusably: a user who asked for an app and gets one is better served
 *  than one who gets an error because the router failed. */
export async function classifyIntent(input: ClassifyInput): Promise<IntentResult> {
  const context = projectSummary(input.files);
  const messages: ChatMessage[] = [
    ...input.history.slice(-8),
    { role: "user", content: `${context}\n\nThe user says:\n${input.prompt}` },
  ];
  try {
    const raw = await input.chat({
      system: SYSTEM,
      messages,
      signal: input.signal,
      onDelta: () => {
        /* the router's own output is never shown; only its decision is used */
      },
    });
    return (
      parseIntent(raw) ?? {
        mode: "build",
        understanding: "",
        needsClarification: false,
      }
    );
  } catch {
    return { mode: "build", understanding: "", needsClarification: false };
  }
}

// --- progress the model writes itself ----------------------------------------
//
// Status text used to be a fixed sequence written into the app: "Planning the
// app…", then "Writing code…", then "Checking it runs…". Those fired whether or
// not they described anything real, and replacing them with a different fixed
// sequence would be the same mistake with new words.
//
// The model now narrates its own work by emitting markers as it goes, which are
// pulled out of the stream, shown live, and stripped from the visible prose:
//
//   <status state="inspecting">Looking at the existing components first.</status>
//
// The message is written for THIS turn about THIS action, so it varies with the
// work instead of stepping through a script.

export const STATUS_PROTOCOL = `While you work, narrate what you are ACTUALLY doing by emitting
status markers on their own line, as often as the work genuinely changes:

<status state="STATE">a short sentence about what you are doing right now</status>

STATE is one of: understanding, inspecting, planning, implementing, validating,
debugging, reviewing, optimizing, completing.

Rules:
- Emit one only when what you are doing has actually changed. A one-step task
  needs one; a long task earns several. Never pad them to look busy.
- Say what is specific to THIS task, which file, which decision, which problem.
  "I'm reusing the existing card component rather than adding another pattern"
  is useful. "Working…", "Processing…", "Planning your app…" are not.
- Never claim an action you are not performing. If you are not testing, do not
  say you are testing.
- Do not reveal private reasoning. Say what you are doing and why it matters.
- The markers are stripped from your visible reply, so do not repeat them in
  your prose.`;

const STATUS_RE = /<status\s+state="([a-z_]+)"\s*>([\s\S]*?)<\/status>/gi;

const KNOWN: ReadonlySet<string> = new Set<AgentState>([
  "understanding",
  "conversational",
  "asking_clarification",
  "inspecting",
  "planning",
  "implementing",
  "validating",
  "debugging",
  "reviewing",
  "completing",
]);

/** Pull complete markers out of accumulated stream text.
 *
 *  Only CLOSED markers are returned, so a half-arrived tag is never shown as a
 *  truncated status. Callers pass the text seen so far and skip what they have
 *  already reported. */
export function parseStatusMarkers(text: string): AgentProgress[] {
  const out: AgentProgress[] = [];
  for (const m of text.matchAll(STATUS_RE)) {
    const state = m[1].toLowerCase();
    const message = m[2].replace(/\s+/g, " ").trim();
    if (!message) continue;
    out.push({
      // An unrecognised state still carries a real message, so it is shown
      // under a neutral state rather than dropped.
      state: (KNOWN.has(state) ? state : "implementing") as AgentState,
      message,
      timestamp: Date.now(),
    });
  }
  return out;
}

/** The reply as the user should read it: markers removed, including one left
 *  unterminated by a cut-off stream. */
export function stripStatusMarkers(text: string): string {
  return text
    .replace(STATUS_RE, "")
    .replace(/<status\s+state="[a-z_]*"?\s*>[\s\S]*$/i, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
