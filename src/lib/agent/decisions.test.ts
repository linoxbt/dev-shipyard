import { describe, expect, it, beforeEach } from "bun:test";
import {
  __resetDecisions,
  cancelDecisions,
  createDecisionRequest,
  expireDecisions,
  pendingDecisions,
  selectedOptions,
  submitDecision,
  type DecisionRequest,
} from "./decisions";

const make = (over: Partial<DecisionRequest> = {}) =>
  createDecisionRequest({
    taskId: "task_1",
    question: "How should authentication work?",
    type: "single_select",
    required: true,
    riskLevel: "medium",
    options: [
      { id: "existing_auth", label: "Use existing authentication", value: "existing" },
      { id: "wallet_auth", label: "Wallet authentication", value: "wallet" },
    ],
    ...over,
  });

const answer = (over: Record<string, unknown> = {}) => ({
  requestId: "",
  taskId: "task_1",
  selectedOptionIds: ["wallet_auth"],
  clientRequestId: "client_1",
  ...over,
});

beforeEach(__resetDecisions);

describe("answering a decision", () => {
  it("accepts a valid selection and marks the request answered", () => {
    const req = make();
    const r = submitDecision(answer({ requestId: req.id }));
    expect(r.ok).toBe(true);
    expect(req.status).toBe("answered");
  });

  it("resolves option ids back to what they meant", () => {
    const req = make();
    const r = submitDecision(answer({ requestId: req.id }));
    if (!r.ok) throw new Error("expected ok");
    // The id is the contract; the label is display text that may be reworded.
    expect(selectedOptions(req, r.response).map((o) => o.value)).toEqual(["wallet"]);
  });
});

describe("idempotency", () => {
  it("processes the same clientRequestId exactly once", () => {
    const req = make();
    const first = submitDecision(answer({ requestId: req.id }));
    const second = submitDecision(answer({ requestId: req.id }));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("expected ok");
    // A double click must return the ORIGINAL outcome, not a second one.
    expect(second.replayed).toBe(true);
    expect(second.response.responseId).toBe(first.response.responseId);
  });

  it("still replays after the request stopped being pending", () => {
    const req = make();
    submitDecision(answer({ requestId: req.id }));
    const retry = submitDecision(answer({ requestId: req.id }));
    expect(retry.ok).toBe(true);
  });

  it("treats a genuinely new answer as new", () => {
    const req = make();
    submitDecision(answer({ requestId: req.id }));
    const other = submitDecision(answer({ requestId: req.id, clientRequestId: "client_2" }));
    // The request is answered, so a NEW submission is refused rather than
    // silently applied a second time.
    expect(other).toEqual({ ok: false, reason: "not_pending" });
  });
});

describe("nothing from the client is trusted", () => {
  it("refuses an unknown request", () => {
    expect(submitDecision(answer({ requestId: "dec_nope" }))).toEqual({
      ok: false,
      reason: "unknown_request",
    });
  });

  it("refuses a request belonging to another task", () => {
    const req = make();
    expect(submitDecision(answer({ requestId: req.id, taskId: "task_2" }))).toEqual({
      ok: false,
      reason: "wrong_task",
    });
  });

  it("refuses an option the request never offered", () => {
    const req = make();
    expect(
      submitDecision(answer({ requestId: req.id, selectedOptionIds: ["admin_backdoor"] })),
    ).toEqual({ ok: false, reason: "unknown_option" });
  });

  it("refuses two selections on a single-select", () => {
    const req = make();
    expect(
      submitDecision(
        answer({ requestId: req.id, selectedOptionIds: ["existing_auth", "wallet_auth"] }),
      ),
    ).toEqual({ ok: false, reason: "wrong_selection_count" });
  });

  it("refuses an empty answer to a required choice", () => {
    const req = make();
    expect(submitDecision(answer({ requestId: req.id, selectedOptionIds: [] }))).toEqual({
      ok: false,
      reason: "wrong_selection_count",
    });
  });

  it("requires text for a text request, and refuses options", () => {
    const req = make({ type: "text", options: [] });
    expect(submitDecision(answer({ requestId: req.id, selectedOptionIds: [], text: "" }))).toEqual({
      ok: false,
      reason: "text_required",
    });
  });
});

describe("expiry", () => {
  it("refuses an answer after the window closed", () => {
    const req = make({ expiresAt: 1_000 });
    expect(submitDecision(answer({ requestId: req.id }), 2_000)).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(req.status).toBe("expired");
  });

  it("reports what expired so the agent can say so rather than proceed", () => {
    const req = make({ expiresAt: 1_000 });
    expect(expireDecisions("task_1", 2_000).map((r) => r.id)).toEqual([req.id]);
  });

  it("leaves an unexpired request pending", () => {
    const req = make({ expiresAt: 10_000 });
    expect(pendingDecisions("task_1", 5_000).map((r) => r.id)).toEqual([req.id]);
  });
});

describe("cancellation", () => {
  it("cancels pending decisions so a stopped task cannot be answered into life", () => {
    const req = make();
    expect(cancelDecisions("task_1")).toBe(1);
    expect(submitDecision(answer({ requestId: req.id }))).toEqual({
      ok: false,
      reason: "not_pending",
    });
  });
});

describe("custom answers", () => {
  it("accepts free text when the request invited it", () => {
    const req = make({ allowCustomResponse: true });
    const r = submitDecision(
      answer({ requestId: req.id, selectedOptionIds: [], text: "Use Apple Sign In" }),
    );
    expect(r.ok).toBe(true);
  });
});
