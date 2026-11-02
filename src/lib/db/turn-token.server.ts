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
}

/** A turn runs for 20 minutes at most; this leaves room for a queued start. */
export const TURN_PASS_MS = 40 * 60_000;

export function mintTurnPass(pass: Omit<TurnPass, "expires">, now = Date.now()): string {
  return sealToken(
    JSON.stringify({
      t: "turn",
      o: pass.owner,
      w: pass.workspace,
      m: pass.model,
      x: now + TURN_PASS_MS,
    }),
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
    };
    if (body.t !== "turn" || typeof body.o !== "string" || !body.o) return null;
    if (typeof body.x !== "number" || body.x < now) return null;
    return {
      owner: body.o,
      workspace: typeof body.w === "string" ? body.w : "",
      model: typeof body.m === "string" && body.m ? body.m : "auto",
      expires: body.x,
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
