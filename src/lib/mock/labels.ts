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

// No seeded labels — names come from the on-chain ContractLabelRegistry. This
// stays an empty list so synchronous lookups (AddressChip, route tree) simply
// fall back to showing the raw address until on-chain labels resolve.
export const LABELS: ContractLabel[] = [];

export function findLabel(addr: string): ContractLabel | undefined {
  const a = addr.toLowerCase();
  return LABELS.find((l) => l.address.toLowerCase() === a);
}
