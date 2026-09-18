import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// What a wallet is linked to: one GitHub account, one verified email.
//
// A GitHub session used to be a bare token in a cookie with no owner, so any
// wallet in a browser could push under whatever GitHub account happened to be
// signed in, and one GitHub account could be shared between wallets. The link
// is one-to-one in both directions and lives here, beside the other things the
// runner keeps for a wallet (published sites, marketplace activity).
//
// An email is proved with a six-digit code. Only a hash of the code is written
// down, so this file is useless to anyone who reads it.

export interface GithubLink {
  id: number;
  login: string;
  linkedAt: number;
}

export interface EmailLink {
  address: string;
  verifiedAt: number;
}

interface Challenge {
  address: string;
  codeHash: string;
  expiresAt: number;
  attempts: number;
  sentAt: number;
}

interface Account {
  github?: GithubLink;
  email?: EmailLink;
  pending?: Challenge;
}

/** What the browser is told. The challenge itself never leaves the runner. */
export interface AccountView {
  wallet: string;
  github: GithubLink | null;
  email: EmailLink | null;
  /** The address a code was sent to and not yet verified. */
  pendingEmail: string | null;
}

export const CODE_TTL_MS = 10 * 60_000;
export const MAX_ATTEMPTS = 5;
export const RESEND_MS = 60_000;

const WALLET = /^0x[a-fA-F0-9]{40}$/;
// Deliberately loose: an address is proved by a code arriving, not by a regex.
const EMAIL = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;

export function accountsFile(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.ACCOUNTS_FILE ?? join(env.STATE_DIRECTORY ?? "/var/lib/devstation-runner", "accounts.json")
  );
}

export function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase().slice(0, 254);
}

export type LinkError = "wallet_linked" | "github_linked" | "bad_request";
export type EmailError =
  | "invalid_email"
  | "email_taken"
  | "cooldown"
  | "no_pending"
  | "expired"
  | "too_many"
  | "wrong_code"
  | "bad_request";

export class AccountsStore {
  private readonly rows = new Map<string, Account>();

  constructor(
    private readonly file: string | null,
    private readonly secret = process.env.SESSION_SECRET ||
      process.env.RUNNER_TOKEN ||
      "devstation",
    private readonly now: () => number = Date.now,
  ) {
    if (!file || !existsSync(file)) return;
    try {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Record<string, Account>;
      for (const [wallet, account] of Object.entries(saved)) {
        if (WALLET.test(wallet)) this.rows.set(wallet.toLowerCase(), account);
      }
    } catch {
      // A damaged file starts empty rather than taking the runner down.
    }
  }

  view(wallet: string): AccountView {
    const row = this.row(wallet);
    const pending = row?.pending && row.pending.expiresAt > this.now() ? row.pending : undefined;
    return {
      wallet: wallet.toLowerCase(),
      github: row?.github ?? null,
      email: row?.email ?? null,
      pendingEmail: pending?.address ?? null,
    };
  }

  walletForGithub(id: number): string | null {
    for (const [wallet, row] of this.rows) if (row.github?.id === id) return wallet;
    return null;
  }

  walletForEmail(address: string): string | null {
    const wanted = normaliseEmail(address);
    for (const [wallet, row] of this.rows) if (row.email?.address === wanted) return wallet;
    return null;
  }

  /** True when this GitHub account is the one this wallet linked. What a push
   *  is checked against: without it the link is decoration. */
  githubMatches(wallet: string, id: number): boolean {
    return !!wallet && this.row(wallet)?.github?.id === id;
  }

  linkGithub(
    wallet: string,
    account: { id: number; login: string },
  ): { ok: true; view: AccountView } | { ok: false; error: LinkError; message: string } {
    if (!WALLET.test(wallet) || !Number.isFinite(account.id) || !account.login) {
      return {
        ok: false,
        error: "bad_request",
        message: "That is not a wallet and a GitHub account.",
      };
    }
    const key = wallet.toLowerCase();
    const row = this.rows.get(key);
    if (row?.github && row.github.id !== account.id) {
      return {
        ok: false,
        error: "wallet_linked",
        message: `This wallet is linked to @${row.github.login}. Unlink it first to connect a different GitHub account.`,
      };
    }
    const heldBy = this.walletForGithub(account.id);
    if (heldBy && heldBy !== key) {
      return {
        ok: false,
        error: "github_linked",
        message: `@${account.login} is already linked to another wallet.`,
      };
    }
    this.rows.set(key, {
      ...row,
      github: {
        id: account.id,
        login: account.login,
        // Re-connecting the same account keeps the date it was first linked.
        linkedAt: row?.github?.linkedAt ?? this.now(),
      },
    });
    this.save();
    return { ok: true, view: this.view(key) };
  }

