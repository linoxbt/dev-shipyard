export type LabelSource = "AUTO" | "COMMUNITY" | "VERIFIED";

export interface ContractLabel {
  address: string;
  name: string;
  category: string;
  source: LabelSource;
  submitter: string;
  submittedAt: number;
  description?: string;
}

export const LABELS: ContractLabel[] = [
  {
    address: "0xDEX0000000000000000000000000000000000001",
    name: "QIE DEX Router",
    category: "DeFi",
    source: "VERIFIED",
    submitter: "QIE Core",
    submittedAt: Date.now() - 86400_000 * 30,
  },
  {
    address: "0x5747AB1E0000000000000000000000000000ST1",
    name: "QIE Stable",
    category: "Token",
    source: "VERIFIED",
    submitter: "QIE Core",
    submittedAt: Date.now() - 86400_000 * 60,
  },
  {
    address: "0xFEE5000000000000000000000000000000000001",
    name: "QIE Fee Collector",
    category: "Infrastructure",
    source: "VERIFIED",
    submitter: "QIE Core",
    submittedAt: Date.now() - 86400_000 * 45,
  },
  {
    address: "0x4B2a8c2FbB3a2cC5F6e7d2B91A4d8e7C5b3F1a92",
    name: "QIE Builder Token",
    category: "Token",
    source: "AUTO",
    submitter: "DevStation",
    submittedAt: Date.now() - 86400_000 * 0.1,
  },
  {
    address: "0x9a3F1c2D4e5B6a7C8d9E0f1A2b3C4d5E6f7A8b9C",
    name: "Genesis Pass",
    category: "NFT",
    source: "AUTO",
    submitter: "DevStation",
    submittedAt: Date.now() - 86400_000 * 1,
  },
  {
    address: "0x2D4f5E6a7B8c9D0e1F2a3B4c5D6e7F8a9B0c1D2e",
    name: "Team Vault",
    category: "Governance",
    source: "AUTO",
    submitter: "DevStation",
    submittedAt: Date.now() - 86400_000 * 2,
  },
  {
    address: "0xA1B2C3D4E5F6789012345678901234567890ABCD",
    name: "Skyport Bridge",
    category: "Infrastructure",
    source: "COMMUNITY",
    submitter: "0x742d…E8aB",
    submittedAt: Date.now() - 86400_000 * 10,
  },
  {
    address: "0xBEEF0000000000000000000000000000000B0001",
    name: "BeefSwap Pair: QIE/USDQ",
    category: "DeFi",
    source: "COMMUNITY",
    submitter: "0x4B2a…1a92",
    submittedAt: Date.now() - 86400_000 * 7,
  },
  {
    address: "0xC0FFEE00000000000000000000000000000C0FFE",
    name: "Coffee Coin",
    category: "Token",
    source: "COMMUNITY",
    submitter: "0x9a3F…8b9C",
    submittedAt: Date.now() - 86400_000 * 5,
  },
  {
    address: "0xGAME000000000000000000000000000000000001",
    name: "Arena Quest",
    category: "Gaming",
    source: "COMMUNITY",
    submitter: "0x742d…E8aB",
    submittedAt: Date.now() - 86400_000 * 12,
  },
];

export function findLabel(addr: string): ContractLabel | undefined {
  const a = addr.toLowerCase();
  return LABELS.find((l) => l.address.toLowerCase() === a);
}
