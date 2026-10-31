import { useEffect, useMemo, useState } from "react";
import {
  Camera,
  Blocks,
  Check,
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
  Wallet,
  Wrench,
} from "lucide-react";
import type { ProjectTurn } from "@/lib/appgen/projects";
import {
  groupLabel,
  latestPlan,
  stepTarget,
  timelineFromEvents,
  timelineFromSaved,
  toolKind,
  type AgentEvent,
  type PlanItem,
  type Step,
  type TimelineItem,
  type ToolKind,
  backgroundTasks,
  elapsed,
} from "@/lib/coding-agent/steps";
import { splitSuggestions } from "@/lib/coding-agent/suggestions";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { ShotThumb } from "./ShotThumb";
import { Dropdown, MenuItem } from "./primitives";

// The conversation, laid out the way Base44 shows its agent at work: what you
// asked, then the agent narrating as it goes ("Reading the pages first so the
// new ones match.") with each batch of work folded into one line you can open
// ("Read 4 files", "Edited App.tsx and 2 more"), its checklist while it works,
// and its reply.

const ICON: Record<ToolKind, React.ComponentType<{ className?: string }>> = {
  read: FileText,
  write: FilePen,
  shell: SquareTerminal,
  search: Search,
  git: GitBranch,
  web: Globe,
  plan: ListChecks,
  wallet: Wallet,
  chain: Blocks,
  browser: Camera,
  other: Wrench,
};

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

/** A long message (a pasted brief, a log) shows its first lines until opened. */
const LONG_LINES = 6;
const LONG_CHARS = 480;

