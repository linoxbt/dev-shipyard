import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useExplorer, withPageParams, type PagedResponse } from "@/hooks/useExplorer";
import { Card, Spinner } from "@/components/explorer/ui";
import { TxTable, Pager } from "@/components/explorer/lists";
import type { ExTx } from "@/lib/explorer/types";

export const Route = createFileRoute("/explorer/$network/txns")({
  head: () => ({ meta: [{ title: "Transactions - QIE Explorer" }] }),
  component: TxnsPage,
});

function TxnsPage() {
  const [stack, setStack] = useState<Array<Record<string, unknown> | null>>([null]);
  const cursor = stack[stack.length - 1];
  const path = withPageParams("/transactions", cursor);
  const { data, isFetching } = useExplorer<PagedResponse<ExTx>>(path);

  return (
    <div className="space-y-4">
      <h1 className="font-mono text-lg font-bold text-foreground">Transactions</h1>
      <Card>
        {!data ? (
          <Spinner />
        ) : (
          <>
            <TxTable txs={data.items} />
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
