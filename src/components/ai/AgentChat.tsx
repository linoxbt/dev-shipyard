import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
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
  BookMarked,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  FileCode2,
} from "lucide-react";
import { toast } from "sonner";
import { useAiSettings, AI_PROVIDERS } from "@/lib/ai-settings";
import { useCodeAgent, type TimelineItem, type ToolStep } from "@/hooks/useCodeAgent";
import { useEditorIntake } from "@/lib/editor-intake";
import { contractNameOf } from "@/lib/solidity-name";
import { cn } from "@/lib/utils";

// Autonomous build surface for the Code with AI page: the AI generates,
// compiles, auto-fixes, and (with the user's wallet) deploys a contract,
// showing each tool step inline. Deploys are signed by the connected wallet on
// the currently selected network.
export function AgentChat({ className }: { className?: string }) {
  const [input, setInput] = useState("");
  const settings = useAiSettings();
  const configured = settings.proxy || !!(settings.keys[settings.provider] ?? "");

  const {
    timeline,
    running,
    run,
    stop,
    reset,
    submitDeployForm,
    cancelDeployForm,
    isConnected,
    targetChain,
    explorerSlug,
  } = useCodeAgent();

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
          <TimelineRow
            key={i}
            item={item}
            explorerSlug={explorerSlug}
            running={running}
            isConnected={isConnected}
            onSubmitForm={submitDeployForm}
            onCancelForm={cancelDeployForm}
          />
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

function TimelineRow({
  item,
  explorerSlug,
  running,
  isConnected,
  onSubmitForm,
  onCancelForm,
}: {
  item: TimelineItem;
  explorerSlug: string;
  running: boolean;
  isConnected: boolean;
  onSubmitForm: (id: string, values: Record<string, string>) => void;
  onCancelForm: (id: string) => void;
}) {
  if (item.type === "tool") return <StepCard step={item.step} explorerSlug={explorerSlug} />;
  if (item.type === "deploy-form")
    return (
      <DeployForm
        item={item}
        running={running}
        isConnected={isConnected}
        onSubmit={onSubmitForm}
        onCancel={onCancelForm}
      />
    );

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
  const navigate = useNavigate();
  const setPending = useEditorIntake((s) => s.setPending);

  const openInEditor = () => {
    const name = contractNameOf(code) ?? "Contract";
    setPending(`${name}.sol`, code);
    toast.success(`Opening ${name}.sol in the Contract Editor`);
    void navigate({ to: "/launchkit/editor" });
  };

  return (
    <div className="my-1.5 overflow-hidden rounded border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="font-mono text-[9px] uppercase tracking-wider text-meta">solidity</span>
        <div className="flex items-center gap-2">
          <button
            onClick={openInEditor}
            className="flex items-center gap-1 text-[9px] text-primary hover:underline"
            title="Open in Contract Editor"
          >
            <FileCode2 className="h-3 w-3" /> editor
          </button>
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
      </div>
      <pre className="max-h-72 overflow-auto p-2 text-[10px] leading-relaxed text-foreground">
        {code}
      </pre>
    </div>
  );
}

// Constructor-args form: shown when a deploy needs inputs, so the user reviews/
// edits the agent's suggested values and confirms before signing.
function DeployForm({
  item,
  running,
  isConnected,
  onSubmit,
  onCancel,
}: {
  item: Extract<TimelineItem, { type: "deploy-form" }>;
  running: boolean;
  isConnected: boolean;
  onSubmit: (id: string, values: Record<string, string>) => void;
  onCancel: (id: string) => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(item.suggested);
  const done = item.status !== "pending";

  return (
    <div
      className={cn(
        "rounded border bg-background p-3 font-mono text-[11px]",
        done ? "border-border opacity-70" : "border-primary/40",
      )}
    >
      <div className="flex items-center gap-2">
        <Rocket className="h-3.5 w-3.5 text-primary" />
        <span className="font-semibold text-foreground">
          Deploy {item.artifactName} — set constructor arguments
        </span>
      </div>
      <div className="mt-2 space-y-2">
        {item.inputs.map((inp) => (
          <label key={inp.name} className="block">
            <span className="text-[10px] text-meta">
              {inp.name} <span className="text-muted-foreground">({inp.type})</span>
            </span>
            <input
              value={values[inp.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [inp.name]: e.target.value }))}
              disabled={done}
              placeholder={inp.type}
              className="mt-0.5 w-full rounded border border-border bg-surface px-2 py-1 text-[11px] text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
            />
          </label>
        ))}
      </div>

      {item.status === "pending" ? (
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => onSubmit(item.id, values)}
            disabled={running || !isConnected}
            className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-[11px] font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
          >
            <Rocket className="h-3.5 w-3.5" /> Deploy &amp; sign
          </button>
          <button
            onClick={() => onCancel(item.id)}
            disabled={running}
            className="rounded border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            Cancel
          </button>
          {!isConnected && (
            <span className="text-[10px] text-warning">Connect a wallet first.</span>
          )}
        </div>
      ) : (
        <div className="mt-2 text-[10px] text-meta">
          {item.status === "submitted" ? "Submitted." : "Cancelled."}
        </div>
      )}
    </div>
  );
}

function StepCard({ step, explorerSlug }: { step: ToolStep; explorerSlug: string }) {
  const Icon = step.kind === "deploy" ? Rocket : step.kind === "record" ? BookMarked : Hammer;
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
          <Link
            to="/explorer/$network/address/$hash"
            params={{ network: explorerSlug, hash: step.address }}
            className="inline-flex items-center gap-1 text-primary hover:underline"
          >
            View on DevStation explorer <ExternalLink className="h-3 w-3" />
          </Link>
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
