// Shared AES-GCM string vault used by the in-app generated ("DevStation")
// wallets that back a BIP-39 seed phrase (Stacks, Sui). The secret we protect
// is the mnemonic itself — encrypted with a PBKDF2 (SHA-256, 310k) key derived
// from the user's password. Only ciphertext/salt/iv (+ the public address) are
// persisted to localStorage; the plaintext mnemonic lives in memory only after
// unlock. Appropriate for testnet and small balances — not a hardware wallet.
//
// The Solana burner (src/lib/solana/burner/vault.ts) predates this and keeps its
// own copy of the same primitives; this module is the generic version the newer
// chains share.

const PBKDF2_ITERATIONS = 310_000;

export interface EncryptedSecret {
  ciphertext: string; // base64
  salt: string; // base64
  iv: string; // base64
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

/** Encrypt a UTF-8 secret (e.g. a mnemonic) under a password. */
export async function encryptSecret(secret: string, password: string): Promise<EncryptedSecret> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(secret),
  );
  return { ciphertext: bufToB64(ciphertext), salt: bufToB64(salt.buffer), iv: bufToB64(iv.buffer) };
}

/** Decrypt a secret. Throws "Incorrect password" if the password is wrong. */
export async function decryptSecret(enc: EncryptedSecret, password: string): Promise<string> {
  const salt = b64ToBytes(enc.salt);
  const iv = b64ToBytes(enc.iv);
  const key = await deriveKey(password, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, b64ToBytes(enc.ciphertext));
  } catch {
    throw new Error("Incorrect password");
  }
  return new TextDecoder().decode(plain);
}
