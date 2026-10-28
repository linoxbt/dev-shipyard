import { useMemo } from "react";
import { Activity } from "lucide-react";
import { latestPlan, stepsFromEvents, type AgentEvent } from "@/lib/coding-agent/steps";
import { PlanCard, StepRow } from "./Transcript";

/** Every step of the latest turn, each one openable, with what it cost. */
export function ActivityPane({
  events,
  running,
  steps: totalSteps,
  costUsd,
  turns,
}: {
  events: AgentEvent[];
  running: boolean;
  steps: number;
  costUsd: number;
  turns: number;
}) {
  const steps = useMemo(() => stepsFromEvents(events), [events]);
  const plan = useMemo(() => latestPlan(events), [events]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <p className="text-sm font-semibold text-foreground">
            {running ? "Working now" : "Latest turn"}
          </p>
          {turns > 0 && (
            <p className="ml-auto font-mono text-[10.5px] text-meta">
              {turns} turn{turns === 1 ? "" : "s"} · {totalSteps} steps · about $
              {costUsd.toFixed(2)}
            </p>
          )}
        </div>
        {plan && <PlanCard plan={plan} />}
        {steps.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-[13px] text-muted-foreground">
            Every command the agent runs and every file it touches is listed here, with its output.
          </p>
        ) : (
          <div className="rounded-lg border border-border bg-surface p-1.5">
            {steps.map((s) => (
              <StepRow key={s.id} step={s} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
