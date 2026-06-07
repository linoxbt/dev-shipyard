import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { AiChat } from "@/components/ai/AiChat";

export const Route = createFileRoute("/launchkit/ai")({
  head: () => ({ meta: [{ title: "Code with AI — DevStation" }] }),
  component: CodeWithAi,
});

function CodeWithAi() {
  return (
    <div className="flex h-[calc(100vh-0px)] flex-col">
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Code with AI"]}
        title="Code with AI"
        subtitle="Write, debug, and explain Solidity contracts with an AI assistant."
      />
      <div className="mx-auto flex w-full max-w-3xl flex-1 overflow-hidden p-4">
        <div className="flex-1 overflow-hidden rounded border border-border">
          <AiChat placeholder="Ask the AI to write or review a contract…" />
        </div>
      </div>
    </div>
  );
}
