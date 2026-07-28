// Password-encrypted local vault for the in-app generated Stacks ("DevStation")
// wallet. The protected secret is a BIP-39 mnemonic; the STX private key is
// derived from it via @stacks/wallet-sdk on unlock. The same key yields a
// testnet (ST…) and a mainnet (SP…) c32 address, so we persist both alongside
// the ciphertext. Only ciphertext/salt/iv + the addresses are stored.

import { generateWallet, generateSecretKey } from "@stacks/wallet-sdk";
import { getAddressFromPrivateKey } from "@stacks/transactions";
import { encryptSecret, decryptSecret, type EncryptedSecret } from "@/lib/crypto/secret-vault";

const VAULT_KEY = "devstation-stacks-wallet-vault-v1";

export interface EncryptedStacksVault extends EncryptedSecret {
  version: 1;
  addressTestnet: string;
  addressMainnet: string;
  createdAt: string;
}

export interface StacksKeyInfo {
  stxPrivateKey: string;
  addressTestnet: string;
  addressMainnet: string;
}

/** A fresh 24-word BIP-39 mnemonic (Stacks-standard). */
export function createMnemonic(): string {
  return generateSecretKey(256);
}

/** Derive the STX private key + both-network addresses for a mnemonic. */
export async function keyInfoFromMnemonic(mnemonic: string): Promise<StacksKeyInfo> {
  const wallet = await generateWallet({ secretKey: mnemonic.trim(), password: "" });
  const stxPrivateKey = wallet.accounts[0].stxPrivateKey;
  return {
    stxPrivateKey,
    addressTestnet: getAddressFromPrivateKey(stxPrivateKey, "testnet"),
    addressMainnet: getAddressFromPrivateKey(stxPrivateKey, "mainnet"),
  };
}

/** Encrypt a mnemonic under a password and persist it to localStorage. */
export async function saveVault(mnemonic: string, password: string): Promise<EncryptedStacksVault> {
  const enc = await encryptSecret(mnemonic, password);
  const info = await keyInfoFromMnemonic(mnemonic);
  const vault: EncryptedStacksVault = {
    version: 1,
    addressTestnet: info.addressTestnet,
    addressMainnet: info.addressMainnet,
    createdAt: new Date().toISOString(),
    ...enc,
  };
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
  return vault;
}

export function loadVault(): EncryptedStacksVault | null {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    return raw ? (JSON.parse(raw) as EncryptedStacksVault) : null;
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
export async function unlockMnemonic(password: string): Promise<string> {
  const vault = loadVault();
  if (!vault) throw new Error("No Stacks wallet found");
  return decryptSecret(vault, password);
}
