import type { ReactNode } from "react";
import { ArrowUpRight, Box, Code2, FileCode2, Globe, Users } from "lucide-react";
import type { AppProject } from "@/lib/appgen/projects";
import { ago } from "@/lib/coding-agent/steps";
import { IDEAS } from "@/lib/coding-agent/ideas";

// The first screen: one big prompt, in the middle, the way Lovable and Base44
// open. Ideas underneath fill it in, and your projects are below that, so
// picking up where you left off is one click.

export function Landing({
  composer,
  below,
  projects,
  onOpen,
  onIdea,
  footer,
}: {
  composer: ReactNode;
  below?: ReactNode;
  projects: AppProject[];
  onOpen: (id: string) => void;
  onIdea: (prompt: string) => void;
  footer?: ReactNode;
}) {
  const recent = [...projects].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 9);
  return (
    <div className="relative h-full overflow-y-auto">
      {/* A soft glow behind the prompt, in the brand's amber. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[28rem] bg-[radial-gradient(60%_60%_at_50%_0%,color-mix(in_oklch,var(--primary)_18%,transparent),transparent)]"
      />
      <div className="relative mx-auto w-full max-w-3xl px-4 pb-16 pt-[9vh] sm:px-6">
        <h1 className="text-center text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
          What should we build?
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-center text-[14px] leading-6 text-muted-foreground">
          Apps, contracts, APIs, scripts, or a fix to a repository you already have. The agent
          writes the code, runs it in a sandbox and shows you the result.
        </p>

        <div className="mt-8">{composer}</div>
        {below && <div className="mt-2">{below}</div>}

        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {IDEAS.map((idea) => (
            <button
              key={idea.label}
              onClick={() => onIdea(idea.prompt)}
              className="rounded-full border border-border bg-surface/60 px-3 py-1.5 text-[12.5px] text-muted-foreground transition hover:border-primary/40 hover:text-foreground"
            >
              {idea.label}
            </button>
          ))}
        </div>

        {recent.length > 0 && (
          <section className="mt-14">
            <h2 className="mb-3 text-sm font-semibold text-foreground">Your projects</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {recent.map((p) => (
                <ProjectCard key={p.id} project={p} onOpen={() => onOpen(p.id)} />
              ))}
            </div>
          </section>
        )}

        {footer && <div className="mt-10 flex justify-center">{footer}</div>}
      </div>
    </div>
  );
}

function ProjectCard({ project, onOpen }: { project: AppProject; onOpen: () => void }) {
  const files = Object.keys(project.files).length;
  const last = [...project.turns].reverse().find((t) => t.role === "user")?.text;
  const repo = project.source?.repo;
  const Icon = repo ? Code2 : files ? FileCode2 : Box;
  return (
    <button
      onClick={onOpen}
      className="group flex flex-col rounded-xl border border-border bg-surface p-3.5 text-left transition hover:border-primary/40 hover:bg-surface-2/50"
    >
      <div className="flex items-start gap-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-muted-foreground group-hover:text-primary">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium text-foreground">{project.name}</p>
          <p className="truncate font-mono text-[10.5px] text-meta">
            {repo ?? `${files} file${files === 1 ? "" : "s"}`} · {ago(project.updatedAt)}
          </p>
        </div>
        <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-meta opacity-0 transition group-hover:opacity-100" />
      </div>
      {last && (
        <p className="mt-2.5 line-clamp-2 text-[12px] leading-5 text-muted-foreground">{last}</p>
      )}
      {(project.liveUrl || project.shared) && (
        <div className="mt-2.5 flex gap-1.5">
          {project.liveUrl && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[10px] text-success">
              <Globe className="h-3 w-3" /> Live
            </span>
          )}
          {project.shared && (
            <span className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 font-mono text-[10px] text-info">
              <Users className="h-3 w-3" /> Shared
            </span>
          )}
        </div>
      )}
    </button>
  );
}
