// Read-only sessions for the dashboard.
//
// Deliberately a different credential from RUNNER_TOKEN. That token authorises
// POST /jobs, which runs code; a dashboard is a browser surface with cookies
// and a rendered page, and giving it the same authority would mean any leak of
// a viewing session became a leak of code execution. A dashboard session can
// read and nothing else: the job route never accepts one.

import { randomBytes, timingSafeEqual } from "node:crypto";

/** How long a login lasts before it has to be done again. */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Failed logins allowed per window, per client. The password is the only
 *  thing between the internet and this page. */
export const LOGIN_ATTEMPTS = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export const COOKIE_NAME = "devstation_dash";

const sessions = new Map<string, number>();

function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    // Compare something of equal length anyway, so a wrong length does not
    // return measurably faster than a wrong value.
    timingSafeEqual(right, right);
    return false;
  }
  return timingSafeEqual(left, right);
}

export function passwordMatches(given: string, expected: string): boolean {
  if (!expected || !given) return false;
  return constantTimeEquals(given, expected);
}

export function createSession(): string {
  const id = randomBytes(32).toString("base64url");
  sessions.set(id, Date.now() + SESSION_TTL_MS);
  return id;
}

export function validSession(id: string | undefined): boolean {
  if (!id) return false;
  const expires = sessions.get(id);
  if (expires === undefined) return false;
  if (Date.now() > expires) {
    sessions.delete(id);
    return false;
  }
  return true;
}

export function endSession(id: string | undefined): void {
  if (id) sessions.delete(id);
}

/** Pull one cookie out of a request header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return undefined;
}

/** Secure and httpOnly so script cannot read it and it never crosses plain
 *  HTTP; SameSite=Strict so another site cannot ride the session. */
export function sessionCookie(id: string): string {
  return `${COOKIE_NAME}=${id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`;
}

export function clearedCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

/** Only for tests. */
export function resetSessions(): void {
  sessions.clear();
}
