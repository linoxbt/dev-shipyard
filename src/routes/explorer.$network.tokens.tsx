import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useExplorer, withPageParams, type PagedResponse } from "@/hooks/useExplorer";
import { Card, Spinner, TokenLink, AddrLink } from "@/components/explorer/ui";
import { Pager } from "@/components/explorer/lists";
import { formatUnits, withCommas } from "@/lib/explorer/format";
import type { ExToken } from "@/lib/explorer/types";

export const Route = createFileRoute("/explorer/$network/tokens")({
  head: () => ({ meta: [{ title: "Tokens - QIE Explorer" }] }),
  component: TokensPage,
});

function TokensPage() {
  const [stack, setStack] = useState<Array<Record<string, unknown> | null>>([null]);
  const cursor = stack[stack.length - 1];
  const path = withPageParams("/tokens", cursor);
  const { data, isFetching } = useExplorer<PagedResponse<ExToken>>(path);

  return (
    <div className="space-y-4">
      <h1 className="font-mono text-lg font-bold text-foreground">Tokens</h1>
      <Card>
        {!data ? (
          <Spinner />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full font-mono text-xs">
                <thead className="bg-surface-2 text-meta">
                  <tr>
                    <Th>#</Th>
                    <Th>Token</Th>
                    <Th>Type</Th>
                    <Th>Contract</Th>
                    <Th className="text-right">Holders</Th>
                    <Th className="text-right">Total Supply</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((t, i) => (
                    <tr key={t.address} className="border-t border-border hover:bg-surface-2/50">
                      <Td className="text-meta">{i + 1}</Td>
                      <Td>
                        <TokenLink
                          hash={t.address}
                          label={`${t.name ?? "Token"} (${t.symbol ?? ""})`}
                        />
                      </Td>
                      <Td className="text-meta">{t.type}</Td>
                      <Td>
                        <AddrLink hash={t.address} />
                      </Td>
                      <Td className="text-right text-muted-foreground">
                        {t.holders ? withCommas(t.holders) : "—"}
                      </Td>
                      <Td className="text-right text-foreground">
                        {t.total_supply
                          ? withCommas(
                              formatUnits(t.total_supply, t.decimals ? Number(t.decimals) : 18, 2),
                            )
                          : "—"}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.items.length === 0 && (
                <div className="px-4 py-8 text-center font-mono text-xs text-meta">No tokens.</div>
              )}
            </div>
            <Pager
              hasPrev={stack.length > 1}
              hasNext={!!data.next_page_params && !isFetching}
              onPrev={() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s))}
              onNext={() => data.next_page_params && setStack((s) => [...s, data.next_page_params])}
            />
          </>
        )}
      </Card>
    </div>
  );
}

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
