// Stacks variant of Code with AI — rendered by /launchkit/ai when the active
// family is Stacks. Reuses the language-agnostic AI transport (src/lib/ai) with
// the Clarity + post-condition system prompt.

import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { Sparkles, Send, Loader2, Copy, Check, Square } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { chatStream, isAiConfigured, type ChatMessage } from "@/lib/ai";
import { CLARITY_SYSTEM_PROMPT } from "@/lib/stacks/ai-prompts";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Write a SIP-010 token and the post-conditions to transfer it safely",
  "Explain post-condition mode: deny vs allow, with an example",
  "Audit this Clarity contract's asset-transfer paths",
  "Generate the Pc post-condition for an sBTC transfer",
];

export function StacksAiView() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const configured = isAiConfigured();

  const send = async (text: string) => {
    if (!text.trim() || streaming) return;
    if (!configured) {
      toast.error("Configure an AI provider + key in Settings first.");
      return;
    }
    const next: ChatMessage[] = [...messages, { role: "user", content: text.trim() }];
    setMessages([...next, { role: "assistant", content: "" }]);
    setInput("");
    setStreaming(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await chatStream({
        system: CLARITY_SYSTEM_PROMPT,
        messages: next,
        signal: ac.signal,
        onDelta: (chunk) => {
          setMessages((prev) => {
            const copy = [...prev];
            copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + chunk };
            return copy;
          });
        },
      });
    } catch (e) {
      if (!ac.signal.aborted) {
        toast.error(e instanceof Error ? e.message : "AI request failed");
        setMessages((prev) => prev.slice(0, -1));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col">
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Code with AI"]}
        title="Code with AI"
        subtitle="Clarity assistant — always proposes post-conditions with contract calls."
        action={<Sparkles className="h-5 w-5 text-primary" />}
      />

      <div className="flex-1 overflow-y-auto p-4 lg:p-6">
        {messages.length === 0 ? (
          <div className="mx-auto max-w-2xl">
            <div className="mb-4 flex items-center gap-2 font-mono text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4 text-primary" /> Ask anything about building on Stacks with Clarity.
            </div>
            {!configured && (
              <div className="mb-4 rounded border border-warning/40 bg-warning/10 p-3 font-mono text-xs text-warning">
                AI isn&apos;t configured yet. Add a provider and API key in{" "}
                <Link to="/settings" className="underline">
                  Settings
                </Link>
                .
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="rounded border border-border bg-surface p-3 text-left font-mono text-xs text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-3xl space-y-4">
            {messages.map((m, i) => (
              <Message key={i} role={m.role} content={m.content} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border p-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={1}
            placeholder="Ask about Clarity, post-conditions, SIP-010/009…"
            className="flex-1 resize-none rounded border border-border bg-surface px-3 py-2 font-mono text-sm text-foreground outline-none focus:border-primary"
          />
          {streaming ? (
            <button onClick={() => abortRef.current?.abort()} className="inline-flex items-center gap-1 rounded border border-border px-3 py-2 font-mono text-sm text-danger hover:border-danger">
              <Square className="h-4 w-4" /> Stop
            </button>
          ) : (
            <button
              onClick={() => send(input)}
              disabled={!input.trim()}
              className="inline-flex items-center gap-1 rounded bg-primary px-3 py-2 font-mono text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Message({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-full rounded border px-3 py-2 font-mono text-xs leading-relaxed",
          isUser ? "border-primary/40 bg-primary/10 text-foreground" : "border-border bg-surface text-muted-foreground",
        )}
      >
        {content === "" ? <Loader2 className="h-4 w-4 animate-spin text-meta" /> : <MessageBody content={content} />}
      </div>
    </div>
  );
}

function MessageBody({ content }: { content: string }) {
  const parts = content.split(/```/);
  return (
    <div className="space-y-2">
      {parts.map((part, i) => {
        const isCode = i % 2 === 1;
        if (!isCode) {
          return part.trim() ? (
            <p key={i} className="whitespace-pre-wrap text-foreground/90">
              {part}
            </p>
          ) : null;
        }
        const firstNl = part.indexOf("\n");
        const code = firstNl >= 0 ? part.slice(firstNl + 1) : part;
        return <CodeBlock key={i} code={code} />;
      })}
    </div>
  );
}

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative rounded border border-border bg-background">
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="absolute right-2 top-2 rounded border border-border bg-surface px-1.5 py-1 text-meta hover:text-foreground"
        title="Copy code"
      >
        {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
      </button>
      <pre className="overflow-x-auto p-3 text-[11px] text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  );
}
