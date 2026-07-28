// The non-EVM chain families the console supports, kept in one place so
// surfaces that count "how many networks does DevStation cover" stay correct as
// families are added — instead of hardcoding a number in page copy that silently
// goes stale (the landing page used to claim "4 EVM chains").
//
// EVM families are enumerated separately in src/lib/explorer/network.ts
// (EXPLORER_CHAIN_FAMILIES); callers add the two together.

export const NON_EVM_FAMILIES = ["Solana", "Stacks"] as const;

export const NON_EVM_FAMILY_COUNT = NON_EVM_FAMILIES.length;
