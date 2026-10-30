import { useMemo, useState } from "react";
import {
  ChevronRight,
  Circle,
  Copy,
  Ellipsis,
  RotateCcw,
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
import { Dropdown, MenuItem } from "./primitives";

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

/** The agent at the head of the conversation, the way Muse introduces itself:
 *  a round face and a name pill. */
export function AgentIntro({ name, busy }: { name: string; busy?: boolean }) {
  return (
    <div className="flex flex-col items-center pb-2 pt-4">
      <span
        className={cn(
          "relative flex h-20 w-20 items-center justify-center rounded-full bg-[radial-gradient(circle_at_35%_30%,color-mix(in_oklch,var(--primary)_55%,white),var(--primary)_60%,color-mix(in_oklch,var(--primary)_70%,black))] shadow-xl shadow-primary/20",
          busy && "animate-pulse",
        )}
      >
        <span className="-mt-2 flex gap-3">
          <span className="h-2.5 w-2 rounded-full bg-background/85" />
          <span className="h-2.5 w-2 rounded-full bg-background/85" />
        </span>
        <svg
          viewBox="0 0 20 10"
          className="absolute bottom-[22px] h-2.5 w-5 text-background/70"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          aria-hidden
        >
          <path d="M3 3 Q10 9 17 3" />
        </svg>
      </span>
      <span className="-mt-3 rounded-full border border-border bg-surface-2 px-3.5 py-1 text-[12.5px] font-medium text-foreground shadow">
        {name}
      </span>
    </div>
  );
}

/** "…" under a message: what you can do with it. */
function MessageMenu({
  align,
  children,
}: {
  align: "left" | "right";
  children: (close: () => void) => React.ReactNode;
}) {
  return (
    <div className={cn("mt-1 flex", align === "right" ? "justify-end pr-2" : "pl-2")}>
      <Dropdown
        label="Message options"
        align={align}
        triggerClassName="rounded-full px-1.5 py-0.5 text-meta transition hover:bg-surface-2 hover:text-foreground"
        trigger={() => <Ellipsis className="h-4 w-4" />}
      >
        {children}
      </Dropdown>
    </div>
  );
}

function copy(text: string) {
  void navigator.clipboard?.writeText(text);
}

export function UserMessage({
  text,
  plan,
  onAskAgain,
}: {
  text: string;
  plan?: boolean;
  onAskAgain?: () => void;
}) {
  return (
    <div>
      {plan && <p className="mb-1 pr-2 text-right text-[10.5px] text-primary">Plan first</p>}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[24px] bg-primary px-4 py-2.5 text-[14px] leading-6 text-primary-foreground">
          <p className="whitespace-pre-wrap break-words">{text}</p>
        </div>
      </div>
      <MessageMenu align="right">
        {(close) => (
          <>
            <MenuItem
              icon={Copy}
              onClick={() => {
                close();
                copy(text);
              }}
            >
              Copy
            </MenuItem>
            {onAskAgain && (
              <MenuItem
                icon={RotateCcw}
                onClick={() => {
                  close();
                  onAskAgain();
                }}
              >
                Ask again
              </MenuItem>
            )}
          </>
        )}
      </MessageMenu>
    </div>
  );
}

export function AssistantMessage({
  turn,
  onOpenFile,
  onBuildPlan,
}: {
  turn: ProjectTurn;
  onOpenFile: (path: string) => void;
  /** A plan waiting for approval: build it. */
  onBuildPlan?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const steps = turn.steps ?? [];
  const summary = stepSummary(
    steps.map((s) => ({ tool: s.tool ?? null, status: s.failed ? "failed" : "done" })),
  );
  return (
    <div>
      <div className="max-w-[92%] rounded-[24px] bg-surface-2 px-4 py-3">
        {steps.length > 0 && (
          <div className="mb-2">
            <button
              onClick={() => setOpen((v) => !v)}
              className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              <ChevronRight className={cn("h-3.5 w-3.5 transition", open && "rotate-90")} />
              {summary || `${steps.length} steps`}
            </button>
            {open && (
              <div className="mt-1.5 space-y-0.5 border-l border-border pl-3">
                {steps.map((s, i) => (
                  <SavedStepRow key={i} step={s} />
                ))}
              </div>
            )}
          </div>
        )}
        {turn.failed && (
          <p className="mb-1 flex items-center gap-1.5 text-[11.5px] text-warning">
            <TriangleAlert className="h-3.5 w-3.5" /> Did not finish
          </p>
        )}
        <Markdown text={turn.text} className="text-[14px] leading-[1.65]" />
        {turn.changed && turn.changed.length > 0 && (
          <div className="mt-2.5">
            <ChangedFiles paths={turn.changed} onOpenFile={onOpenFile} />
          </div>
        )}
        {onBuildPlan && (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <button
              onClick={onBuildPlan}
              className="rounded-full bg-primary px-4 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Build this plan
            </button>
            <span className="text-[11.5px] text-muted-foreground">
              Or reply with what to change first.
            </span>
          </div>
        )}
      </div>
      <MessageMenu align="left">
        {(close) => (
          <>
            <MenuItem
              icon={Copy}
              onClick={() => {
                close();
                copy(turn.text);
              }}
            >
              Copy reply
            </MenuItem>
            {turn.changed && turn.changed.length > 0 && (
              <MenuItem
                icon={FileCode2}
                onClick={() => {
                  close();
                  onOpenFile(turn.changed![0]);
                }}
              >
                Open the changed files
              </MenuItem>
            )}
          </>
        )}
      </MessageMenu>
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
          className="inline-flex max-w-[14rem] items-center gap-1 rounded-md border border-border bg-surface px-2 py-0.5 font-mono text-[10px] text-muted-foreground transition hover:border-primary/50 hover:text-foreground"
        >
          <FileCode2 className="h-3 w-3 shrink-0 text-success" />
          <span className="truncate">{p.split("/").pop()}</span>
        </button>
      ))}
      {paths.length > shown.length && (
        <button
          onClick={() => setAll(true)}
          className="rounded-md px-1.5 py-0.5 font-mono text-[10px] text-meta hover:text-foreground"
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
    <p className="flex items-center gap-2 py-0.5 text-[11px] text-muted-foreground">
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
          "flex items-start gap-2 py-1 text-[11px]",
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
          "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11.5px] transition",
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
            <p className="border-b border-border px-2.5 py-1 font-mono text-[10px] text-code">
              <span className="text-meta">$ </span>
              {target}
            </p>
          )}
          {step.output ? (
            <pre className="max-h-64 overflow-auto px-2.5 py-1.5 font-mono text-[10px] leading-[1.55] text-muted-foreground">
              {step.output}
            </pre>
          ) : (
            <p className="px-2.5 py-1.5 font-mono text-[10px] text-meta">
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
    <div className="rounded-2xl border border-border bg-surface px-3.5 py-2.5">
      <p className="mb-1.5 flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-meta">
        <ListChecks className="h-3 w-3" /> Plan · {done}/{plan.length}
      </p>
      <ul className="space-y-1">
        {plan.map((p, i) => (
          <li key={i} className="flex items-start gap-2 text-[11.5px] leading-5">
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
    <div className="max-w-[92%] space-y-2.5 rounded-[24px] bg-surface-2 px-4 py-3">
      {plan && <PlanCard plan={plan} />}
      {steps.length > 0 && (
        <div className="-mx-1.5 space-y-0.5">
          {hidden > 0 && (
            <button
              onClick={() => setAll(true)}
              className="px-1.5 text-[11px] text-meta hover:text-foreground"
            >
              Show {hidden} earlier step{hidden === 1 ? "" : "s"}
            </button>
          )}
          {steps.slice(hidden).map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </div>
      )}
      {reply && <Markdown text={reply} className="text-[14px] leading-[1.65]" />}
      <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
        <span className="ds-typing flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
          <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
          <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
        </span>
        <span className="truncate">{status || "Working"}</span>
      </div>
    </div>
  );
}
