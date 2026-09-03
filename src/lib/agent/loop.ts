// The bounded tool loop.
//
// Before this, a turn could only do one thing: write the files it had already
// decided on. It could not look at anything first. The whole project is put in
// the briefing, so it was not blind — but it could not grep, could not re-read
// a file after changing it, and could not run the tests without also rebuilding
// everything. Every question it had, it had to answer by guessing.
//
// The protocol is a marker, matching <status> and <delete> rather than adding a
// third shape, and deliberately not the provider's native tool-calling: the
// identical turn logic runs in the browser against /api/ai and in the runner
// against the provider directly, and a text protocol works the same in both.
//
// Two budgets, because they fail differently. A step ceiling stops a model that
// keeps looking things up instead of answering. A wall-clock budget stops one
// whose individual calls are slow — four fast reads and four full builds are
// the same number of steps and nothing like the same wait.

/** What the model is told about calling tools. */
export const TOOL_PROTOCOL = `# Looking before you write

You may inspect the project before answering. Emit a call on its own line:

<tool name="read_file">{"path": "app/app.js"}</tool>

Available: list_files {}, read_file {"path"}, search_files {"query"},
run_tests {}, run_build {}.

The result comes back as an observation and you may then call another or
answer. Use this when you genuinely do not know something — not to confirm what
the project state above already tells you. Do NOT mix tool calls and file blocks
in the same reply: do one or the other.`;

export interface ToolCallRequest {
  id: string;
  name: string;
  /** Raw text between the tags, parsed to args. Invalid JSON is passed through
   *  as {} so preflight rejects it with a validation error the model can read
   *  and correct, rather than being silently dropped. */
  args: Record<string, unknown>;
  /** True when the payload was not JSON, so the observation can say so. */
  malformed: boolean;
}

const TOOL_MARKER = /<tool\s+name=("|')([a-z_]+)\1\s*>([\s\S]*?)<\/tool\s*>/gi;

export function parseToolCalls(text: string): ToolCallRequest[] {
  const out: ToolCallRequest[] = [];
  const re = new RegExp(TOOL_MARKER.source, "gi");
  let m: RegExpExecArray | null;
  let n = 0;

  while ((m = re.exec(text)) !== null) {
    const name = (m[2] ?? "").toLowerCase();
    const body = (m[3] ?? "").trim();
    let args: Record<string, unknown> = {};
    let malformed = false;
    if (body) {
      try {
        const parsed: unknown = JSON.parse(body);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>;
        } else {
          malformed = true;
        }
      } catch {
        malformed = true;
      }
    }
    out.push({ id: `call-${++n}`, name, args, malformed });
  }
  return out;
}

/** Remove calls from prose, including one the stream cut off mid-tag. */
export function stripToolCalls(text: string): string {
  return text
    .replace(new RegExp(TOOL_MARKER.source, "gi"), "")
    .replace(/<tool\b[\s\S]*$/i, "")
    .replace(/[ \t]+$/gm, "");
}

/** How much looking around one turn may do.
 *
 *  Small on purpose. This is for answering a question the briefing does not,
 *  not for exploring; a turn that needs more than a handful of lookups is
 *  usually one that has misunderstood the request. */
export interface LoopBudget {
  maxSteps: number;
  maxMs: number;
}

export const DEFAULT_BUDGET: LoopBudget = { maxSteps: 4, maxMs: 90_000 };

export type BudgetState = { steps: number; startedAt: number };

export function budgetSpent(
  state: BudgetState,
  budget: LoopBudget,
  now = Date.now(),
): { spent: boolean; why: string } {
  if (state.steps >= budget.maxSteps) {
    return {
      spent: true,
      why: `You have used all ${budget.maxSteps} of your lookups for this turn.`,
    };
  }
  if (now - state.startedAt >= budget.maxMs) {
    return {
      spent: true,
      why: `You have used all the time available for looking things up this turn.`,
    };
  }
  return { spent: false, why: "" };
}

/** One tool's result, as the model sees it.
 *
 *  Named and delimited so a file whose contents happen to look like a reply
 *  cannot be mistaken for one. The content itself is wrapped as untrusted by
 *  presentResult before it reaches here. */
export function formatObservation(name: string, output: string): string {
  return [`Result of ${name}:`, output].join("\n");
}

/** What the model is told when its lookups produced nothing usable. */
export function observationsMessage(parts: string[], closing?: string): string {
  return [...parts, ...(closing ? ["", closing] : [])].join("\n\n");
}
