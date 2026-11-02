// The pass a sandbox shows to use a model for one turn (routes/api.model.ts).
//
// Model keys never enter a sandbox: the sandbox calls this site, which holds
// the keys, checks the plan and records the spend. The pass names who sent
// the message (so spend lands on them, not on whoever happens to be watching),
// the workspace, and the one model they were allowed, and it expires soon
// after the longest turn can run. It is sealed with the server's own key, so
// it cannot be made or altered outside this server; a person who reads it out
// of their own sandbox can only spend their own allowance on that model.

import { openToken, sealToken } from "./connectors.server";

export interface TurnPass {
  /** Account that sent the message. */
  owner: string;
  /** Workspace id, when known (a turn that creates its workspace has none yet). */
  workspace: string;
  /** Model id from the picker ("auto" for the default). */
  model: string;
  /** Expiry, ms since epoch. */
  expires: number;
  /** When the first pass of this run was made: a renewed pass keeps it, so
   *  renewing has an end (MAX_RENEWED_MS). */
  started: number;
}

/** How long a pass can be renewed for, from its first one: work that runs
 *  with nobody watching still ends. */
export const MAX_RENEWED_MS = 8 * 60 * 60_000;

/** A pass lasts this long, and the sandbox renews it every few minutes while
 *  it has work (routes/api.model.heartbeat.ts), so a long run keeps going and
 *  a pass read out of a sandbox stops working soon after the work does. */
export const TURN_PASS_MS = 40 * 60_000;

export function mintTurnPass(
  pass: Omit<TurnPass, "expires" | "started"> & { started?: number },
  now = Date.now(),
): string {
  return sealToken(
    JSON.stringify({
      t: "turn",
      o: pass.owner,
      w: pass.workspace,
      m: pass.model,
      s: pass.started ?? now,
      x: now + TURN_PASS_MS,
    }),
  );
}

/** A fresh pass for the same account, workspace and model, or null when this
 *  one has been renewed for as long as any may be. */
export function renewTurnPass(pass: TurnPass, now = Date.now()): string | null {
  if (now - pass.started > MAX_RENEWED_MS) return null;
  return mintTurnPass(
    { owner: pass.owner, workspace: pass.workspace, model: pass.model, started: pass.started },
    now,
  );
}

export function readTurnPass(token: string | null | undefined, now = Date.now()): TurnPass | null {
  if (!token || token.length > 4000) return null;
  const raw = openToken(token);
  if (!raw) return null;
  try {
    const body = JSON.parse(raw) as {
      t?: unknown;
      o?: unknown;
      w?: unknown;
      m?: unknown;
      x?: unknown;
      s?: unknown;
    };
    if (body.t !== "turn" || typeof body.o !== "string" || !body.o) return null;
    if (typeof body.x !== "number" || body.x < now) return null;
    return {
      owner: body.o,
      workspace: typeof body.w === "string" ? body.w : "",
      model: typeof body.m === "string" && body.m ? body.m : "auto",
      expires: body.x,
      started: typeof body.s === "number" ? body.s : body.x - TURN_PASS_MS,
    };
  } catch {
    return null;
  }
}

/** The pass from an Authorization header. */
export function passFromRequest(request: Request): TurnPass | null {
  const header = request.headers.get("authorization") ?? "";
  return readTurnPass(header.startsWith("Bearer ") ? header.slice(7).trim() : null);
}
