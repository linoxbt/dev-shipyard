// Stacks explorer data — server functions over the Hiro API. Normalizes Stacks
// txs and, crucially, computes the Post-Condition Coverage audit for a tx's
// target contract (the field EVM/Solana don't have). Runs server-side to keep
// the optional HIRO_API_KEY off the client.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { stacksChain } from "@/lib/stacks/chains";
import { auditContract, diffPostConditions, type AuditResult } from "@/lib/stacks/audit";

const netSchema = z.object({ network: z.enum(["stacks-testnet", "stacks-mainnet"]) });

function hiroHeaders(): Record<string, string> {
  const key = process.env.HIRO_API_KEY;
  return key ? { "x-api-key": key, accept: "application/json" } : { accept: "application/json" };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export const getStacksNetworkStatus = createServerFn({ method: "GET" })
  .inputValidator(netSchema)
  .handler(async ({ data }) => {
    try {
      const api = stacksChain(data.network).apiUrl;
      const [info, blocks] = await Promise.all([
        fetch(`${api}/v2/info`, { headers: hiroHeaders() }).then((r) => r.json()),
        fetch(`${api}/extended/v1/block?limit=1`, { headers: hiroHeaders() }).then((r) => r.json()),
      ]);
      const tip = blocks?.results?.[0];
      return {
        ok: true as const,
        network: data.network,
        stacksTipHeight: info?.stacks_tip_height ?? tip?.height ?? 0,
        burnBlockHeight: info?.burn_block_height ?? tip?.burn_block_height ?? 0,
        latestBlockHash: tip?.hash ?? "",
        latestBlockTime: tip?.burn_block_time ?? null,
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Hiro API error" };
    }
  });

export interface StacksTxRow {
  txid: string;
  type: string;
  sender: string;
  status: string;
  fnName?: string;
}

const mapTxRow = (t: any): StacksTxRow => ({
  txid: t.tx_id,
  type: t.tx_type,
  sender: t.sender_address,
  status: t.tx_status,
  fnName: t.contract_call?.function_name,
});

export const getStacksLatestTxns = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      network: z.enum(["stacks-testnet", "stacks-mainnet"]),
      limit: z.number().optional(),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const api = stacksChain(data.network).apiUrl;
      const limit = Math.min(50, data.limit ?? 20);
      const j = await fetch(`${api}/extended/v1/tx?limit=${limit}`, {
        headers: hiroHeaders(),
      }).then((r) => r.json());
      return { network: data.network, txns: (j?.results ?? []).map(mapTxRow) as StacksTxRow[] };
    } catch {
      return { network: data.network, txns: [] as StacksTxRow[] };
    }
  });

export interface StacksBlockRow {
  height: number;
  hash: string;
  txCount: number;
  time: number | null;
}

export const getStacksBlocks = createServerFn({ method: "GET" })
  .inputValidator(netSchema)
  .handler(async ({ data }) => {
    try {
      const api = stacksChain(data.network).apiUrl;
      const j = await fetch(`${api}/extended/v2/blocks?limit=25`, { headers: hiroHeaders() }).then(
        (r) => r.json(),
      );
      const blocks: StacksBlockRow[] = (j?.results ?? []).map((b: any) => ({
        height: b.height,
        hash: b.hash,
        txCount: b.tx_count ?? 0,
        time: b.block_time ?? b.burn_block_time ?? null,
      }));
      return { network: data.network, blocks };
    } catch {
      return { network: data.network, blocks: [] as StacksBlockRow[] };
    }
  });

export const getStacksBlock = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      network: z.enum(["stacks-testnet", "stacks-mainnet"]),
      id: z.string().min(1).max(80),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const api = stacksChain(data.network).apiUrl;
      const b: any = await fetch(`${api}/extended/v2/blocks/${data.id}`, {
        headers: hiroHeaders(),
      }).then((r) => r.json());
      if (!b || b.error) return { ok: false as const, error: b?.error ?? "Block not found" };
      let txns: StacksTxRow[] = [];
      try {
        const tj: any = await fetch(`${api}/extended/v2/blocks/${b.hash}/transactions?limit=30`, {
          headers: hiroHeaders(),
        }).then((r) => r.json());
        txns = (tj?.results ?? []).map(mapTxRow);
      } catch {
        /* no txs */
      }
      return {
        ok: true as const,
        network: data.network,
        height: b.height,
        hash: b.hash,
        parentHash: b.parent_block_hash,
        burnBlockHeight: b.burn_block_height,
        time: b.block_time ?? b.burn_block_time ?? null,
        txCount: b.tx_count ?? txns.length,
        txns,
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Hiro API error" };
    }
  });

