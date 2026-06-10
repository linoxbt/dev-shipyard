import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Send,
  Square,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  XCircle,
  Hammer,
  Rocket,
  Copy,
  Check,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { useAiSettings, AI_PROVIDERS } from "@/lib/ai-settings";
import { useCodeAgent, type TimelineItem, type ToolStep } from "@/hooks/useCodeAgent";
import { cn } from "@/lib/utils";

// Autonomous build surface for the Code with AI page: the AI generates,
// compiles, auto-fixes, and (with the user's wallet) deploys a contract,
// showing each tool step inline. Deploys are signed by the connected wallet on
// the currently selected network.
export function AgentChat({ className }: { className?: string }) {
  const [input, setInput] = useState("");
  const settings = useAiSettings();
  const configured = settings.proxy || !!(settings.keys[settings.provider] ?? "");

  const { timeline, running, run, stop, reset, isConnected, targetChain, explorerUrl } =
    useCodeAgent();

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [timeline, running]);

  const submit = () => {
    const text = input.trim();
    if (!text || running || !configured) return;
    setInput("");
    void run(text);
  };

  return (
    <div className={cn("flex h-full flex-col bg-surface", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Bot className="h-4 w-4 text-primary" />
        <span className="font-mono text-xs font-semibold text-foreground">Autonomous Agent</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-meta">
          {settings.proxy
            ? "server proxy"
            : `${AI_PROVIDERS[settings.provider].label} · ${settings.model}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {timeline.length > 0 && !running && (
            <button
              onClick={reset}
              title="Clear run"
              className="rounded p-1 text-meta hover:text-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Target / warning banner */}
      <div
        className={cn(
          "flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5 font-mono text-[10px]",
          targetChain.testnet
            ? "border-border bg-background/40 text-meta"
            : "border-warning/40 bg-warning/10 text-warning",
        )}
      >
        {!targetChain.testnet && <AlertTriangle className="h-3 w-3" />}
        <span>
          Deploys go to <span className="font-bold">{targetChain.name}</span>
          {targetChain.testnet ? " (test network)" : " — real gas, irreversible"} and are signed by
          your connected wallet.
        </span>
        {!isConnected && <span className="text-warning">Connect a wallet to deploy.</span>}
      </div>

      {/* Timeline */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3">
        {timeline.length === 0 && (
          <div className="space-y-2 font-mono text-[11px] text-meta">
            {configured ? (
              <>
                <p>Describe a contract and I&apos;ll build it end to end:</p>
                <ul className="ml-3 list-disc space-y-1">
                  <li>
                    &quot;Create an ERC-20 token called QIE Pizza (PIZZA) and deploy it.&quot;
                  </li>
                  <li>
                    &quot;I need an NFT with a mint function. Deploy it to me as the owner.&quot;
                  </li>
                  <li>
                    &quot;Here&apos;s my contract source — compile, fix any errors, and
                    deploy.&quot;
                  </li>
                </ul>
                <p className="text-[10px]">
                  I generate the Solidity, compile it, auto-fix errors (up to 5 tries), then deploy
                  with your wallet — without leaving this page.
                </p>
              </>
            ) : (
              <div className="rounded border border-warning/40 bg-warning/10 p-2.5 text-warning">
                The AI assistant needs an API key. Open AI settings (on the Code with AI chat tab)
                to pick a provider and paste your key.
              </div>
            )}
          </div>
        )}

        {timeline.map((item, i) => (
          <TimelineRow key={i} item={item} explorerUrl={explorerUrl} />
        ))}

        {running && (
          <div className="flex items-center gap-2 font-mono text-[11px] text-meta">
            <Loader2 className="h-3 w-3 animate-spin text-primary" /> working…
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={2}
            disabled={!configured || running}
            placeholder={
              configured
                ? "Describe a contract to build and deploy…"
                : "Configure an API key to use the agent"
            }
            className="flex-1 resize-none rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none disabled:opacity-50"
          />
          {running ? (
            <button
              onClick={stop}
              className="rounded border border-border p-2 text-meta hover:text-danger"
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!configured || !input.trim()}
              className="rounded bg-primary p-2 text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
              title="Run (Enter)"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TimelineRow({ item, explorerUrl }: { item: TimelineItem; explorerUrl: string }) {
  if (item.type === "tool") return <StepCard step={item.step} explorerUrl={explorerUrl} />;

  const isUser = item.type === "user";
  return (
    <div
      className={cn("font-mono text-[11px]", isUser ? "text-foreground" : "text-muted-foreground")}
    >
      <div className="mb-0.5 text-[9px] uppercase tracking-wider text-meta">
        {isUser ? "You" : "Agent"}
      </div>
      <div
        className={cn(
          "rounded border p-2",
          isUser ? "border-border bg-background" : "border-primary/20 bg-primary/5",
        )}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap leading-relaxed">{item.text}</p>
        ) : (
          renderAgentText(item.text)
        )}
      </div>
    </div>
  );
}

// Render the agent's prose + code blocks, hiding the trailing @@DIRECTIVE line
// (it's machine-facing, not for the reader).
function renderAgentText(text: string) {
  const cleaned = text.replace(/^\s*@@(COMPILE|DEPLOY|DONE)\b.*$/gim, "").trimEnd();
  const parts = cleaned.split(/```(?:solidity|sol)?\n?/g);
  return parts.map((part, i) => {
    const isCode = i % 2 === 1;
    if (!isCode)
      return part.trim() ? (
        <p key={i} className="whitespace-pre-wrap leading-relaxed">
          {part.trim()}
        </p>
      ) : null;
    const code = part.replace(/\n```\s*$/, "").replace(/```$/, "");
    return <CodeChunk key={i} code={code} />;
  });
}

function CodeChunk({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-1.5 overflow-hidden rounded border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="font-mono text-[9px] uppercase tracking-wider text-meta">solidity</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="flex items-center gap-1 text-[9px] text-meta hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
      <pre className="max-h-72 overflow-auto p-2 text-[10px] leading-relaxed text-foreground">
        {code}
      </pre>
    </div>
  );
}

function StepCard({ step, explorerUrl }: { step: ToolStep; explorerUrl: string }) {
  const Icon = step.kind === "deploy" ? Rocket : Hammer;
  const statusIcon =
    step.status === "running" ? (
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
    ) : step.status === "ok" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-success" />
    ) : (
      <XCircle className="h-3.5 w-3.5 text-danger" />
    );
  return (
    <div
      className={cn(
        "rounded border bg-background p-2 font-mono text-[11px]",
        step.status === "error" ? "border-danger/40" : "border-border",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-meta" />
        <span className="font-semibold text-foreground">{step.title}</span>
        <span className="ml-auto">{statusIcon}</span>
      </div>
      {step.detail && (
        <pre className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-muted-foreground">
          {step.detail}
        </pre>
      )}
      {step.address && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]">
          <CopyInline label="Address" value={step.address} />
          <a
            href={`${explorerUrl}/address/${step.address}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            View on explorer <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      )}
      {step.txHash && !step.address && (
        <div className="mt-1.5 text-[10px]">
          <CopyInline label="Tx" value={step.txHash} />
        </div>
      )}
    </div>
  );
}

function CopyInline({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
      title={`Copy ${label.toLowerCase()}`}
    >
      <span className="text-meta">{label}:</span>
      <span className="text-foreground">
        {value.slice(0, 10)}…{value.slice(-6)}
      </span>
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
