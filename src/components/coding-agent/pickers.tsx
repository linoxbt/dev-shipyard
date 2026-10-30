import { useState } from "react";
import { Aperture, Asterisk, Check, ChevronDown, Hexagon, Sparkle } from "lucide-react";
import {
  AGENT_MODELS,
  AUTO_MODEL,
  MODES,
  modelLabel,
  type AgentMode,
  type ModelFamily,
} from "@/lib/coding-agent/models";
import { cn } from "@/lib/utils";
import { Modal } from "./primitives";

// The two choices beside the prompt, as Base44 lays them out: which model
// ("Auto" until you pick one) and how to work (Build straight away, or Plan
// first). Each opens a sheet with one row per option and a tick on the
// current one.

const FAMILY_ICON: Record<ModelFamily, React.ComponentType<{ className?: string }>> = {
  anthropic: Asterisk,
  openai: Aperture,
  google: Sparkle,
};

function modelIcon(id: string): React.ComponentType<{ className?: string }> {
  const m = AGENT_MODELS.find((x) => x.id === id);
  return m ? FAMILY_ICON[m.family] : Hexagon;
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
                <span className="block text-[17px] text-foreground">{m.label}</span>
                <span className="block text-[14.5px] text-muted-foreground">{m.blurb}</span>
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
}: {
  value: string;
  onChange: (id: string) => void;
  onClose: () => void;
}) {
  const [more, setMore] = useState(AGENT_MODELS.some((m) => m.more && m.id === value));
  const pick = (id: string) => {
    onChange(id);
    onClose();
  };
  const row = (
    id: string,
    label: string,
    Icon: React.ComponentType<{ className?: string }>,
    nested?: boolean,
  ) => (
    <button
      key={id}
      onClick={() => pick(id)}
      className={cn(
        "flex w-full items-center gap-3.5 rounded-xl py-2.5 text-left hover:bg-surface-2",
        nested ? "pl-6 pr-2" : "px-2",
      )}
    >
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 text-[16px] text-foreground">{label}</span>
      {value === id && <Check className="h-5 w-5 shrink-0 text-foreground" />}
    </button>
  );
  return (
    <Modal onClose={onClose} title="Select model">
      <div className="-mt-1">
        {row(AUTO_MODEL, "Auto", Hexagon)}
        {AGENT_MODELS.filter((m) => !m.more).map((m) => row(m.id, m.label, FAMILY_ICON[m.family]))}
        <div className="my-2 border-t border-border" />
        <button
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          className="flex w-full items-center justify-between rounded-xl bg-surface-2 px-3 py-2.5 text-[16px] text-foreground"
        >
          More models
          <ChevronDown className={cn("h-4 w-4 transition", more && "rotate-180")} />
        </button>
        {more &&
          AGENT_MODELS.filter((m) => m.more).map((m) =>
            row(m.id, m.label, FAMILY_ICON[m.family], true),
          )}
        <p className="mt-3 px-2 text-[12px] leading-5 text-meta">
          Auto uses the agent's default. A model the server has no key for says so when you send.
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
  const Icon = modelIcon(value);
  return (
    <button
      type="button"
      onClick={onClick}
      title="Select model"
      className={cn(
        "inline-flex shrink-0 items-center gap-2 border border-border text-foreground/90 transition hover:border-primary/40 hover:text-foreground",
        compact ? "h-8 rounded-full px-3 text-[12.5px]" : "h-10 rounded-xl px-3 text-[14px]",
      )}
    >
      <Icon className={compact ? "h-3.5 w-3.5" : "h-[18px] w-[18px]"} />
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
        compact ? "h-8 rounded-full px-3 text-[12.5px]" : "h-10 rounded-xl px-3.5 text-[14.5px]",
        value === "plan" && "border-primary/50 text-primary",
      )}
    >
      {value === "plan" ? "Plan" : "Build"}
      <ChevronDown className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
    </button>
  );
}
