import { useMemo, useState } from "react";
import {
  ChevronRight,
  Circle,
  CircleCheck,
  CircleX,
  FileCode2,
  FilePen,
  FileText,
  GitBranch,
  Globe,
  ListChecks,
  LoaderCircle,
  Search,
  Sparkles,
  SquareTerminal,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import type { ProjectTurn } from "@/lib/appgen/projects";
import {
  latestPlan,
  stepSummary,
  stepTarget,
  stepsFromEvents,
  toolKind,
  type AgentEvent,
  type PlanItem,
  type SavedStep,
  type Step,
  type ToolKind,
} from "@/lib/coding-agent/steps";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";

// The conversation, in the shape Claude Code on the web uses: what you asked,
// then the agent's work as a list of steps (each one a tool call you can open
// to see the command and what it printed), its checklist while it works, and
// its reply. A finished turn folds its steps into one line.

const ICON: Record<ToolKind, React.ComponentType<{ className?: string }>> = {
  read: FileText,
  write: FilePen,
  shell: SquareTerminal,
  search: Search,
  git: GitBranch,
  web: Globe,
  plan: ListChecks,
  other: Wrench,
};

export function UserMessage({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[88%] rounded-2xl rounded-br-md bg-surface-2 px-3.5 py-2 text-[13.5px] leading-6 text-foreground">
        <p className="whitespace-pre-wrap break-words">{text}</p>
      </div>
    </div>
  );
}

function AgentMark({ busy }: { busy?: boolean }) {
  return (
    <span
      className={cn(
        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary",
        busy && "animate-pulse",
      )}
    >
      <Sparkles className="h-3.5 w-3.5" />
    </span>
  );
}

export function AssistantMessage({
  turn,
  onOpenFile,
}: {
  turn: ProjectTurn;
  onOpenFile: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const steps = turn.steps ?? [];
  const summary = stepSummary(
    steps.map((s) => ({ tool: s.tool ?? null, status: s.failed ? "failed" : "done" })),
  );
  return (
    <div className="flex gap-2.5">
      <AgentMark />
      <div className="min-w-0 flex-1 space-y-2">
        {steps.length > 0 && (
          <div>
            <button
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md py-0.5 font-mono text-[11px] text-meta hover:text-muted-foreground"
            >
              <ChevronRight className={cn("h-3 w-3 transition", open && "rotate-90")} />
              {summary || `${steps.length} steps`}
            </button>
            {open && (
              <div className="mt-1 space-y-0.5 border-l border-border pl-3">
                {steps.map((s, i) => (
                  <SavedStepRow key={i} step={s} />
                ))}
              </div>
            )}
          </div>
        )}
        {turn.failed && (
          <p className="flex items-center gap-1.5 font-mono text-[11px] text-warning">
            <TriangleAlert className="h-3.5 w-3.5" /> Did not finish
          </p>
        )}
        <Markdown text={turn.text} />
        {turn.changed && turn.changed.length > 0 && (
          <ChangedFiles paths={turn.changed} onOpenFile={onOpenFile} />
        )}
      </div>
    </div>
  );
}

export function ChangedFiles({
  paths,
  onOpenFile,
}: {
  paths: string[];
  onOpenFile: (path: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? paths : paths.slice(0, 6);
  return (
    <div className="flex flex-wrap gap-1.5 pt-0.5">
      {shown.map((p) => (
        <button
          key={p}
          onClick={() => onOpenFile(p)}
          title={p}
          className="inline-flex max-w-[14rem] items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[11px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
        >
          <FileCode2 className="h-3 w-3 shrink-0 text-success" />
          <span className="truncate">{p.split("/").pop()}</span>
        </button>
      ))}
      {paths.length > shown.length && (
        <button
          onClick={() => setAll(true)}
          className="rounded-md px-1.5 py-0.5 font-mono text-[11px] text-meta hover:text-foreground"
        >
          +{paths.length - shown.length} more
        </button>
      )}
    </div>
  );
}

function SavedStepRow({ step }: { step: SavedStep }) {
  const Icon = ICON[toolKind(step.tool)];
  return (
    <p className="flex items-center gap-2 py-0.5 text-[12px] text-muted-foreground">
      <Icon className={cn("h-3.5 w-3.5 shrink-0", step.failed ? "text-danger" : "text-meta")} />
      <span className="truncate">{step.title}</span>
    </p>
  );
}

/** One tool call, opened to show the command and its output. */
export function StepRow({ step, defaultOpen }: { step: Step; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  if (step.status === "note") {
    return (
      <p
        className={cn(
          "flex items-start gap-2 py-1 text-[12px]",
          step.tone === "warning" ? "text-warning" : "text-meta",
        )}
      >
        <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span className="break-words">{step.title}</span>
      </p>
    );
  }
  const kind = toolKind(step.tool);
  const Icon = ICON[kind];
  const target = stepTarget(step);
  const expandable = !!step.output || (kind === "shell" && !!target);
  return (
    <div className="group">
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12.5px] transition",
          expandable ? "hover:bg-surface-2" : "cursor-default",
        )}
      >
        <Icon
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            step.status === "failed" ? "text-danger" : "text-muted-foreground",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-foreground/90">{step.title}</span>
        {step.status === "running" ? (
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : step.status === "failed" ? (
          <CircleX className="h-3.5 w-3.5 shrink-0 text-danger" />
        ) : (
          <CircleCheck className="h-3.5 w-3.5 shrink-0 text-success/80" />
        )}
        {expandable && (
          <ChevronRight
            className={cn("h-3 w-3 shrink-0 text-meta transition", open && "rotate-90")}
          />
        )}
      </button>
      {open && expandable && (
        <div className="mb-1 ml-6 mt-0.5 overflow-hidden rounded-md border border-border bg-background">
          {kind === "shell" && target && (
            <p className="border-b border-border px-2.5 py-1 font-mono text-[11px] text-code">
              <span className="text-meta">$ </span>
              {target}
            </p>
          )}
          {step.output ? (
            <pre className="max-h-64 overflow-auto px-2.5 py-1.5 font-mono text-[11px] leading-[1.55] text-muted-foreground">
              {step.output}
            </pre>
          ) : (
            <p className="px-2.5 py-1.5 font-mono text-[11px] text-meta">
              {step.status === "running" ? "Running…" : "No output."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function PlanCard({ plan }: { plan: PlanItem[] }) {
  const done = plan.filter((p) => p.status === "completed").length;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <ListChecks className="h-3 w-3" /> Plan · {done}/{plan.length}
      </p>
      <ul className="space-y-1">
        {plan.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-[12.5px] leading-5">
            {p.status === "completed" ? (
              <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            ) : p.status === "in_progress" ? (
              <LoaderCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
            ) : (
              <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-meta" />
            )}
            <span
              className={cn(
                p.status === "completed" && "text-muted-foreground line-through decoration-meta",
                p.status === "in_progress" && "text-foreground",
                p.status === "pending" && "text-muted-foreground",
              )}
            >
              {p.step}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SHOWN_STEPS = 8;

/** The turn in progress: checklist, steps as they happen, the reply as it
 *  streams in, and what the agent is doing right now. */
export function LiveTurn({
  events,
  reply,
  status,
}: {
  events: AgentEvent[];
  reply: string;
  status: string;
}) {
  const steps = useMemo(() => stepsFromEvents(events), [events]);
  const plan = useMemo(() => latestPlan(events), [events]);
  const [all, setAll] = useState(false);
  const hidden = all ? 0 : Math.max(0, steps.length - SHOWN_STEPS);
  return (
    <div className="flex gap-2.5">
      <AgentMark busy />
      <div className="min-w-0 flex-1 space-y-2">
        {plan && <PlanCard plan={plan} />}
        {steps.length > 0 && (
          <div className="space-y-0.5">
            {hidden > 0 && (
              <button
                onClick={() => setAll(true)}
                className="px-1.5 font-mono text-[11px] text-meta hover:text-foreground"
              >
                Show {hidden} earlier step{hidden === 1 ? "" : "s"}
              </button>
            )}
            {steps.slice(hidden).map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
          </div>
        )}
        {reply && <Markdown text={reply} />}
        <p className="flex items-center gap-2 text-[12px] text-meta">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
          </span>
          <span className="truncate">{status || "Working"}</span>
        </p>
      </div>
    </div>
  );
}
