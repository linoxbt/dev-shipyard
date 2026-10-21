import { createFileRoute } from "@tanstack/react-router";
import { usePagedExplorer } from "@/hooks/useExplorer";
import { Card, Spinner, ErrorState } from "@/components/explorer/ui";
import { BlockTable, Pager } from "@/components/explorer/lists";
import type { ExBlock } from "@/lib/explorer/types";

export const Route = createFileRoute("/explorer/$network/blocks")({
  head: () => ({ meta: [{ title: "Blocks - Explorer" }] }),
  component: BlocksPage,
});

function BlocksPage() {
  const { data, isError, error, refetch, pager } = usePagedExplorer<ExBlock>("/blocks");

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
            <Pager {...pager} />
          </>
        )}
      </Card>
    </div>
  );
}
