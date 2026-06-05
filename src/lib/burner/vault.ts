// Password-encrypted local key vault for the in-app generated ("burner") wallet.
//
// Security model: the mnemonic is encrypted with AES-GCM using a key derived
// from the user's password via PBKDF2 (SHA-256, 310k iterations). Only the
// ciphertext, salt, and IV are persisted to localStorage — the plaintext
// mnemonic and private key live in memory only after a successful unlock and
// are never logged or transmitted. This is appropriate for testnet and small
// mainnet balances; it is NOT a substitute for a hardware wallet.

import { english, generateMnemonic, mnemonicToAccount } from "viem/accounts";
import type { HDAccount } from "viem/accounts";

const VAULT_KEY = "devstation-burner-vault-v1";
const PBKDF2_ITERATIONS = 310_000;

export interface EncryptedVault {
  version: 1;
  address: `0x${string}`;
  ciphertext: string; // base64
  salt: string; // base64
  iv: string; // base64
  createdAt: string;
}

function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBuf(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Random bytes backed by a plain ArrayBuffer (satisfies BufferSource typing). */
function randomBytes(len: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(len));
  crypto.getRandomValues(bytes);
  return bytes;
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Generate a fresh BIP-39 mnemonic and its first account (does not persist). */
export function createMnemonic(): { mnemonic: string; account: HDAccount } {
  const mnemonic = generateMnemonic(english);
  return { mnemonic, account: mnemonicToAccount(mnemonic) };
}

export function accountFromMnemonic(mnemonic: string): HDAccount {
  return mnemonicToAccount(mnemonic.trim());
}

/** Encrypt a mnemonic under a password and persist the vault to localStorage. */
export async function saveVault(mnemonic: string, password: string): Promise<EncryptedVault> {
  const account = mnemonicToAccount(mnemonic.trim());
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(mnemonic.trim()),
  );

  const vault: EncryptedVault = {
    version: 1,
    address: account.address,
    ciphertext: bufToB64(ciphertext),
    salt: bufToB64(salt.buffer),
    iv: bufToB64(iv.buffer),
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  return vault;
}

export function loadVault(): EncryptedVault | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? (JSON.parse(raw) as EncryptedVault) : null;
  } catch {
    return null;
  }
}

export function hasVault(): boolean {
  return loadVault() !== null;
}

export function clearVault(): void {
  localStorage.removeItem(VAULT_KEY);
}

/** Decrypt the stored mnemonic. Throws if the password is wrong. */
export async function unlockVault(
  password: string,
): Promise<{ mnemonic: string; account: HDAccount }> {
  const vault = loadVault();
  if (!vault) throw new Error("No wallet found");
  const salt = b64ToBuf(vault.salt);
  const iv = b64ToBuf(vault.iv);
  const key = await deriveKey(password, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64ToBuf(vault.ciphertext));
  } catch {
    throw new Error("Incorrect password");
  }
  const mnemonic = new TextDecoder().decode(plain);
  return { mnemonic, account: mnemonicToAccount(mnemonic) };
}
