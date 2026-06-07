import { useEffect, useRef, useState } from "react";
import {
  Send,
  Sparkles,
  AlertTriangle,
  Copy,
  Check,
  Square,
  Settings,
  Plus,
  History,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { chatStream, SOLIDITY_SYSTEM_PROMPT, type ChatMessage } from "@/lib/ai";
import { useAiSettings, AI_PROVIDERS, AI_PROVIDER_LIST } from "@/lib/ai-settings";
import { useAiChatStore, type ChatSession } from "@/lib/ai-chat-store";
import { useAiIntake } from "@/lib/ai-intake";
import { cn } from "@/lib/utils";

interface Props {
  /** Optional current file the user can attach as context. */
  contextLabel?: string;
  getContext?: () => string | null;
  /** Called when the user clicks "use code" on an assistant code block. */
  onUseCode?: (code: string) => void;
  className?: string;
  placeholder?: string;
}

// Shared chat UI for the editor AI panel and the standalone "Code with AI" page.
export function AiChat({ contextLabel, getContext, onUseCode, className, placeholder }: Props) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachContext, setAttachContext] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Persistent chat sessions (restored from localStorage, shared across the
  // editor panel and the standalone page).
  const sessions = useAiChatStore((s) => s.sessions);
  const activeId = useAiChatStore((s) => s.activeId);
  const hydrate = useAiChatStore((s) => s.hydrate);
  const newSession = useAiChatStore((s) => s.newSession);
  const setActive = useAiChatStore((s) => s.setActive);
  const deleteSession = useAiChatStore((s) => s.deleteSession);
  const setSessionMessages = useAiChatStore((s) => s.setSessionMessages);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  // Subscribe to settings so config-state changes (provider/key edits) re-render.
  const settings = useAiSettings();
  const configured = settings.proxy || !!(settings.keys[settings.provider] ?? "");

  // Send `rawText` to the model. When `attach` is set, the current file is
  // appended as context (used by the composer). Programmatic requests (the
  // editor's "Fix with AI") pass attach=false because they already embed the
  // source they care about.
  const sendMessage = async (rawText: string, attach: boolean) => {
    const text = rawText.trim();
    if (!text || busy || !configured) return;

    let userContent = text;
    if (attach && getContext) {
      const ctx = getContext();
      if (ctx && ctx.trim()) {
        userContent += `\n\n---\nCurrent contract (${contextLabel ?? "file"}):\n\`\`\`solidity\n${ctx}\n\`\`\``;
      }
    }

    // Pin all writes to one session id so an in-flight stream isn't redirected
    // if the user switches sessions mid-response.
    const sid = activeId ?? newSession();
    const next: ChatMessage[] = [...messages, { role: "user", content: userContent }];
    // Show the clean user text plus an empty assistant bubble to stream into.
    setSessionMessages(sid, (m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);
    setBusy(true);
    const controller = new AbortController();
    abortRef.current = controller;

    // Append a chunk to the streaming assistant message (always the last one).
    const appendToLast = (chunk: string) =>
      setSessionMessages(sid, (m) => {
        const copy = m.slice();
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, content: last.content + chunk };
        return copy;
      });

    try {
      await chatStream({
        system: SOLIDITY_SYSTEM_PROMPT,
        messages: next,
        signal: controller.signal,
        onDelta: appendToLast,
      });
    } catch (e) {
      // On abort, keep whatever streamed so far. Otherwise surface the error in
      // the assistant bubble (creating text if nothing streamed yet).
      if ((e as Error).name !== "AbortError") {
        const msg = e instanceof Error ? e.message : "Request failed";
        toast.error(msg);
        setSessionMessages(sid, (m) => {
          const copy = m.slice();
          const last = copy[copy.length - 1];
          const errText = `⚠ ${msg}`;
          copy[copy.length - 1] = {
            ...last,
            content: last.content ? `${last.content}\n\n${errText}` : errText,
          };
          return copy;
        });
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const send = () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    void sendMessage(text, attachContext);
  };

  const handleNewChat = () => {
    abortRef.current?.abort();
    newSession();
    setHistoryOpen(false);
    setInput("");
  };

  const handlePickSession = (id: string) => {
    abortRef.current?.abort();
    setActive(id);
    setHistoryOpen(false);
  };

  // Pick up a programmatic request (e.g. editor "Fix with AI") and auto-send it.
  const pending = useAiIntake((s) => s.pending);
  const consumeIntake = useAiIntake((s) => s.consume);
  useEffect(() => {
    if (!pending || !configured || busy) return;
    const text = consumeIntake();
    if (text) void sendMessage(text, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, configured, busy]);

  const stop = () => abortRef.current?.abort();

  // True while a request is in flight but no token has streamed yet.
  const last = messages[messages.length - 1];
  const awaitingFirstToken = busy && last?.role === "assistant" && last.content === "";

  return (
    <div className={cn("flex h-full flex-col bg-surface", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="font-mono text-xs font-semibold text-foreground">Code with AI</span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-meta">
          {settings.proxy
            ? "server proxy"
            : `${AI_PROVIDERS[settings.provider].label} · ${settings.model}`}
        </span>
        {!configured && (
          <span className="flex items-center gap-1 font-mono text-[10px] text-warning">
            <AlertTriangle className="h-3 w-3" /> not configured
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            onClick={handleNewChat}
            title="New chat"
            className="rounded p-1 text-meta hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              setHistoryOpen((o) => !o);
              setSettingsOpen(false);
            }}
            title="Chat history"
            className={cn(
              "rounded p-1 text-meta hover:text-foreground",
              historyOpen && "text-primary",
            )}
          >
            <History className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              setSettingsOpen((o) => !o);
              setHistoryOpen(false);
            }}
            className={cn(
              "rounded p-1 text-meta hover:text-foreground",
              settingsOpen && "text-primary",
            )}
            title="AI settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {historyOpen && (
        <SessionsPanel
          sessions={sessions}
          activeId={activeId}
          onPick={handlePickSession}
          onDelete={deleteSession}
        />
      )}

      {/* Messages */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <div className="space-y-2 font-mono text-[11px] text-meta">
            {configured ? (
              <>
                <p>Ask me to write, debug, or explain a contract.</p>
                <ul className="ml-3 list-disc space-y-1">
                  <li>"Is this contract safe? What bugs do you see?"</li>
                  <li>"Write an ERC-20 with a 2% transfer fee."</li>
                  <li>"Why does my deploy revert?"</li>
                </ul>
              </>
            ) : (
              <div className="rounded border border-warning/40 bg-warning/10 p-2.5 text-warning">
                The AI assistant needs an API key. Open the{" "}
                <Settings className="mb-0.5 inline h-3 w-3" /> settings above to pick a provider
                (Claude or an OpenAI-compatible endpoint) and paste your key.
              </div>
            )}
          </div>
        )}
        {messages.map((m, i) => {
          // Hide the empty assistant bubble until the first token lands; the
          // "thinking…" indicator stands in for it.
          if (awaitingFirstToken && i === messages.length - 1) return null;
          return <Message key={i} msg={m} onUseCode={onUseCode} />;
        })}
        {awaitingFirstToken && (
          <div className="flex items-center gap-2 font-mono text-[11px] text-meta">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> thinking…
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="border-t border-border p-2">
        {getContext && (
          <label className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] text-meta">
            <input
              type="checkbox"
              checked={attachContext}
              onChange={(e) => setAttachContext(e.target.checked)}
              className="h-3 w-3"
            />
            Attach current file{contextLabel ? ` (${contextLabel})` : ""}
          </label>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            rows={2}
            disabled={!configured}
            placeholder={configured ? (placeholder ?? "Ask the AI…") : "Configure API key to chat"}
            className="flex-1 resize-none rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none disabled:opacity-50"
          />
          {busy ? (
            <button
              onClick={stop}
              className="rounded border border-border p-2 text-meta hover:text-danger"
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={send}
              disabled={!configured || !input.trim()}
              className="rounded bg-primary p-2 text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
              title="Send (Enter)"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Saved-conversation list: switch or delete persisted chat sessions.
function SessionsPanel({
  sessions,
  activeId,
  onPick,
  onDelete,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onPick: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="max-h-56 space-y-0.5 overflow-y-auto border-b border-border bg-background/40 p-2">
      {sessions.length === 0 ? (
        <p className="px-1 py-2 font-mono text-[10px] text-meta">No saved chats yet.</p>
      ) : (
        sessions.map((s) => (
          <div
            key={s.id}
            className={cn(
              "group flex items-center gap-2 rounded px-2 py-1",
              s.id === activeId ? "bg-primary/10" : "hover:bg-background",
            )}
          >
            <button
              onClick={() => onPick(s.id)}
              className="flex min-w-0 flex-1 items-baseline gap-1.5 text-left"
            >
              <span className="truncate font-mono text-[11px] text-foreground">{s.title}</span>
              <span className="shrink-0 font-mono text-[9px] text-meta">
                {relTime(s.updatedAt)}
              </span>
            </button>
            <button
              onClick={() => onDelete(s.id)}
              title="Delete chat"
              className="shrink-0 text-meta opacity-0 transition group-hover:opacity-100 hover:text-danger"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))
      )}
    </div>
  );
}

function relTime(ts: number): string {
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// Provider + endpoint/key/model configuration. Writes straight through to the
// persisted ai-settings store.
function SettingsPanel({ onClose }: { onClose: () => void }) {
  const s = useAiSettings();
  const preset = AI_PROVIDERS[s.provider];
  // Local key draft so the user explicitly Saves (per the request).
  const [keyDraft, setKeyDraft] = useState(s.keys[s.provider] ?? "");
  useEffect(() => {
    setKeyDraft(s.keys[s.provider] ?? "");
  }, [s.provider, s.keys]);

  const fieldCls =
    "w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-meta focus:border-primary focus:outline-none";
  const labelCls = "mb-0.5 block font-mono text-[9px] uppercase tracking-wider text-meta";

  if (s.proxy) {
    return (
      <div className="space-y-2 border-b border-border bg-background/40 p-3">
        <div className="rounded border border-primary/30 bg-primary/5 p-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Requests route through this app's <span className="text-primary">server proxy</span> —
          your API key stays server-side and is never sent to the browser.
        </div>
        <div className="flex justify-end">
          <button onClick={onClose} className="font-mono text-[10px] text-primary hover:underline">
            Done
          </button>
        </div>
      </div>
    );
  }

  const saveKey = () => {
    s.setKey(keyDraft.trim());
    toast.success(keyDraft.trim() ? "API key saved" : "API key cleared");
    onClose();
  };

  return (
    <div className="space-y-2.5 border-b border-border bg-background/40 p-3">
      {/* Provider */}
      <div>
        <label className={labelCls}>Provider</label>
        <div className="grid grid-cols-2 gap-1">
          {AI_PROVIDER_LIST.map((p) => (
            <button
              key={p.id}
              onClick={() => s.setProvider(p.id)}
              className={cn(
                "rounded border px-2 py-1 text-left font-mono text-[10px] transition",
                s.provider === p.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-meta hover:text-foreground",
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Model (from the provider's hardcoded list) */}
      <div>
        <label className={labelCls}>Model</label>
        <select className={fieldCls} value={s.model} onChange={(e) => s.setModel(e.target.value)}>
          {preset.models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>

      {/* Endpoint (read-only, hardcoded per provider) */}
      <div>
        <label className={labelCls}>Endpoint</label>
        <div className="truncate rounded border border-border bg-surface px-2 py-1 font-mono text-[10px] text-meta">
          {preset.endpoint}
        </div>
      </div>

      {/* API key + explicit save */}
      <div>
        <label className={labelCls}>API key</label>
        <input
          className={fieldCls}
          type="password"
          value={keyDraft}
          onChange={(e) => setKeyDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && saveKey()}
          placeholder={preset.keyPlaceholder}
        />
        {preset.keyHint && (
          <p className="mt-0.5 font-mono text-[9px] text-meta">Get a key: {preset.keyHint}</p>
        )}
      </div>

      <p className="font-mono text-[9px] leading-relaxed text-meta">
        Stored in this browser only (until you clear your cache). Use a personal key, not a shared
        production one.
      </p>
      <div className="flex items-center justify-between">
        <button
          onClick={() => s.reset()}
          className="font-mono text-[10px] text-meta hover:text-foreground"
        >
          Reset
        </button>
        <button
          onClick={saveKey}
          className="rounded bg-primary px-3 py-1 font-mono text-[10px] font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Save
        </button>
      </div>
    </div>
  );
}

function Message({ msg, onUseCode }: { msg: ChatMessage; onUseCode?: (code: string) => void }) {
  const isUser = msg.role === "user";
  return (
    <div
      className={cn("font-mono text-[11px]", isUser ? "text-foreground" : "text-muted-foreground")}
    >
      <div className="mb-0.5 text-[9px] uppercase tracking-wider text-meta">
        {isUser ? "You" : "AI"}
      </div>
      <div
        className={cn(
          "rounded border p-2",
          isUser ? "border-border bg-background" : "border-primary/20 bg-primary/5",
        )}
      >
        {renderContent(msg.content, onUseCode)}
      </div>
    </div>
  );
}

// Splits assistant text into prose + fenced code blocks, with a copy / use-code
// action on each block.
function renderContent(content: string, onUseCode?: (code: string) => void) {
  const parts = content.split(/```(?:solidity|sol)?\n?/g);
  return parts.map((part, i) => {
    const isCode = i % 2 === 1;
    if (!isCode) {
      return part ? (
        <p key={i} className="whitespace-pre-wrap leading-relaxed">
          {part}
        </p>
      ) : null;
    }
    const code = part.replace(/\n```\s*$/, "").replace(/```$/, "");
    return <CodeChunk key={i} code={code} onUseCode={onUseCode} />;
  });
}

function CodeChunk({ code, onUseCode }: { code: string; onUseCode?: (code: string) => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="my-1.5 overflow-hidden rounded border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <span className="font-mono text-[9px] uppercase tracking-wider text-meta">solidity</span>
        <div className="flex gap-2">
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
          {onUseCode && (
            <button
              onClick={() => onUseCode(code)}
              className="text-[9px] text-primary hover:underline"
            >
              use code
            </button>
          )}
        </div>
      </div>
      <pre className="overflow-x-auto p-2 text-[10px] leading-relaxed text-foreground">{code}</pre>
    </div>
  );
}
