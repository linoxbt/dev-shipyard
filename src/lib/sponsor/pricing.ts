// Shared sizing math for a gas top-up — used by BOTH the server route that
// actually sends QIE (api.sponsor-topup.ts) and the client-side checks that
// decide whether to offer sponsorship at all (the "Gas-free deploy"
// checkbox goes inert when a wallet already has enough). Both sides must
// agree on what "enough" means, or the UI could hide the option for a
// wallet the server would have actually topped up, or vice versa — this
// file is the single source of truth for that threshold, not duplicated
// inline in each place that needs it.
//
// The margin is deliberately generous, not a tight "just above cost" number:
// this is sizing a WALLET TOP-UP from ONE eth_estimateGas call, checked
// against a SEPARATE eth_estimateGas call the actual deploy makes moments
// later. QIE's estimator has been observed to return meaningfully different
// numbers for back-to-back calls against the identical transaction — a
// smaller margin here once undershot the real need by roughly 2x, silently
// reporting "wallet already had enough" for a wallet that didn't. Erring
// generous costs a small fraction of a QIE at this chain's gas price; erring
// short wastes an entire deploy attempt after a full compile cycle.
export function paddedTopupCost(
  gasEstimate: bigint,
  gasPrice: bigint,
  extraGas: bigint = 0n,
): bigint {
  const paddedGas = gasEstimate * 10n + extraGas;
  const paddedPrice = (gasPrice * 3n) / 2n;
  return paddedGas * paddedPrice;
}
