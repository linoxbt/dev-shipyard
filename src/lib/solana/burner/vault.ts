// Password-encrypted local key vault for the in-app generated Solana ("burner")
// wallet — the Solana analog of src/lib/burner/vault.ts.
//
// Security model mirrors the EVM burner: the 64-byte Ed25519 secret key is
// encrypted with AES-GCM using a PBKDF2 (SHA-256, 310k) key derived from the
// user's password. Only ciphertext/salt/iv + the public key are persisted to
// localStorage. Plaintext secret key lives in memory only after unlock. Fine
// for devnet and small balances; NOT a hardware-wallet substitute.

import { Keypair } from "@solana/web3.js";
import { generateMnemonic, mnemonicToSeedSync } from "bip39";
import { derivePath } from "ed25519-hd-key";

const VAULT_KEY = "devstation-solana-burner-vault-v1";
// Standard Solana BIP-44 derivation path (matches Phantom/Solflare account 0).
const SOLANA_DERIVATION_PATH = "m/44'/501'/0'/0'";
const PBKDF2_ITERATIONS = 310_000;

export interface EncryptedSolanaVault {
  version: 1;
  address: string; // base58 public key
  ciphertext: string; // base64 of the 64-byte secret key
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

function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function randomBytes(len: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(len));
  crypto.getRandomValues(bytes);
  return bytes;
}

// Web Crypto's SubtleCrypto is only available on secure origins (https:// or
// localhost). Fail with a clear message instead of a raw TypeError.
function assertCryptoAvailable(): void {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error(
      "Generating or unlocking a wallet needs a secure connection (HTTPS or localhost) — this page is loaded over plain HTTP, and browsers disable the encryption APIs there.",
    );
  }
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  assertCryptoAvailable();
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

/** Generate a fresh Solana keypair (does not persist). */
export function createKeypair(): Keypair {
  return Keypair.generate();
}

/**
 * Generate a fresh BIP-39 mnemonic and the Solana keypair derived from it (using
 * the standard m/44'/501'/0'/0' path, matching Phantom/Solflare). Used so wallet
 * generation can ALWAYS display a recoverable seed phrase. Only the resulting
 * secret key is persisted (see saveVault) — the mnemonic is shown once at
 * generation time.
 */
export function createKeypairWithMnemonic(): { keypair: Keypair; mnemonic: string } {
  const mnemonic = generateMnemonic(256);
  const seed = mnemonicToSeedSync(mnemonic);
  const { key } = derivePath(SOLANA_DERIVATION_PATH, seed.toString("hex"));
  return { keypair: Keypair.fromSeed(new Uint8Array(key)), mnemonic };
}

/** Rebuild a Keypair from a base64-encoded 64-byte secret key. */
export function keypairFromSecretB64(secretB64: string): Keypair {
  return Keypair.fromSecretKey(b64ToBytes(secretB64));
}

export function secretKeyToB64(kp: Keypair): string {
  return bufToB64(kp.secretKey.buffer as ArrayBuffer);
}

/** Encrypt a keypair's secret key under a password and persist to localStorage. */
export async function saveVault(kp: Keypair, password: string): Promise<EncryptedSolanaVault> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    kp.secretKey as unknown as ArrayBuffer,
  );

  const vault: EncryptedSolanaVault = {
    version: 1,
    address: kp.publicKey.toBase58(),
    ciphertext: bufToB64(ciphertext),
    salt: bufToB64(salt.buffer),
    iv: bufToB64(iv.buffer),
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  return vault;
}

export function loadVault(): EncryptedSolanaVault | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? (JSON.parse(raw) as EncryptedSolanaVault) : null;
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

/** Decrypt the stored keypair. Throws if the password is wrong. */
export async function unlockVault(password: string): Promise<Keypair> {
  const vault = loadVault();
  if (!vault) throw new Error("No wallet found");
  const salt = b64ToBytes(vault.salt);
  const iv = b64ToBytes(vault.iv);
  const key = await deriveKey(password, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64ToBytes(vault.ciphertext));
  } catch {
    throw new Error("Incorrect password");
  }
  return Keypair.fromSecretKey(new Uint8Array(plain));
}
