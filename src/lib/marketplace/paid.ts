// Built-in templates that are sold rather than given away.
//
// They left the free built-in set (src/lib/data/templates.ts) and live in
// DevStationMarketplace on QIE Mainnet instead, where their files unlock on
// purchase. Old links to them, a template page or a Deploy link, land on the
// paid listing through this map.
//
//   stablecoin-invoices -> listing 1, 5 QUSDC one-time
//   token-vesting       -> listing 2, 10 QIE one-time

export const PAID_BUILTINS: Readonly<Record<string, number>> = {
  "stablecoin-invoices": 1,
  "token-vesting": 2,
};

/** The marketplace listing id (m-<n>) a former built-in now sells under. */
export function paidListingFor(templateId: string | undefined): string | null {
  if (!templateId) return null;
  const id = PAID_BUILTINS[templateId];
  return id === undefined ? null : `m-${id}`;
}
