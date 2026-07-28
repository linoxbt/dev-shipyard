import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useExplorer, withPageParams, type PagedResponse } from "@/hooks/useExplorer";
import { Card, Spinner, ErrorState } from "@/components/explorer/ui";
import { BlockTable, Pager } from "@/components/explorer/lists";
import type { ExBlock } from "@/lib/explorer/types";

import { isSolanaSlug } from "@/lib/chain-family";
import { SolanaBlocks } from "@/components/solana/explorer/SolanaBlocks";
import { isStacksNetwork } from "@/lib/stacks/chains";
import { StacksBlocks } from "@/components/stacks/explorer/StacksBlocks";

export const Route = createFileRoute("/explorer/$network/blocks")({
  head: () => ({ meta: [{ title: "Blocks - Explorer" }] }),
  component: BlocksRoute,
});

function BlocksRoute() {
  const { network } = Route.useParams();
  if (isSolanaSlug(network)) return <SolanaBlocks cluster={network} />;
  if (isStacksNetwork(network)) return <StacksBlocks network={network} />;
  return <BlocksPage />;
}

function BlocksPage() {
  const [stack, setStack] = useState<Array<Record<string, unknown> | null>>([null]);
  const cursor = stack[stack.length - 1];
  const path = withPageParams("/blocks", cursor);
  const { data, isFetching, isError, error, refetch } = useExplorer<PagedResponse<ExBlock>>(path);

  return (
    <div className="space-y-4">
      <h1 className="font-mono text-lg font-bold text-foreground">Blocks</h1>
      <Card>
        {isError ? (
          <ErrorState message={error?.message} onRetry={() => refetch()} />
        ) : !data ? (
          <Spinner />
        ) : (
          <>
            <BlockTable blocks={data.items} />
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
