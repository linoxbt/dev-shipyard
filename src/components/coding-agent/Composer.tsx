import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, LoaderCircle, Mic, Square } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// The message box, in two shapes.
//
// "hero" is Base44's: a large card on the first screen with the text on top
// and a toolbar underneath (what to start from, the model, the microphone,
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
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

/** Failures that end dictation, in words. Anything else ("no-speech" after a
 *  pause, "aborted") only ends one listening session, and the next starts. */
const DICTATION_ERRORS: Record<string, string> = {
  "not-allowed":
    "Microphone access is blocked. Allow it for this site in your browser's settings, then try again.",
  "service-not-allowed": "Your browser does not allow dictation here.",
  "audio-capture": "No microphone was found.",
  network: "Dictation needs your browser's speech service, which could not be reached.",
};

/** Sessions in a row that end within this long without hearing anything mean
 *  the recogniser is failing, not that the person paused. */
const QUICK_END_MS = 1000;
const MAX_QUICK_ENDS = 5;

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Speech to text through the browser's own recogniser, appended to `value`.
 *
 * Listens until the person taps the microphone again or sends. Browsers end a
 * recognition session on their own (phones after every phrase, desktops after
 * a long pause), so each time one ends while dictation is still on, the next
 * starts, carrying on after the words already written.
 */
function useDictation(value: string, onChange: (v: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const rec = useRef<Recognition | null>(null);
  /** Dictation is on: a session that ends is followed by another. */
  const wanted = useRef(false);
  /** The text before this session's words. */
  const base = useRef("");
  /** The box's text, as of the last render or the last words written. */
  const current = useRef(value);
  current.current = value;
  const latest = useRef(onChange);
  latest.current = onChange;

  useEffect(() => setSupported(!!recognitionClass()), []);
  useEffect(
    () => () => {
      wanted.current = false;
      rec.current?.abort();
    },
    [],
  );

  const finish = (how: "stop" | "abort") => {
    wanted.current = false;
    setListening(false);
    const r = rec.current;
    rec.current = null;
    if (how === "abort") r?.abort();
    else r?.stop();
  };

  const begin = () => {
    const Ctor = recognitionClass();
    if (!Ctor) return;
    const r = new Ctor();
    // Chrome on Android repeats itself in continuous mode, so phones take one
    // phrase per session and the next session follows (onend below).
    r.continuous = !/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    r.interimResults = true;
    r.lang = navigator.language || "en-US";
    let started = 0;
    let heard = false;
    let quickEnds = 0;

    const session = () => {
      const before = current.current.trimEnd();
      base.current = before ? `${before} ` : "";
      started = Date.now();
      heard = false;
      r.start();
    };
    r.onresult = (e) => {
      if (!wanted.current || rec.current !== r) return;
      heard = true;
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      const next = `${base.current}${text}`;
      current.current = next;
      latest.current(next);
    };
    r.onerror = (e) => {
      const why = DICTATION_ERRORS[e.error ?? ""];
      if (!why || rec.current !== r) return;
      finish("abort");
      toast.error(why);
    };
    r.onend = () => {
      if (!wanted.current || rec.current !== r) return;
      quickEnds = !heard && Date.now() - started < QUICK_END_MS ? quickEnds + 1 : 0;
      if (quickEnds >= MAX_QUICK_ENDS) {
        finish("abort");
        toast.error("Dictation keeps stopping. Tap the microphone to try again.");
        return;
      }
      try {
        session();
      } catch {
        finish("abort");
      }
    };

    rec.current = r;
    wanted.current = true;
    try {
      session();
      setListening(true);
    } catch {
      wanted.current = false;
      rec.current = null;
      toast.error("Dictation could not start. Try again.");
    }
  };

  const toggle = () => (wanted.current ? finish("stop") : begin());
  /** Sending: stop now, and drop words still on their way so they do not
   *  land in the emptied box. */
  const cancel = () => {
    if (wanted.current) finish("abort");
  };
  return { supported, listening, toggle, cancel };
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
  trailing,
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
  /** Hero: beside the send button, before the microphone. */
  trailing?: ReactNode;
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
    dictation.cancel();
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
          ? "min-h-[6rem] px-5 pt-5 text-[15px] leading-7"
          : "max-h-[200px] py-2.5 text-[14px] leading-6",
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
        "flex shrink-0 items-center justify-center rounded-full transition",
        hero ? "h-8 w-8" : "h-10 w-10",
        dictation.listening
          ? "bg-danger/15 text-danger"
          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
      )}
    >
      <Mic className={hero ? "h-4 w-4" : "h-5 w-5"} />
    </button>
  ) : null;

  if (hero) {
    return (
      <div className="rounded-3xl border border-border bg-surface shadow-2xl shadow-black/25 transition focus-within:border-primary/50">
        {notice && <div className="border-b border-border px-5 py-2">{notice}</div>}
        {textarea}
        <div className="flex items-center gap-1.5 px-3 pb-2.5 pt-1.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{tools}</div>
          {trailing}
          {mic}
          <button
            onClick={send}
            disabled={disabled}
            title="Send (Enter)"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary-hover disabled:bg-primary/20 disabled:text-primary-foreground/50"
          >
            {sending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUp className="h-4 w-4" />
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
        "inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12px] transition",
        !children && "w-8 justify-center px-0",
        active
          ? "border-primary/50 bg-primary/10 text-primary"
          : "border-border text-foreground/85 hover:border-primary/40 hover:text-foreground",
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {children}
    </Tag>
  );
}
