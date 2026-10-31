import { useState } from "react";
import { Check, ChevronDown, Crown, Hexagon } from "lucide-react";
import anthropicLogo from "@/assets/model-logos/anthropic.svg?raw";
import googleLogo from "@/assets/model-logos/google.svg?raw";
import openaiLogo from "@/assets/model-logos/openai.svg?raw";
import qwenLogo from "@/assets/model-logos/qwen.svg?raw";
import {
  AGENT_MODELS,
  AUTO_MODEL,
  MODES,
  isPremiumModel,
  modelLabel,
  type AgentMode,
  type ModelFamily,
} from "@/lib/coding-agent/models";
import { cn } from "@/lib/utils";
import { Modal } from "./primitives";

// The two choices beside the prompt, as Base44 lays them out: which model
// ("Auto" until you pick one) and how to work (Build straight away, or Plan
// first). Each opens a sheet with one row per option and a tick on the
// current one. Qwen is free; every other model carries a crown that opens the
// upgrade sheet until the account has Pro or launch credit.

// Bundled SVG text from Lobe Icons (src/assets/model-logos), not user input.
const LOGOS: Record<ModelFamily, string> = {
  anthropic: anthropicLogo,
  openai: openaiLogo,
  google: googleLogo,
  qwen: qwenLogo,
};

/** A model's own logo, or the Auto mark. */
export function ModelLogo({ id, className }: { id: string; className?: string }) {
  const family = AGENT_MODELS.find((m) => m.id === id)?.family;
  if (!family) return <Hexagon className={cn("shrink-0 text-muted-foreground", className)} />;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 text-foreground [&>svg]:h-full [&>svg]:w-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: LOGOS[family] }}
    />
  );
}

export function ModeSheet({
  value,
  onChange,
  onClose,
}: {
  value: AgentMode;
  onChange: (m: AgentMode) => void;
  onClose: () => void;
}) {
  return (
    <Modal onClose={onClose} title=" ">
      <ul className="-mt-2">
        {MODES.map((m) => (
          <li key={m.id}>
            <button
              onClick={() => {
                onChange(m.id);
                onClose();
              }}
              className="flex w-full items-center gap-4 rounded-xl px-2 py-3.5 text-left hover:bg-surface-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[16px] text-foreground">{m.label}</span>
                <span className="block text-[13.5px] text-muted-foreground">{m.blurb}</span>
              </span>
              {value === m.id && <Check className="h-5 w-5 shrink-0 text-foreground" />}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function ModelSheet({
  value,
  onChange,
  onClose,
  unlocked,
  onUpgrade,
}: {
  value: string;
  onChange: (id: string) => void;
  onClose: () => void;
  /** The account has Pro or launch credit left. */
  unlocked: boolean;
  onUpgrade: () => void;
}) {
  const [more, setMore] = useState(AGENT_MODELS.some((m) => m.more && m.id === value));
  const pick = (id: string) => {
    onChange(id);
    onClose();
  };
  const row = (id: string, label: string, nested?: boolean) => {
    const locked = isPremiumModel(id) && !unlocked;
    return (
      <div
        key={id}
        className={cn(
          "flex items-center gap-2 rounded-xl hover:bg-surface-2",
          nested ? "pl-4" : "",
        )}
      >
        <button
          onClick={() => (locked ? onUpgrade() : pick(id))}
          className="flex min-w-0 flex-1 items-center gap-3.5 px-2 py-2.5 text-left"
        >
          <ModelLogo id={id} className={cn("h-5 w-5", locked && "opacity-50")} />
          <span
            className={cn(
              "min-w-0 flex-1 text-[15px]",
              locked ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {label}
          </span>
          {!locked && value === id && <Check className="h-5 w-5 shrink-0 text-foreground" />}
        </button>
        {locked && (
          <button
            onClick={onUpgrade}
            title={`Upgrade to use ${label}`}
            aria-label={`Upgrade to use ${label}`}
            className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/60 bg-primary/10 text-primary transition hover:bg-primary/20"
          >
            <Crown className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  };
  return (
    <Modal onClose={onClose} title="Select model">
      <div className="-mt-1">
        {row(AUTO_MODEL, "Auto")}
        {AGENT_MODELS.filter((m) => !m.more).map((m) => row(m.id, m.label))}
        <div className="my-2 border-t border-border" />
        <button
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className="flex w-full items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 text-[15px] text-foreground"
        >
          More models
          <ChevronDown className={cn("h-4 w-4 transition", more && "rotate-180")} />
        </button>
        {more && AGENT_MODELS.filter((m) => m.more).map((m) => row(m.id, m.label, true))}
        <p className="mt-3 px-2 text-[11px] leading-5 text-meta">
          Auto and Qwen 3.8 27B are free. The others need Pro or launch credit: tap the crown.
        </p>
      </div>
    </Modal>
  );
}

/** The model button beside the prompt: an icon and the model's name. */
export function ModelButton({
  value,
  onClick,
  compact,
}: {
  value: string;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Select model"
      className={cn(
        "inline-flex shrink-0 items-center gap-2 border border-border text-foreground/90 transition hover:border-primary/40 hover:text-foreground",
        compact ? "h-8 rounded-full px-3 text-[11.5px]" : "h-8 rounded-lg px-2.5 text-[12px]",
      )}
    >
      <ModelLogo id={value} className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
      {modelLabel(value)}
    </button>
  );
}

/** The mode button: "Build ▾" or "Plan ▾". */
export function ModeButton({
  value,
  onClick,
  compact,
}: {
  value: AgentMode;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Build or plan first"
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 border border-border text-foreground/90 transition hover:border-primary/40 hover:text-foreground",
        compact ? "h-8 rounded-full px-3 text-[11.5px]" : "h-8 rounded-lg px-2.5 text-[12px]",
        value === "plan" && "border-primary/50 text-primary",
      )}
    >
      {value === "plan" ? "Plan" : "Build"}
      <ChevronDown className="h-3.5 w-3.5" />
    </button>
  );
}
