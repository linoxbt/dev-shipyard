import { Link } from "@tanstack/react-router";
import { ArrowRight, Boxes, FileText } from "lucide-react";
import type { ExTx, ExBlock } from "@/lib/explorer/types";
import { formatQie, formatUnits, timeAgo, withCommas } from "@/lib/explorer/format";
import { useExplorerNetwork } from "@/lib/explorer/network";
import {
  TxLink,
  AddrLink,
  BlockLink,
  StatusPill,
  MethodPill,
  CopyBtn,
} from "@/components/explorer/ui";

/* ── Transactions table ── */

export function TxTable({ txs, compact = false }: { txs: ExTx[]; compact?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-xs">
        <thead className="bg-surface-2 text-meta">
          <tr>
            <Th>Txn Hash</Th>
            {!compact && <Th>Method</Th>}
            <Th>Block</Th>
            <Th>Age</Th>
            <Th>From</Th>
            <Th>To</Th>
            <Th className="text-right">Value (QIE)</Th>
            {!compact && <Th className="text-right">Fee</Th>}
          </tr>
        </thead>
        <tbody>
          {txs.map((t) => (
            <tr key={t.hash} className="border-t border-border hover:bg-surface-2/50">
              <Td>
                <div className="flex items-center gap-1">
                  <TxLink hash={t.hash} />
                  <CopyBtn value={t.hash} />
                </div>
              </Td>
              {!compact && (
                <Td>
                  <MethodPill method={t.method} />
                </Td>
              )}
              <Td>{t.block_number != null ? <BlockLink height={t.block_number} /> : "—"}</Td>
              <Td className="whitespace-nowrap text-muted-foreground">{timeAgo(t.timestamp)}</Td>
              <Td>
                {t.from ? (
                  <AddrLink hash={t.from.hash} name={t.from.name} isContract={t.from.is_contract} />
                ) : (
                  "—"
                )}
              </Td>
              <Td>
                {t.to ? (
                  <AddrLink hash={t.to.hash} name={t.to.name} isContract={t.to.is_contract} />
                ) : t.created_contract ? (
                  <span className="text-meta">
                    Contract&nbsp;
                    <AddrLink hash={t.created_contract.hash} isContract />
                  </span>
                ) : (
                  "—"
                )}
              </Td>
              <Td className="text-right text-foreground">{formatQie(t.value)}</Td>
              {!compact && (
                <Td className="text-right text-muted-foreground">
                  {formatUnits(t.fee?.value, 18, 8)}
                </Td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {txs.length === 0 && (
        <div className="px-4 py-8 text-center font-mono text-xs text-meta">No transactions.</div>
      )}
    </div>
  );
}

// Compact dashboard list (vertical cards, like Etherscan's homepage panels).
export function TxFeed({ txs }: { txs: ExTx[] }) {
  return (
    <ul className="divide-y divide-border">
      {txs.map((t) => (
        <li key={t.hash} className="flex items-center gap-3 px-3 py-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-surface-2 text-meta">
            <FileText className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <TxLink hash={t.hash} />
            <div className="font-mono text-[10px] text-meta">{timeAgo(t.timestamp)}</div>
          </div>
          <div className="min-w-0 text-right font-mono text-[10px] text-muted-foreground">
            <div className="truncate">
              From {t.from ? <AddrLink hash={t.from.hash} name={t.from.name} /> : "—"}
            </div>
            <div className="truncate">
              To{" "}
              {t.to ? (
                <AddrLink hash={t.to.hash} name={t.to.name} />
              ) : t.created_contract ? (
                <AddrLink hash={t.created_contract.hash} isContract />
              ) : (
                "—"
              )}
            </div>
          </div>
          <div className="shrink-0 rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-foreground">
            {formatQie(t.value)} QIE
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── Blocks ── */

export function BlockFeed({ blocks }: { blocks: ExBlock[] }) {
  return (
    <ul className="divide-y divide-border">
      {blocks.map((b) => (
        <li key={b.height} className="flex items-center gap-3 px-3 py-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-surface-2 text-meta">
            <Boxes className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <BlockLink height={b.height} />
            <div className="font-mono text-[10px] text-meta">{timeAgo(b.timestamp)}</div>
          </div>
          <div className="min-w-0 text-right font-mono text-[10px] text-muted-foreground">
            <div className="truncate">
              Miner {b.miner ? <AddrLink hash={b.miner.hash} name={b.miner.name} /> : "—"}
            </div>
            <div>{b.transaction_count} txns</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function BlockTable({ blocks }: { blocks: ExBlock[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full font-mono text-xs">
        <thead className="bg-surface-2 text-meta">
          <tr>
            <Th>Block</Th>
            <Th>Age</Th>
            <Th className="text-right">Txn</Th>
            <Th>Miner</Th>
            <Th className="text-right">Gas Used</Th>
            <Th className="text-right">Gas Limit</Th>
            <Th className="text-right">Reward</Th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr key={b.height} className="border-t border-border hover:bg-surface-2/50">
              <Td>
                <BlockLink height={b.height} />
              </Td>
              <Td className="whitespace-nowrap text-muted-foreground">{timeAgo(b.timestamp)}</Td>
              <Td className="text-right">{b.transaction_count}</Td>
              <Td>{b.miner ? <AddrLink hash={b.miner.hash} name={b.miner.name} /> : "—"}</Td>
              <Td className="text-right text-muted-foreground">
                {withCommas(b.gas_used)}
                {b.gas_used_percentage != null && (
                  <span className="ml-1 text-[10px] text-meta">
                    ({b.gas_used_percentage.toFixed(1)}%)
                  </span>
                )}
              </Td>
              <Td className="text-right text-muted-foreground">{withCommas(b.gas_limit)}</Td>
              <Td className="text-right text-muted-foreground">
                {formatQie(b.rewards?.[0]?.reward ?? "0")}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
      {blocks.length === 0 && (
        <div className="px-4 py-8 text-center font-mono text-xs text-meta">No blocks.</div>
      )}
    </div>
  );
}

/* ── Pagination control ── */

export function Pager({
  onNext,
  onPrev,
  hasNext,
  hasPrev,
}: {
  onNext: () => void;
  onPrev: () => void;
  hasNext: boolean;
  hasPrev: boolean;
}) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-border px-3 py-2">
      <button
        onClick={onPrev}
        disabled={!hasPrev}
        className="rounded border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
      >
        Prev
      </button>
      <button
        onClick={onNext}
        disabled={!hasNext}
        className="inline-flex items-center gap-1 rounded border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
      >
        Next <ArrowRight className="h-3 w-3" />
      </button>
    </div>
  );
}

/* ── tiny table cells ── */
function Th({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-3 py-2 text-left font-normal uppercase tracking-wider text-[10px] ${className ?? ""}`}
    >
      {children}
    </th>
  );
}
function Td({ children, className }: { children?: React.ReactNode; className?: string }) {
  return <td className={`px-3 py-2.5 align-middle ${className ?? ""}`}>{children}</td>;
}

// Dashboard "view all" link to a network-scoped explorer list page.
export function ViewAll({
  to,
  label,
}: {
  to: "/explorer/$network/txns" | "/explorer/$network/blocks" | "/explorer/$network/tokens";
  label: string;
}) {
  const network = useExplorerNetwork();
  return (
    <Link
      to={to}
      params={{ network }}
      className="font-mono text-[11px] text-primary hover:underline"
    >
      {label}
    </Link>
  );
}