export interface FtHolding {
  token: string;
  balance: string;
}
export interface ContractFn {
  name: string;
  access: string;
  args: Array<{ name: string; type: string }>;
  outputs: string;
}

export const getStacksAddress = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      network: z.enum(["stacks-testnet", "stacks-mainnet"]),
      principal: z.string().min(3).max(120),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const api = stacksChain(data.network).apiUrl;
      const p = data.principal.trim();
      const isContract = p.includes(".");

      const [bal, txs] = await Promise.all([
        fetch(`${api}/extended/v1/address/${p}/balances`, { headers: hiroHeaders() }).then((r) =>
          r.json(),
        ),
        fetch(`${api}/extended/v1/address/${p}/transactions?limit=25`, { headers: hiroHeaders() })
          .then((r) => r.json())
          .catch(() => ({ results: [] })),
      ]);

      const fungible: FtHolding[] = Object.entries(bal?.fungible_tokens ?? {}).map(
        ([token, v]: [string, any]) => ({
          token,
          balance: v?.balance ?? "0",
        }),
      );
      const nftCount = Object.values(bal?.non_fungible_tokens ?? {}).reduce(
        (acc: number, v: any) => acc + Number(v?.count ?? 0),
        0,
      );
      const txns: StacksTxRow[] = (txs?.results ?? []).map((r: any) => mapTxRow(r.tx ?? r));

      // BNS names owned by this principal (reverse lookup).
      let bnsNames: string[] = [];
      if (!isContract) {
        try {
          const n: any = await fetch(`${api}/v1/addresses/stacks/${p}`, {
            headers: hiroHeaders(),
          }).then((r) => r.json());
          bnsNames = Array.isArray(n?.names) ? n.names : [];
        } catch {
          /* no names */
        }
      }

      // Contract interface (functions + arg types) + source + coverage.
      let contractFns: ContractFn[] | null = null;
      let contractSource: string | null = null;
      let coverage: AuditResult | null = null;
      if (isContract) {
        const [addr, cname] = p.split(".");
        try {
          const iface: any = await fetch(`${api}/v2/contracts/interface/${addr}/${cname}`, {
            headers: hiroHeaders(),
          }).then((r) => r.json());
          contractFns = (iface?.functions ?? []).map((f: any) => ({
            name: f.name,
            access: f.access,
            args: (f.args ?? []).map((a: any) => ({
              name: a.name,
              type: typeof a.type === "string" ? a.type : JSON.stringify(a.type),
            })),
            outputs:
              typeof f.outputs?.type === "string"
                ? f.outputs.type
                : JSON.stringify(f.outputs?.type ?? ""),
          }));
        } catch {
          /* no interface */
        }
        try {
          const src: any = await fetch(`${api}/v2/contracts/source/${addr}/${cname}?proof=0`, {
            headers: hiroHeaders(),
          }).then((r) => r.json());
          contractSource = src?.source ?? null;
          if (contractSource) {
            coverage = diffPostConditions(auditContract(contractSource), {
              postConditionMode: "deny",
              declaredCount: 1,
            });
          }
        } catch {
          /* no source */
        }
      }

      return {
        ok: true as const,
        network: data.network,
        principal: p,
        isContract,
        stxBalance: Number(bal?.stx?.balance ?? 0) / 1_000_000,
        fungible,
        nftCount,
        bnsNames,
        txns,
        contractFns,
        contractSource,
        coverage,
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Hiro API error" };
    }
  });

const txSchema = z.object({
  network: z.enum(["stacks-testnet", "stacks-mainnet"]),
  txid: z.string().min(6).max(80),
});

