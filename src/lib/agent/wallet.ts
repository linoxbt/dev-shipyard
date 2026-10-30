// The deployer wallet an agent can make for a workspace.
//
// Smart contract work needs an account that pays for gas. The agent makes one
// here, says its address, and the person funds it from a faucet (or, when they
// ask for it, with real funds). The key is kept in the workspace's control
// folder (.devstation/), which the file tools refuse, the browser never
// receives and a push never includes; it reaches a command only as an
// environment variable (onchain), and it is scrubbed from every tool's output
// before the model or the chat sees it.

import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

export interface DeployerWallet {
  address: string;
  privateKey: string;
}

function walletFile(root: string): string {
  return join(root, ".devstation", "wallet.json");
}

/** The workspace's deployer wallet, or null when none has been made. */
export function readWallet(root: string): DeployerWallet | null {
  try {
    const raw = JSON.parse(readFileSync(walletFile(root), "utf8")) as Partial<DeployerWallet>;
    if (
      typeof raw.address === "string" &&
      typeof raw.privateKey === "string" &&
      /^0x[0-9a-fA-F]{64}$/.test(raw.privateKey)
    ) {
      return { address: raw.address, privateKey: raw.privateKey };
    }
  } catch {
    // None yet, or unreadable: treated alike.
  }
  return null;
}

/** The workspace's deployer wallet, made the first time it is asked for. One
 *  per workspace: asking again returns the same address, so funds sent to it
 *  are never stranded by a second wallet. */
export function ensureWallet(root: string): DeployerWallet & { created: boolean } {
  const existing = readWallet(root);
  if (existing) return { ...existing, created: false };
  const privateKey = generatePrivateKey();
  const { address } = privateKeyToAccount(privateKey);
  const dir = join(root, ".devstation");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const file = walletFile(root);
  writeFileSync(
    file,
    JSON.stringify({ address, privateKey, createdAt: new Date().toISOString() }),
    {
      mode: 0o600,
    },
  );
  try {
    chmodSync(file, 0o600);
  } catch {
    // Best effort: the folder is already out of the agent's and browser's reach.
  }
  return { address, privateKey, created: true };
}

/** The environment a command gets to sign with: the names Foundry, Hardhat
 *  and most deploy scripts read. */
export function walletEnv(wallet: DeployerWallet | null): Record<string, string> {
  if (!wallet) return {};
  return {
    DEPLOYER_PRIVATE_KEY: wallet.privateKey,
    PRIVATE_KEY: wallet.privateKey,
    DEPLOYER_ADDRESS: wallet.address,
  };
}

/** Text with the wallet's key taken out, with or without its 0x. */
export function redactWallet(text: string, wallet: DeployerWallet | null): string {
  if (!wallet) return text;
  const bare = wallet.privateKey.slice(2);
  return text
    .split(bare)
    .join("[deployer key hidden]")
    .replace(/0x\[deployer key hidden\]/g, "[deployer key hidden]");
}

/** The programs an on-chain command may start with. They get a network and the
 *  deployer key, so this is a short list of tools made for exactly that, not a
 *  general shell with internet access. */
const ONCHAIN_PROGRAMS = [
  /^forge\s/,
  /^cast\s/,
  /^(npx|bunx|pnpm\s+exec|yarn)\s+(--yes\s+)?hardhat\s/,
];

/** Why an on-chain command is refused, or null when it may run. */
export function onchainCommandProblem(command: string): string | null {
  const c = command.trim();
  if (!c) return "Give the command to run.";
  if (c.length > 2000) return "That command is too long.";
  if (!ONCHAIN_PROGRAMS.some((p) => p.test(`${c} `))) {
    return "onchain runs forge, cast or hardhat (through npx, bunx, pnpm exec or yarn). Use run_shell for anything else.";
  }
  // One command, no chaining, no redirection, no substitution: the network and
  // the key are for this program, not for whatever follows a semicolon.
  if (/[;&|`<>\n]|\$\(/.test(c)) {
    return "onchain takes one command: no ;, &&, |, redirection or $(…). Run the steps one at a time.";
  }
  const vars = c.match(/\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g) ?? [];
  const allowed = new Set(["DEPLOYER_PRIVATE_KEY", "PRIVATE_KEY", "DEPLOYER_ADDRESS"]);
  const other = vars.map((v) => v.replace(/[${}]/g, "")).find((v) => !allowed.has(v));
  if (other)
    return `onchain can only use $DEPLOYER_PRIVATE_KEY, $PRIVATE_KEY and $DEPLOYER_ADDRESS, not $${other}.`;
  return null;
}
