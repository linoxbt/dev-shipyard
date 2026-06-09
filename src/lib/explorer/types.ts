// Trimmed Blockscout v2 response types — only the fields the explorer renders.

export interface AddrRef {
  hash: string;
  name?: string | null;
  is_contract?: boolean;
  is_verified?: boolean;
}

export interface ExTx {
  hash: string;
  block_number: number | null;
  timestamp: string | null;
  from: AddrRef | null;
  to: AddrRef | null;
  created_contract?: AddrRef | null;
  value: string;
  fee: { type: string; value: string } | null;
  gas_used?: string | null;
  gas_limit?: string | null;
  gas_price?: string | null;
  nonce?: number;
  method?: string | null;
  status?: string | null; // "ok" | "error"
  result?: string | null; // "success" | revert reason
  exchange_rate?: string | null;
}

export interface ExBlock {
  height: number;
  hash: string;
  timestamp: string | null;
  miner: AddrRef | null;
  size: number;
  gas_used: string;
  gas_limit: string;
  gas_used_percentage?: number;
  transaction_count: number;
  base_fee_per_gas?: string | null;
  burnt_fees?: string | null;
  transaction_fees?: string | null;
  parent_hash?: string;
  nonce?: string;
  difficulty?: string;
  total_difficulty?: string;
  rewards?: Array<{ reward: string; type: string }>;
}

export interface ExStats {
  total_blocks: string;
  total_transactions: string;
  total_addresses: string;
  average_block_time: number; // ms
  gas_prices?: { slow?: number; average?: number; fast?: number } | null;
  coin_price?: string | null;
  coin_price_change_percentage?: number | null;
  market_cap?: string | null;
  network_utilization_percentage?: number;
  gas_used_today?: string | null;
}

export interface ExToken {
  address: string;
  name?: string | null;
  symbol?: string | null;
  decimals?: string | null;
  type?: string | null;
  total_supply?: string | null;
  holders?: string | null;
  exchange_rate?: string | null;
  circulating_market_cap?: string | null;
  icon_url?: string | null;
  volume_24h?: string | null;
}

export interface ExTokenTransfer {
  transaction_hash: string;
  block_number: number;
  timestamp: string | null;
  from: AddrRef | null;
  to: AddrRef | null;
  method?: string | null;
  token: ExToken | null;
  total?: { value?: string | null; decimals?: string | null; token_id?: string | null } | null;
  type?: string | null;
}

export interface ExTokenBalance {
  token: ExToken;
  value: string;
  token_id?: string | null;
}

export interface ExHolder {
  address: AddrRef;
  value: string;
  token_id?: string | null;
}

export interface ExLog {
  address: AddrRef;
  topics: (string | null)[];
  data: string;
  index: number;
  decoded?: {
    method_call?: string;
    parameters?: Array<{ name: string; type: string; value: unknown; indexed?: boolean }>;
  } | null;
  transaction_hash?: string;
}

export interface ExInternalTx {
  from: AddrRef | null;
  to: AddrRef | null;
  value: string;
  type?: string | null;
  gas_limit?: string | null;
  success?: boolean;
  transaction_hash?: string;
  block_number?: number;
  timestamp?: string | null;
}

export interface ExAddress {
  hash: string;
  coin_balance: string | null;
  is_contract: boolean;
  is_verified: boolean;
  name?: string | null;
  creator_address_hash?: string | null;
  creation_transaction_hash?: string | null;
  token?: ExToken | null;
  has_token_transfers?: boolean;
  has_tokens?: boolean;
  has_logs?: boolean;
  exchange_rate?: string | null;
  block_number_balance_updated_at?: number | null;
}

export interface ExAddrCounters {
  transactions_count?: string;
  token_transfers_count?: string;
  gas_usage_count?: string;
  validations_count?: string;
}
