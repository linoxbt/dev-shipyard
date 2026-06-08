// Human-friendly gas-price formatting. QIE testnet gas can be a handful of wei
// (e.g. 7 wei ≈ 0.000000007 gwei), which naively rounds to "0.00 Gwei". Pick a
// unit that keeps the number readable.

export interface GasDisplay {
  /** e.g. "7 wei", "1.13 Gwei", "0.05 Gwei" */
  text: string;
  /** Estimated cost of a 21,000-gas transfer, in QIE (native, 18 decimals). */
  txCostQie: number;
}

// `weiStr` is the raw gas price in wei (from the RPC). `gweiFallback` is used
// only when no raw value is available.
export function formatGas(weiStr: string | undefined, gweiFallback: number): GasDisplay {
  let wei: bigint | null = null;
  if (weiStr) {
    try {
      wei = BigInt(weiStr);
    } catch {
      wei = null;
    }
  }
  const gwei = wei !== null ? Number(wei) / 1e9 : gweiFallback;
  const weiNum = wei !== null ? Number(wei) : gweiFallback * 1e9;

  let text: string;
  if (weiNum === 0) text = "0";
  else if (gwei >= 0.01) text = `${gwei.toFixed(2)} Gwei`;
  else if (weiNum >= 1e6)
    text = `${(weiNum / 1e6).toFixed(2)} mGwei`; // milli-gwei
  else text = `${Math.round(weiNum).toLocaleString()} wei`;

  // 21,000 gas * price(wei) / 1e18 → QIE
  const txCostQie = (21000 * weiNum) / 1e18;
  return { text, txCostQie };
}
