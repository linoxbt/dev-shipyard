import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, LoaderCircle, Mic, Network, Square } from "lucide-react";
import { cn } from "@/lib/utils";

// The message box, in two shapes.
//
// "hero" is Base44's: a large card on the first screen with the text on top
// and a toolbar underneath (what to start from, the network, the microphone,
// a square send button).
//
// "dock" is Muse's: a rounded bar floating at the foot of the conversation,
// "+" on the left for quick asks, the send button a circle on the right.
//
// Both grow with what you type, send on Enter, and take dictation where the
// browser can do it.

interface SpeechResultEvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}
interface Recognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
}

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Speech to text through the browser's own recogniser, appended to `value`. */
function useDictation(value: string, onChange: (v: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  const base = useRef("");
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => setSupported(!!recognitionClass()), []);
  useEffect(() => () => rec.current?.stop(), []);

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = recognitionClass();
    if (!Ctor) return;
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    base.current = value ? `${value.trimEnd()} ` : "";
    r.onresult = (e) => {
      let finalText = "";
      let interim = "";
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      latest.current(`${base.current}${finalText}${interim}`);
    };
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    r.start();
    setListening(true);
  };
  return { supported, listening, toggle };
}

export function Composer({
  value,
  onChange,
  onSend,
  onStop,
  running,
  sending,
  canSend = true,
  placeholder,
  variant = "dock",
  tools,
  plus,
  network,
  notice,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop?: () => void;
  running?: boolean;
  sending?: boolean;
  canSend?: boolean;
  placeholder: string;
  variant?: "hero" | "dock";
  /** Hero: the left of the toolbar. */
  tools?: ReactNode;
  /** Dock: the "+" button on the left (usually a menu). */
  plus?: ReactNode;
  network?: string;
  notice?: ReactNode;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const hero = variant === "hero";
  const dictation = useDictation(value, onChange);

  // Grow to fit, up to a limit, then scroll.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, hero ? 280 : 200)}px`;
  }, [value, hero]);

  const disabled = !value.trim() || !!sending || !canSend;
  const send = () => {
    if (dictation.listening) dictation.toggle();
    onSend();
  };
  const textarea = (
    <textarea
      ref={ref}
      value={value}
      autoFocus={autoFocus}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          if (!disabled && !running) send();
        }
      }}
      rows={hero ? 3 : 1}
      placeholder={dictation.listening ? "Listening…" : placeholder}
      className={cn(
        "block w-full resize-none bg-transparent text-foreground placeholder:text-meta focus:outline-none",
        hero
          ? "min-h-[6rem] px-5 pt-5 text-[16px] leading-7"
          : "max-h-[200px] py-2.5 text-[15px] leading-6",
      )}
    />
  );
  const mic = dictation.supported ? (
    <button
      type="button"
      onClick={dictation.toggle}
      title={dictation.listening ? "Stop dictation" : "Dictate"}
      aria-pressed={dictation.listening}
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition",
        dictation.listening
          ? "bg-danger/15 text-danger"
          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      <Mic className="h-5 w-5" />
    </button>
  ) : null;

  if (hero) {
    return (
      <div className="rounded-3xl border border-border bg-surface shadow-2xl shadow-black/25 transition focus-within:border-primary/50">
        {notice && <div className="border-b border-border px-5 py-2">{notice}</div>}
        {textarea}
        <div className="flex items-center gap-2 px-3 pb-3 pt-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{tools}</div>
          {network && (
            <span
              className="hidden items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-[13.5px] text-muted-foreground sm:inline-flex"
              title="The network the agent uses when the work involves one. Change it in the sidebar."
            >
              <Network className="h-4 w-4" /> {network}
            </span>
          )}
          {mic}
          <button
            onClick={send}
            disabled={disabled}
            title="Send (Enter)"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:bg-primary-hover disabled:bg-primary/20 disabled:text-primary-foreground/50"
          >
            {sending ? (
              <LoaderCircle className="h-5 w-5 animate-spin" />
            ) : (
              <ArrowUp className="h-5 w-5" />
            )}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {notice && <div className="mb-2 px-2">{notice}</div>}
      <div className="flex items-end gap-1 rounded-[28px] border border-border bg-surface-2 py-1.5 pl-1.5 pr-1.5 shadow-xl shadow-black/25 transition focus-within:border-primary/50">
        {plus}
        <div className="min-w-0 flex-1 px-1">{textarea}</div>
        {!running && !value.trim() && mic}
        {running ? (
          <button
            onClick={onStop}
            title="Stop"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition hover:opacity-80"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : value.trim() || sending ? (
          <button
            onClick={send}
            disabled={disabled}
            title="Send (Enter)"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
          >
            {sending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-5 w-5" />
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A pill in the hero composer's toolbar. */
export function ToolChip({
  active,
  onClick,
  icon: Icon,
  children,
  title,
  as = "button",
}: {
  active?: boolean;
  onClick?: () => void;
  icon: React.ComponentType<{ className?: string }>;
  children?: ReactNode;
  title?: string;
  as?: "button" | "span";
}) {
  const Tag = as;
  return (
    <Tag
      {...(as === "button" ? { type: "button" as const, onClick } : {})}
      title={title}
      className={cn(
        "inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border px-3 text-[13.5px] transition",
        !children && "w-10 justify-center px-0",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border text-foreground/85 hover:border-primary/40 hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      {children}
    </Tag>
  );
}
