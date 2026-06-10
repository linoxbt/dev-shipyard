import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { MessageSquare, Bot } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { AiChat } from "@/components/ai/AiChat";
import { AgentChat } from "@/components/ai/AgentChat";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/launchkit/ai")({
  head: () => ({ meta: [{ title: "Code with AI — DevStation" }] }),
  component: CodeWithAi,
});

type Mode = "chat" | "agent";

function CodeWithAi() {
  const [mode, setMode] = useState<Mode>("chat");

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col">
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Code with AI"]}
        title="Code with AI"
        subtitle={
          mode === "agent"
            ? "Autonomous agent: generate, compile, auto-fix, and deploy a contract — without leaving this page."
            : "Write, debug, and explain Solidity contracts with an AI assistant."
        }
      />
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden p-4">
        {/* Mode switch */}
        <div className="mb-3 inline-flex self-start rounded border border-border bg-surface p-0.5">
          <ModeButton active={mode === "chat"} onClick={() => setMode("chat")} icon={MessageSquare}>
            Chat
          </ModeButton>
          <ModeButton active={mode === "agent"} onClick={() => setMode("agent")} icon={Bot}>
            Agent
          </ModeButton>
        </div>

        <div className="flex-1 overflow-hidden rounded border border-border">
          {mode === "agent" ? (
            <AgentChat />
          ) : (
            <AiChat placeholder="Ask the AI to write or review a contract…" />
          )}
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded px-3 py-1.5 font-mono text-xs transition",
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}
