import { useEffect, useState } from "react";
import { ArrowUp, Check, MessageCircleQuestion, PenLine, X } from "lucide-react";
import type { AgentQuestion } from "@/lib/coding-agent/steps";
import { cn } from "@/lib/utils";

// A decision the agent handed back, shown above the message box as a short
// list of choices: tap one (or press its number) and the agent carries on
// with it. "Something else" leaves the box to type your own answer.

export function QuestionPanel({
  question,
  onAnswer,
  onOwn,
  onDismiss,
}: {
  question: AgentQuestion;
  onAnswer: (answer: string) => void;
  /** Answer in your own words: focus the message box. */
  onOwn: () => void;
  onDismiss: () => void;
}) {
  const [picked, setPicked] = useState<number[]>([]);
  const multi = !!question.multiSelect;

  const choose = (i: number) => {
    if (!multi) return onAnswer(question.options[i].label);
    setPicked((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]));
  };

  // Number keys pick, when the person is not typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= question.options.length) {
        e.preventDefault();
        choose(n - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <div
      role="dialog"
      aria-label="The agent is asking you to decide"
      className="mb-2 overflow-hidden rounded-2xl border border-primary/30 bg-surface shadow-xl shadow-black/25"
    >
      <div className="flex items-start gap-2.5 px-4 pb-2 pt-3.5">
        <MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          {question.header && (
            <span className="mb-1 inline-block rounded-md bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-primary">
              {question.header}
            </span>
          )}
          <p className="text-[14px] font-medium leading-6 text-foreground">{question.question}</p>
          {multi && <p className="text-[11.5px] text-meta">Pick all that apply.</p>}
        </div>
        <button
          onClick={onDismiss}
          aria-label="Hide the question"
          className="rounded-lg p-1 text-meta transition hover:bg-surface-2 hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="px-2 pb-2">
        {question.options.map((o, i) => {
          const on = picked.includes(i);
          return (
            <button
              key={o.label}
              onClick={() => choose(i)}
              aria-pressed={multi ? on : undefined}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl px-2.5 py-2 text-left transition hover:bg-surface-2",
                on && "bg-primary/10",
              )}
            >
              <span
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border text-muted-foreground",
                )}
              >
                {on ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium text-foreground">{o.label}</span>
                {o.description && (
                  <span className="block text-[12px] leading-5 text-muted-foreground">
                    {o.description}
                  </span>
                )}
              </span>
            </button>
          );
        })}
        <div className="flex items-center gap-2 px-1 pt-1">
          <button
            onClick={onOwn}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
          >
            <PenLine className="h-3.5 w-3.5" /> Something else: type your answer
          </button>
          {multi && (
            <button
              onClick={() => onAnswer(picked.map((i) => question.options[i].label).join(", "))}
              disabled={!picked.length}
              className="ml-auto flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-1.5 text-[12.5px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-40"
            >
              Send <ArrowUp className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
