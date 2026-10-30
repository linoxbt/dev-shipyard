import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Code2, FileCode2 } from "lucide-react";
import type { AppProject } from "@/lib/appgen/projects";
import { localPreviewPlan } from "@/lib/appgen/local-preview";
import { buildPreview } from "@/lib/appgen/preview";
import { cn } from "@/lib/utils";

// A project's card picture: its own app, rendered small, the way Base44's
// cards show a screenshot of each app. Drawn only once the card scrolls into
// view, in a sandboxed frame that takes no input. A project with nothing to
// render gets a quiet placeholder instead.

const WIDTH = 1280;
const HEIGHT = 800;

export function ProjectThumb({ project, className }: { project: AppProject; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [scale, setScale] = useState(0.25);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), {
      rootMargin: "200px",
    });
    io.observe(el);
    const ro = new ResizeObserver(() => setScale(el.clientWidth / WIDTH));
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, []);

  const source = useMemo(() => {
    if (project.dist && Object.keys(project.dist).length) return { files: project.dist, dir: "" };
    const plan = localPreviewPlan(project.files);
    return plan.kind === "static" ? { files: project.files, dir: plan.dir } : null;
  }, [project.dist, project.files]);

  const bundle = useMemo(() => {
    if (!visible || !source) return null;
    try {
      return buildPreview(source.files, source.dir);
    } catch {
      return null;
    }
  }, [visible, source]);
  useEffect(() => () => bundle?.revoke(), [bundle]);

  const files = Object.keys(project.files).length;
  const Icon = project.source?.repo ? Code2 : files ? FileCode2 : Box;

  return (
    <div
      ref={ref}
      className={cn("relative aspect-[16/10] overflow-hidden bg-surface-2", className)}
    >
      {bundle ? (
        <iframe
          title={`${project.name} preview`}
          srcDoc={bundle.srcdoc}
          // Scripts only, no same-origin and no input: a picture of the app.
          sandbox="allow-scripts"
          tabIndex={-1}
          aria-hidden
          loading="lazy"
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white"
          style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})` }}
        />
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(80%_80%_at_30%_20%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent)]">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface text-muted-foreground shadow-sm">
            <Icon className="h-5 w-5" />
          </span>
          <span className="font-mono text-[11px] text-meta">
            {project.source?.repo ?? `${files} file${files === 1 ? "" : "s"}`}
          </span>
        </div>
      )}
    </div>
  );
}