export function UserMessage({
  text,
  plan,
  images,
  onAskAgain,
}: {
  text: string;
  plan?: boolean;
  images?: string[];
  onAskAgain?: () => void;
}) {
  const long = text.split("\n").length > LONG_LINES || text.length > LONG_CHARS;
  const [open, setOpen] = useState(false);
  return (
    <div>
      {plan && <p className="mb-1 pr-2 text-right text-[10.5px] text-primary">Plan first</p>}
      {images && images.length > 0 && (
        <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
          {images.map((src, i) => (
            <img
              key={i}
              src={src}
              alt={`Attached picture ${i + 1}`}
              className="h-20 w-20 rounded-2xl border border-border object-cover"
            />
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[24px] bg-primary px-4 py-2.5 text-[14px] leading-6 text-primary-foreground">
          <p className={cn("whitespace-pre-wrap break-words", long && !open && "line-clamp-6")}>
            {text}
          </p>
          {long && (
            <button
              onClick={() => setOpen((v) => !v)}
              className="mt-1 text-[12.5px] font-medium text-primary-foreground/85 underline-offset-2 hover:underline"
            >
              {open ? "Show less" : "Show more"}
            </button>
          )}
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
  const timeline = useMemo(() => timelineFromSaved(turn.steps ?? []), [turn.steps]);
  // Narration that is also the reply (an answer with no work before it) is
  // shown once, as the reply.
  const items = timeline.filter((t) => !(t.type === "say" && t.text.trim() === turn.text.trim()));
  return (
    <div>
      <div className="max-w-[96%] space-y-2.5">
        {items.length > 0 && <Timeline items={items} />}
        {turn.failed && (
          <p className="mb-1 flex items-center gap-1.5 text-[11.5px] text-warning">
            <TriangleAlert className="h-3.5 w-3.5" /> Did not finish
          </p>
        )}
        <Markdown text={splitSuggestions(turn.text).body} className="text-[14px] leading-[1.65]" />
        {turn.changed && turn.changed.length > 0 && (
          <div>
            <ChangedFiles paths={turn.changed} onOpenFile={onOpenFile} />
          </div>
        )}
        {onBuildPlan && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
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

/** The narration and the folded groups of work, in order. */
export function Timeline({ items, live }: { items: TimelineItem[]; live?: boolean }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) =>
        item.type === "say" ? (
          <Markdown key={item.id} text={item.text} className="text-[14px] leading-[1.65]" />
        ) : item.kind === "note" ? (
          <StepRow key={item.id} step={item.steps[0]} />
        ) : (
          <GroupRow
            key={item.id}
            kind={item.kind}
            steps={item.steps}
            // The batch the agent is in the middle of shows what it is doing.
            current={live && i === items.length - 1}
          />
        ),
      )}
    </div>
  );
}

/** One batch of work, folded into a line: "Read 4 files ›". */
function GroupRow({ kind, steps, current }: { kind: ToolKind; steps: Step[]; current?: boolean }) {
  const [open, setOpen] = useState(false);
  const running = steps.some((s) => s.status === "running");
  const failed = steps.filter((s) => s.status === "failed").length;
  const Icon = ICON[kind];
  const now = running ? steps.find((s) => s.status === "running") : null;
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex max-w-full items-center gap-1.5 text-left text-[12.5px] text-muted-foreground transition hover:text-foreground"
      >
        {running ? (
          <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
        ) : (
          <Icon className={cn("h-3.5 w-3.5 shrink-0", failed ? "text-danger" : "text-meta")} />
        )}
        <span className="truncate">{groupLabel(kind, steps)}</span>
        {failed > 0 && <span className="shrink-0 text-danger">· {failed} failed</span>}
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 text-meta transition", open && "rotate-90")}
        />
      </button>
      {current && now && !open && (
        <p className="ml-5 mt-0.5 truncate text-[11.5px] text-meta">{now.title}</p>
      )}
      {open && (
        <div className="-mx-1.5 mt-1 space-y-0.5 border-l border-border pl-2">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </div>
      )}
      {kind === "wallet" && <FundCard steps={steps} />}
      {steps.some((s) => s.shot) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {steps
            .filter((s) => s.shot)
            .map((s) => (
              <ShotThumb key={s.id} shot={s.shot!} label={s.title} />
            ))}
        </div>
      )}
    </div>
  );
}

/** The deployer wallet the agent made, for the person to send funds to. */
function FundCard({ steps }: { steps: Step[] }) {
  const [copied, setCopied] = useState(false);
  const address = steps
    .map((s) => `${s.title} ${s.output ?? ""}`)
    .join(" ")
    .match(/0x[0-9a-fA-F]{40}/)?.[0];
  if (!address) return null;
  return (
    <div className="mt-2 rounded-2xl border border-primary/30 bg-primary/5 px-3.5 py-3">
      <p className="text-[12.5px] font-medium text-foreground">Fund the deployer wallet</p>
      <p className="mt-0.5 text-[11.5px] leading-5 text-muted-foreground">
        Send test tokens on the network the agent named to this address. It lives in this
        workspace's sandbox, and its key is never shown.
      </p>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(address);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="mt-2 flex w-full items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-left font-mono text-[11px] text-foreground transition hover:border-primary/50"
        title="Copy the address"
      >
        <span className="min-w-0 flex-1 break-all">{address}</span>
        {copied ? (
          <Check className="h-3.5 w-3.5 shrink-0 text-success" />
        ) : (
          <Copy className="h-3.5 w-3.5 shrink-0 text-meta" />
        )}
      </button>
    </div>
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

/** What the live text stream holds beyond the narration already shown: the
 *  reply as it is being written. The stream carries every word the model has
 *  said this turn, narration included. */
function unsaid(reply: string, items: TimelineItem[]): string {
  let rest = reply;
  for (const item of items) {
    if (item.type !== "say") continue;
    const at = rest.indexOf(item.text);
    if (at >= 0) rest = rest.slice(at + item.text.length);
  }
  return rest.trim();
}

/** The turn in progress: checklist, the agent narrating with its work folded
 *  in between, the reply as it streams in, and what it is doing right now. */
export function LiveTurn({
  events,
  reply,
  status,
  startedAt,
}: {
  events: AgentEvent[];
  reply: string;
  status: string;
  /** When the turn started, for the running timer. */
  startedAt?: number;
}) {
  const items = useMemo(() => timelineFromEvents(events), [events]);
  const plan = useMemo(() => latestPlan(events), [events]);
  const background = useMemo(() => backgroundTasks(events), [events]);
  const writing = unsaid(reply, items);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="max-w-[96%] space-y-2.5">
      {plan && <PlanCard plan={plan} />}
      {items.length > 0 && <Timeline items={items} live />}
      {writing && <Markdown text={writing} className="text-[14px] leading-[1.65]" />}
      <div className="flex items-center gap-2.5 text-[12px] text-muted-foreground">
        <span className="ds-typing flex gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
          <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
          <span className="h-1.5 w-1.5 rounded-full bg-foreground" />
        </span>
        <span className="truncate text-primary/90">{status || "Working"}</span>
        {startedAt && (
          <span className="shrink-0 tabular-nums text-meta">· {elapsed(now - startedAt)}</span>
        )}
        {background > 0 && (
          <span className="shrink-0 text-info">
            · {background} running task{background === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