  unlinkGithub(wallet: string): AccountView {
    const key = wallet.toLowerCase();
    const row = this.rows.get(key);
    if (row?.github) {
      const { github, ...rest } = row;
      void github;
      this.rows.set(key, rest);
      this.save();
    }
    return this.view(key);
  }

  /**
   * Starts proving an address. Returns the code for the caller to send; only
   * its hash is kept, so nothing readable here can verify an address.
   */
  startEmail(
    wallet: string,
    address: string,
  ):
    | { ok: true; code: string; address: string }
    | { ok: false; error: EmailError; message: string; retryIn?: number } {
    if (!WALLET.test(wallet)) {
      return { ok: false, error: "bad_request", message: "Connect a wallet first." };
    }
    const email = normaliseEmail(address);
    if (!EMAIL.test(email)) {
      return {
        ok: false,
        error: "invalid_email",
        message: "That does not look like an email address.",
      };
    }
    const key = wallet.toLowerCase();
    const heldBy = this.walletForEmail(email);
    if (heldBy && heldBy !== key) {
      return {
        ok: false,
        error: "email_taken",
        message: "That address is already verified by another wallet.",
      };
    }
    const row = this.rows.get(key);
    const now = this.now();
    if (row?.pending && now - row.pending.sentAt < RESEND_MS) {
      const retryIn = Math.ceil((RESEND_MS - (now - row.pending.sentAt)) / 1000);
      return {
        ok: false,
        error: "cooldown",
        message: `A code went out a moment ago. Try again in ${retryIn}s.`,
        retryIn,
      };
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.rows.set(key, {
      ...row,
      pending: {
        address: email,
        codeHash: this.hash(key, email, code),
        expiresAt: now + CODE_TTL_MS,
        attempts: 0,
        sentAt: now,
      },
    });
    this.save();
    return { ok: true, code, address: email };
  }

  verifyEmail(
    wallet: string,
    code: string,
  ):
    | { ok: true; view: AccountView }
    | { ok: false; error: EmailError; message: string; left?: number } {
    const key = wallet.toLowerCase();
    const row = this.rows.get(key);
    const pending = row?.pending;
    if (!row || !pending) {
      return { ok: false, error: "no_pending", message: "Ask for a code first." };
    }
    const now = this.now();
    if (pending.expiresAt <= now) {
      this.clearPending(key);
      return { ok: false, error: "expired", message: "That code has expired. Ask for another." };
    }
    if (pending.attempts >= MAX_ATTEMPTS) {
      this.clearPending(key);
      return { ok: false, error: "too_many", message: "Too many tries. Ask for a new code." };
    }
    const given = this.hash(key, pending.address, String(code).trim());
    const a = Buffer.from(given);
    const b = Buffer.from(pending.codeHash);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      pending.attempts += 1;
      this.rows.set(key, { ...row, pending });
      this.save();
      const left = MAX_ATTEMPTS - pending.attempts;
      return {
        ok: false,
        error: "wrong_code",
        message: left > 0 ? `That code is wrong. ${left} tries left.` : "That code is wrong.",
        left,
      };
    }
    this.rows.set(key, {
      github: row.github,
      email: { address: pending.address, verifiedAt: now },
    });
    this.save();
    return { ok: true, view: this.view(key) };
  }

  unlinkEmail(wallet: string): AccountView {
    const key = wallet.toLowerCase();
    const row = this.rows.get(key);
    if (row) {
      this.rows.set(key, { github: row.github });
      this.save();
    }
    return this.view(key);
  }

  /** Drops an unverified challenge. Used when the code could not be sent, so a
   *  failed send does not leave the address waiting or the cooldown running. */
  cancelEmail(wallet: string): AccountView {
    const key = wallet.toLowerCase();
    this.clearPending(key);
    return this.view(key);
  }

  private row(wallet: string): Account | undefined {
    return WALLET.test(wallet) ? this.rows.get(wallet.toLowerCase()) : undefined;
  }

  private clearPending(key: string): void {
    const row = this.rows.get(key);
    if (!row?.pending) return;
    const { pending, ...rest } = row;
    void pending;
    this.rows.set(key, rest);
    this.save();
  }

  private hash(wallet: string, address: string, code: string): string {
    return createHmac("sha256", this.secret).update(`${wallet}:${address}:${code}`).digest("hex");
  }

  private save(): void {
    if (!this.file) return;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const partial = `${this.file}.tmp`;
      writeFileSync(partial, JSON.stringify(Object.fromEntries(this.rows)), "utf8");
      renameSync(partial, this.file);
    } catch {
      // The links stay in memory; the next successful write catches up.
    }
  }
}
