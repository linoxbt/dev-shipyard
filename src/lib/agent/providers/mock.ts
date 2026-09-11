import {
  EMPTY_USAGE,
  type GenerateInput,
  type ModelProvider,
  type ProviderResult,
  type ProviderToolCall,
} from "./types";

// A provider that answers from a script instead of a model.
//
// This is what makes the rest of the agent testable. Every other component,
// the loop, the policy gate, the approval pause and the audit trail, can be
// exercised deterministically and offline, with no key and no spend, because
// the only non-deterministic part of the system has been replaced by a list.
//
// It is not a stub that returns nothing: it records what it was asked, so a
// test can assert on the system prompt, the tool list and the exact messages
// the orchestrator built, which is usually the thing actually worth checking.

export interface MockTurn {
  text?: string;
  toolCalls?: ProviderToolCall[];
  stopReason?: ProviderResult["stopReason"];
}

export class MockProvider implements ModelProvider {
  readonly name = "mock";
  readonly model = "mock-model";
  /** Every call it received, in order. */
  readonly calls: GenerateInput[] = [];
  private index = 0;

  constructor(private readonly script: MockTurn[]) {}

  /** How many turns have been consumed, so a test can assert the loop stopped
   *  when it should have rather than merely produced the right answer. */
  get turnsUsed(): number {
    return this.index;
  }

  async generate(input: GenerateInput): Promise<ProviderResult> {
    // Recorded as a copy. The orchestrator keeps pushing to the same messages
    // array as the run goes on, so holding the reference would mean every
    // recorded call ended up showing the final transcript rather than what was
    // actually sent at that point.
    this.calls.push({ ...input, messages: [...input.messages] });
    // Past the end of the script, keep returning the last turn. A loop bug
    // then shows up as "too many turns", not as an exception that could be
    // mistaken for the thing under test.
    const turn = this.script[Math.min(this.index, this.script.length - 1)] ?? {};
    this.index++;

    const text = turn.text ?? "";
    if (text && input.onDelta) {
      // Delivered in pieces, because code that only ever sees one delta tends
      // to mishandle the real thing.
      for (const chunk of text.match(/.{1,24}/gs) ?? []) input.onDelta(chunk);
    }

    return {
      text,
      toolCalls: turn.toolCalls ?? [],
      stopReason: turn.stopReason ?? (turn.toolCalls?.length ? "tool_use" : "end_turn"),
      model: this.model,
      usage: { ...EMPTY_USAGE, inputTokens: 100, outputTokens: 50 },
    };
  }
}