export const getStacksTx = createServerFn({ method: "GET" })
  .inputValidator(txSchema)
  .handler(async ({ data }) => {
    try {
      const api = stacksChain(data.network).apiUrl;
      const txid = data.txid.startsWith("0x") ? data.txid : `0x${data.txid}`;
      const t: any = await fetch(`${api}/extended/v1/tx/${txid}?event_limit=50&event_offset=0`, {
        headers: hiroHeaders(),
      }).then((r) => r.json());
      if (!t || t.error) return { ok: false as const, error: t?.error ?? "Transaction not found" };

      const postConditions = (t.post_conditions ?? []).map((pc: any) => ({
        principal: pc.principal?.address ?? pc.principal?.type ?? "",
        type: pc.type,
        condition: pc.condition_code,
        amount: pc.amount,
        asset: pc.asset?.asset_name ?? pc.asset_value?.repr,
      }));

      const method = t.contract_call?.function_name;
      const args = (t.contract_call?.function_args ?? []).map((a: any) => ({
        name: a.name,
        type: a.type,
        repr: a.repr,
      }));

      // Plain STX transfer — the ONE tx type with none of the contract_call
      // fields above, so without this a "send STX" tx showed nothing beyond
      // sender/nonce/fee. Amount is in microSTX from the API.
      const tokenTransfer = t.token_transfer
        ? {
            recipient: t.token_transfer.recipient_address as string,
            amountStx: Number(t.token_transfer.amount ?? 0) / 1_000_000,
            memoHex: t.token_transfer.memo ?? null,
          }
        : null;

      // Clarity VM execution cost — the Stacks analog of EVM gas usage.
      const execCost = {
        readCount: t.execution_cost_read_count ?? null,
        readLength: t.execution_cost_read_length ?? null,
        writeCount: t.execution_cost_write_count ?? null,
        writeLength: t.execution_cost_write_length ?? null,
        runtime: t.execution_cost_runtime ?? null,
      };

      // The tx's Clarity return value — `(ok ...)` / `(err ...)` for contract
      // calls and deploys, present for every status including failures (an
      // aborted tx's failure reason shows up here too).
      const txResult = t.tx_result
        ? { hex: t.tx_result.hex as string, repr: t.tx_result.repr as string }
        : null;

      const sponsored = !!t.sponsored;
      const sponsorAddress = t.sponsor_address ?? null;

      // Asset/log events emitted by the transaction.
      const events = (t.events ?? []).map((ev: any) => {
        const a = ev.asset ?? {};
        return {
          type: ev.event_type,
          action: a.asset_event_type ?? ev.contract_log?.topic ?? "",
          sender: a.sender ?? null,
          recipient: a.recipient ?? null,
          amount: a.amount ?? a.value ?? ev.contract_log?.value?.repr ?? null,
          assetId: a.asset_id ?? ev.contract_log?.contract_id ?? null,
        };
      });

      // Post-Condition Coverage audit against the target contract source.
      let auditResult: AuditResult | null = null;
      let contractId: string | null = null;
      let source: string | null = null;
      if (t.tx_type === "smart_contract" && t.smart_contract?.source_code) {
        contractId = t.smart_contract.contract_id;
        source = t.smart_contract.source_code;
      } else if (t.tx_type === "contract_call" && t.contract_call?.contract_id) {
        contractId = t.contract_call.contract_id;
        try {
          const [addr, cname] = String(contractId).split(".");
          const src: any = await fetch(`${api}/v2/contracts/source/${addr}/${cname}?proof=0`, {
            headers: hiroHeaders(),
          }).then((r) => r.json());
          source = src?.source ?? null;
        } catch {
          /* source unavailable */
        }
      }
      if (source) {
        const paths = auditContract(source);
        auditResult = diffPostConditions(paths, {
          postConditionMode: t.post_condition_mode === "allow" ? "allow" : "deny",
          declaredCount: postConditions.length,
        });
        auditResult.contractId = contractId ?? undefined;
      }

      return {
        ok: true as const,
        txid,
        network: data.network,
        type: t.tx_type,
        status: t.tx_status,
        sender: t.sender_address,
        feeStx: Number(t.fee_rate ?? 0) / 1_000_000,
        blockHeight: t.block_height ?? null,
        blockTime: t.burn_block_time ?? null,
        contractId,
        nonce: t.nonce ?? null,
        method,
        args,
        eventCount: t.event_count ?? events.length,
        events,
        postConditionMode: t.post_condition_mode ?? "deny",
        postConditions,
        auditResult,
        tokenTransfer,
        execCost,
        txResult,
        sponsored,
        sponsorAddress,
      };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Hiro API error" };
    }
  });

