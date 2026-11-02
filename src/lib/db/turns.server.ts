// One row per agent turn, for the site's stats.
//
// Reported by the sandbox when a turn ends (routes/api.model.turn.ts), and as
// a fallback when a poll shows a finished turn. (workspace, turn) is unique,
// so the two never make two rows. Spend is NOT taken from here: it is metered
// per model call where the keys are (routes/api.model.ts → model_usage).

import { isPremiumModel } from "@/lib/coding-agent/models";
import { dbConfigured, insert } from "./admin.server";

const DONE = new Set(["idle", "error", "cancelled"]);
const recorded = new Set<string>();

export interface TurnRow {
  owner: string;
  workspace: string;
  turn: number;
  model: string;
  phase: "idle" | "error" | "cancelled";
  steps: number;
  costUsd: number;
  changed: number;
  plan: boolean;
}

/** Write a turn once. Never throws. */
export async function recordTurnRow(row: TurnRow): Promise<void> {
  if (!dbConfigured()) return;
  const key = `${row.workspace}#${row.turn}`;
  if (recorded.has(key)) return;
  const model = row.model.slice(0, 60) || "auto";
  try {
    await insert(
      "agent_turns",
      {
        owner: row.owner,
        workspace: row.workspace.slice(0, 120),
        turn: row.turn,
        model,
        mode: row.plan ? "plan" : "build",
        phase: row.phase,
        steps: Math.max(0, Math.floor(row.steps) || 0),
        cost_usd: Math.max(0, row.costUsd || 0),
        files_changed: Math.max(0, Math.floor(row.changed) || 0),
        premium: isPremiumModel(model),
      },
      { ignoreDuplicates: true, onConflict: "workspace,turn" },
    );
    recorded.add(key);
    if (recorded.size > 5000) recorded.clear();
  } catch {
    // The report or the next poll writes it.
  }
}

interface View {
  phase?: unknown;
  turns?: unknown;
  lastTurn?: {
    model?: unknown;
    plan?: unknown;
    steps?: unknown;
    costUsd?: unknown;
    changed?: unknown;
    by?: unknown;
  };
}

/** The fallback: a poll that sees a finished turn. The turn is credited to
 *  the account that sent it (lastTurn.by), never to whoever is polling. */
export async function recordTurn(
  poller: string | null,
  workspace: string,
  view: unknown,
): Promise<void> {
  if (!poller || !view || typeof view !== "object") return;
  const v = view as View;
  const phase = String(v.phase ?? "");
  const turn = Number(v.turns ?? 0);
  if (!DONE.has(phase) || !Number.isInteger(turn) || turn < 1 || !v.lastTurn) return;
  const by = typeof v.lastTurn.by === "string" && v.lastTurn.by ? v.lastTurn.by : poller;
  await recordTurnRow({
    owner: by,
    workspace,
    turn,
    model: typeof v.lastTurn.model === "string" ? v.lastTurn.model : "auto",
    phase: phase as TurnRow["phase"],
    steps: Number(v.lastTurn.steps) || 0,
    costUsd: Number(v.lastTurn.costUsd) || 0,
    changed: Number(v.lastTurn.changed) || 0,
    plan: v.lastTurn.plan === true,
  });
}
