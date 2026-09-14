import { Rocket } from "lucide-react";
import { CodeBlock } from "@/components/shared/CodeBlock";
import type { ListingKind } from "@/lib/marketplace/listing";
import type { GettingStartedStep } from "@/lib/data/marketplace/official";
import { skillInstallSteps } from "@/lib/marketplace/skill-install";

// How to start using a listing, shown on its page. A skill always gets the
// same install steps first (see skill-install.ts), then its own.

export function GettingStarted({
  kind,
  steps,
  skillName,
}: {
  kind: ListingKind;
  steps: GettingStartedStep[];
  skillName?: string | null;
}) {
  const all = kind === "skill" && skillName ? [...skillInstallSteps(skillName), ...steps] : steps;
  if (all.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <Rocket className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">
          Getting started
        </span>
      </div>
      <ol className="space-y-4 p-4">
        {all.map((step, index) => (
          <li key={`${index}-${step.title}`} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[11px] font-bold text-primary">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-xs font-bold text-foreground">{step.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              {step.code && (
                <div className="mt-2">
                  <CodeBlock code={step.code} language="bash" maxHeight="220px" />
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
