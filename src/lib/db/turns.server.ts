// One row per agent turn, for the stats and for launch credit spending.
//
// Written when a poll shows a turn has finished (the runner keeps the turn's
// own model, cost and steps in `lastTurn`). The (workspace, turn) key makes a
// second poll of the same finished turn a no-op, and only this server can
// write the table, so nobody can record a cheaper turn for themselves.

import { isPremiumModel } from "@/lib/coding-agent/models";
import { dbConfigured, insert } from "./admin.server";

const DONE = new Set(["idle", "error", "cancelled"]);
const recorded = new Set<string>();

interface View {
  phase?: unknown;
  turns?: unknown;
  lastTurn?: {
    model?: unknown;
    plan?: unknown;
    steps?: unknown;
    costUsd?: unknown;
    changed?: unknown;
  };
}

export async function recordTurn(
  owner: string | null,
  workspace: string,
  view: unknown,
): Promise<void> {
  if (!owner || !dbConfigured() || !view || typeof view !== "object") return;
  const v = view as View;
  const phase = String(v.phase ?? "");
  const turn = Number(v.turns ?? 0);
  if (!DONE.has(phase) || !Number.isInteger(turn) || turn < 1 || !v.lastTurn) return;
  const key = `${workspace}#${turn}`;
  if (recorded.has(key)) return;
  const model = typeof v.lastTurn.model === "string" ? v.lastTurn.model.slice(0, 60) : "auto";
  try {
    await insert(
      "agent_turns",
      {
        owner,
        workspace: workspace.slice(0, 120),
        turn,
        model,
        mode: v.lastTurn.plan === true ? "plan" : "build",
        phase,
        steps: Math.max(0, Math.floor(Number(v.lastTurn.steps) || 0)),
        cost_usd: Math.max(0, Number(v.lastTurn.costUsd) || 0),
        files_changed: Math.max(0, Math.floor(Number(v.lastTurn.changed) || 0)),
        premium: isPremiumModel(model),
      },
      { ignoreDuplicates: true },
    );
    recorded.add(key);
    if (recorded.size > 5000) recorded.clear();
  } catch {
    // A missed row is retried by the next poll.
  }
}
