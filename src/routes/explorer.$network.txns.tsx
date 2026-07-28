import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useExplorer, withPageParams, type PagedResponse } from "@/hooks/useExplorer";
import { Card, Spinner, ErrorState } from "@/components/explorer/ui";
import { TxTable, Pager } from "@/components/explorer/lists";
import { useExplorerNetwork, chainIdForSlug } from "@/lib/explorer/network";
import { nativeSymbol } from "@/lib/chains";
import type { ExTx } from "@/lib/explorer/types";

import { isSolanaSlug } from "@/lib/chain-family";
import { SolanaTxns } from "@/components/solana/explorer/SolanaTxns";
import { isStacksNetwork } from "@/lib/stacks/chains";
import { StacksTxns } from "@/components/stacks/explorer/StacksTxns";

export const Route = createFileRoute("/explorer/$network/txns")({
  head: () => ({ meta: [{ title: "Transactions - Explorer" }] }),
  component: TxnsRoute,
});

function TxnsRoute() {
  const { network } = Route.useParams();
  if (isSolanaSlug(network)) return <SolanaTxns cluster={network} />;
  if (isStacksNetwork(network)) return <StacksTxns network={network} />;
  return <TxnsPage />;
}

function TxnsPage() {
  const symbol = nativeSymbol(chainIdForSlug(useExplorerNetwork()));
  const [stack, setStack] = useState<Array<Record<string, unknown> | null>>([null]);
  const cursor = stack[stack.length - 1];
  const path = withPageParams("/transactions", cursor);
  const { data, isFetching, isError, error, refetch } = useExplorer<PagedResponse<ExTx>>(path);

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