// Call a read-only Clarity function via the Hiro node (server-side; the client
// serializes typed args to hex first). Powers the contract-page read sandbox.
const callSchema = z.object({
  network: z.enum(["stacks-testnet", "stacks-mainnet"]),
  contractAddress: z.string().min(3).max(80),
  contractName: z.string().min(1).max(80),
  functionName: z.string().min(1).max(80),
  sender: z.string().min(3).max(80),
  args: z.array(z.string()).max(20),
});

export const stacksCallReadOnly = createServerFn({ method: "POST" })
  .inputValidator(callSchema)
  .handler(async ({ data }) => {
    try {
      const api = stacksChain(data.network).apiUrl;
      const res: any = await fetch(
        `${api}/v2/contracts/call-read/${data.contractAddress}/${data.contractName}/${data.functionName}`,
        {
          method: "POST",
          headers: { ...hiroHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ sender: data.sender, arguments: data.args }),
        },
      ).then((r) => r.json());
      if (res?.okay === false)
        return { ok: false as const, error: res?.cause ?? "Read-only call failed" };
      return { ok: true as const, resultHex: res?.result ?? "" };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : "Hiro API error" };
    }
  });

// Pending (mempool) transactions.
export const getStacksMempool = createServerFn({ method: "GET" })
  .inputValidator(netSchema)
  .handler(async ({ data }) => {
    try {
      const api = stacksChain(data.network).apiUrl;
      const j = await fetch(`${api}/extended/v1/tx/mempool?limit=25`, {
        headers: hiroHeaders(),
      }).then((r) => r.json());
      const txns: StacksTxRow[] = (j?.results ?? []).map((t: any) => ({
        txid: t.tx_id,
        type: t.tx_type,
        sender: t.sender_address,
        status: "pending",
        fnName: t.contract_call?.function_name,
      }));
      return { network: data.network, txns };
    } catch {
      return { network: data.network, txns: [] as StacksTxRow[] };
    }
  });

export interface TokenRow {
  contract: string;
  name: string;
  symbol: string;
  decimals: number;
}

// Fungible-token list from the Hiro token metadata API.
export const getStacksTokens = createServerFn({ method: "GET" })
  .inputValidator(netSchema)
  .handler(async ({ data }) => {
    try {
      const api = stacksChain(data.network).apiUrl;
      const j = await fetch(`${api}/metadata/v1/ft?limit=30&order_by=name`, {
        headers: hiroHeaders(),
      }).then((r) => r.json());
      const tokens: TokenRow[] = (j?.results ?? []).map((t: any) => ({
        contract: t.contract_principal ?? t.principal ?? "",
        name: t.name ?? "—",
        symbol: t.symbol ?? "",
        decimals: t.decimals ?? 0,
      }));
      return { network: data.network, tokens };
    } catch {
      return { network: data.network, tokens: [] as TokenRow[] };
    }
  });

// BNS: resolve a name (e.g. "muneeb.btc") to its owner principal.
export const resolveStacksBns = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      network: z.enum(["stacks-testnet", "stacks-mainnet"]),
      name: z.string().min(3).max(80),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const api = stacksChain(data.network).apiUrl;
      const j: any = await fetch(`${api}/v1/names/${data.name}`, { headers: hiroHeaders() }).then(
        (r) => r.json(),
      );
      if (j?.address) return { ok: true as const, address: j.address as string };
      return { ok: false as const, error: "Name not found" };
    } catch {
      return { ok: false as const, error: "BNS lookup failed" };
    }
  });
