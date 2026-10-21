import { createFileRoute } from "@tanstack/react-router";
import { usePagedExplorer } from "@/hooks/useExplorer";
import { Card, Spinner, ErrorState } from "@/components/explorer/ui";
import { TxTable, Pager } from "@/components/explorer/lists";
import { useExplorerNetwork, chainIdForSlug } from "@/lib/explorer/network";
import { nativeSymbol } from "@/lib/chains";
import type { ExTx } from "@/lib/explorer/types";

export const Route = createFileRoute("/explorer/$network/txns")({
  head: () => ({ meta: [{ title: "Transactions - Explorer" }] }),
  component: TxnsPage,
});

function TxnsPage() {
  const symbol = nativeSymbol(chainIdForSlug(useExplorerNetwork()));
  const { data, isError, error, refetch, pager } = usePagedExplorer<ExTx>("/transactions");

  return (
    <div className="space-y-4">
      <h1 className="font-mono text-lg font-bold text-foreground">Transactions</h1>
      <Card>
        {isError ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : !data ? (
          <Spinner />
        ) : (
          <>
            <TxTable txs={data.items} symbol={symbol} />
            <Pager {...pager} />
          </>
        )}
      </Card>
    </div>
  );
}
