import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Code2, FileCode2 } from "lucide-react";
import type { AppProject } from "@/lib/appgen/projects";
import type { AppTemplate } from "@/lib/coding-agent/app-templates";
import { localPreviewPlan } from "@/lib/appgen/local-preview";
import { buildPreview } from "@/lib/appgen/preview";
import { cn } from "@/lib/utils";
import { useSnapshot, type TemplateSnapshot } from "@/lib/coding-agent/community-templates";

// A project's card picture: its own app, rendered small, the way Base44's
// cards show a screenshot of each app. Drawn only once the card scrolls into
// view, in a sandboxed frame that takes no input. A project with nothing to
// render gets a quiet placeholder instead.

const WIDTH = 1280;
const HEIGHT = 800;

// Whether the card has come into view yet, and how far to shrink a
// full-size frame to fit its width.
function useThumbBox() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);
  const [scale, setScale] = useState(0.25);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Mounted while near the screen and taken down when scrolled away, so a
    // long list never runs dozens of apps at once.
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      rootMargin: "300px",
    });
    io.observe(el);
    const ro = new ResizeObserver(() => setScale(el.clientWidth / WIDTH));
    ro.observe(el);
    return () => {
      io.disconnect();
      ro.disconnect();
    };
  }, []);
  return { ref, visible, scale };
}

function ThumbFrame({ title, srcDoc, scale }: { title: string; srcDoc: string; scale: number }) {
  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      // Scripts only, no same-origin and no input: a picture of the app.
      sandbox="allow-scripts"
      tabIndex={-1}
      aria-hidden
      loading="lazy"
      className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white"
      style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})` }}
    />
  );
}

/** A template's card picture: the finished app itself, running small. */
export function TemplateThumb({
  template,
  className,
}: {
  template: AppTemplate;
  className?: string;
}) {
  const { ref, visible, scale } = useThumbBox();
  return (
    <div
      ref={ref}
      className={cn("relative aspect-[16/10] overflow-hidden bg-surface-2", className)}
    >
      {visible && (
        <ThumbFrame title={`${template.name} preview`} srcDoc={template.html} scale={scale} />
      )}
    </div>
  );
}

/** The bundle a set of files previews as, built only once `visible`. A
 *  project's build wins; otherwise a static app's own files. */
function usePreviewBundle(
  files: Record<string, string> | null | undefined,
  dist: Record<string, string> | null | undefined,
  visible: boolean,
) {
  const source = useMemo(() => {
    if (dist && Object.keys(dist).length) return { files: dist, dir: "" };
    if (!files) return null;
    const plan = localPreviewPlan(files);
    return plan.kind === "static" ? { files, dir: plan.dir } : null;
  }, [dist, files]);

  const bundle = useMemo(() => {
    if (!visible || !source) return null;
    try {
      return buildPreview(source.files, source.dir);
    } catch {
      return null;
    }
  }, [visible, source]);
  useEffect(() => () => bundle?.revoke(), [bundle]);
  return bundle;
}

function Placeholder({ icon: Icon, label }: { icon: typeof Box; label: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[radial-gradient(80%_80%_at_30%_20%,color-mix(in_oklch,var(--primary)_16%,transparent),transparent)]">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface text-muted-foreground shadow-sm">
        <Icon className="h-5 w-5" />
      </span>
      <span className="font-mono text-[10px] text-meta">{label}</span>
    </div>
  );
}

export function ProjectThumb({ project, className }: { project: AppProject; className?: string }) {
  const { ref, visible, scale } = useThumbBox();
  const bundle = usePreviewBundle(project.files, project.dist, visible);
  const files = Object.keys(project.files).length;
  const Icon = project.source?.repo ? Code2 : files ? FileCode2 : Box;

  return (
    <div
      ref={ref}
      className={cn("relative aspect-[16/10] overflow-hidden bg-surface-2", className)}
    >
      {bundle ? (
        <ThumbFrame title={`${project.name} preview`} srcDoc={bundle.srcdoc} scale={scale} />
      ) : (
        <Placeholder
          icon={Icon}
          label={project.source?.repo ?? `${files} file${files === 1 ? "" : "s"}`}
        />
      )}
    </div>
  );
}

/**
 * The picture of an app whose files are fetched when its card comes into
 * view: a community template, or a project an admin is looking at. `load`
 * fetches them (cached by `cacheKey`).
 */
export function RemoteThumb({
  name,
  load,
  cacheKey,
  className,
}: {
  name: string;
  load: () => Promise<TemplateSnapshot | null>;
  cacheKey: string;
  className?: string;
}) {
  const { ref, visible, scale } = useThumbBox();
  const snap = useSnapshot(visible ? load : null, cacheKey);
  const bundle = usePreviewBundle(snap?.files, snap?.dist, visible && !!snap);

  return (
    <div
      ref={ref}
      className={cn("relative aspect-[16/10] overflow-hidden bg-surface-2", className)}
    >
      {bundle ? (
        <ThumbFrame title={`${name} preview`} srcDoc={bundle.srcdoc} scale={scale} />
      ) : snap === undefined ? (
        <div className="ds-skeleton absolute inset-0" />
      ) : (
        <Placeholder
          icon={snap && Object.keys(snap.files).length ? FileCode2 : Box}
          label={snap ? `${Object.keys(snap.files).length} files, no preview` : "Not available"}
        />
      )}
    </div>
  );
}

/** An app running full size, for looking at it before choosing it. */
export function SnapshotFrame({
  name,
  snap,
  className,
}: {
  name: string;
  snap: TemplateSnapshot;
  className?: string;
}) {
  const bundle = usePreviewBundle(snap.files, snap.dist, true);
  return bundle ? (
    <iframe
      title={`${name} preview`}
      srcDoc={bundle.srcdoc}
      sandbox="allow-scripts allow-forms allow-modals"
      className={cn("h-full w-full border-0 bg-white", className)}
    />
  ) : (
    <div className={cn("relative h-full w-full bg-surface-2", className)}>
      <Placeholder
        icon={FileCode2}
        label={`${Object.keys(snap.files).length} files; this app needs a build to preview`}
      />
    </div>
  );
}
