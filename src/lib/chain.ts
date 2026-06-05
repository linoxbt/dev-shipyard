export const CHAIN = {
  id: 1983,
  name: "QIE Testnet",
  rpc: "https://rpc1testnet.qie.digital/",
  explorer: "https://testnet.qie.digital",
  symbol: "QIE",
};

export const ORACLE_RATE_USD = 0.38; // 1 QIE = $0.38
export const GAS_PRICE_GWEI = 1.2;

export function qieToUsd(qie: number) {
  return qie * ORACLE_RATE_USD;
}

export function formatUsd(amount: number) {
  if (amount < 0.01) return `$${amount.toFixed(4)}`;
  return `$${amount.toFixed(2)}`;
}
