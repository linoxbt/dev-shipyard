import type { ReactNode } from "react";
import { useInView } from "@/hooks/useInView";
import { cn } from "@/lib/utils";

/**
 * A large photograph that settles from blur into focus as you reach it, with a
 * short line of type beside it.
 *
 * The side alternates so a run of these does not read as a template. The image
 * is rendered visible and then animated rather than parked at opacity 0 waiting
 * on an observer: if the observer never fires the picture is still there,
 * because the animation is the enhancement, not the thing that makes the page
 * exist.
 */
export function ImageReveal({
  eyebrow,
  title,
  body,
  src,
  side = "right",
  footnote,
}: {
  eyebrow: string;
  title: ReactNode;
  body: string;
  src: string;
  side?: "left" | "right";
  /** A concrete detail under the copy: a chain id, a token, a real number. */
  footnote?: ReactNode;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.15);

  return (
    <section className="border-b border-border">
      <div
        ref={ref}
        className={cn(
          "mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:gap-16 lg:py-24",
          side === "right" ? "lg:grid-cols-[0.9fr_1.1fr]" : "lg:grid-cols-[1.1fr_0.9fr]",
        )}
      >
        <div className={cn(inView && "animate-reveal", side === "left" && "lg:order-2")}>
          <p className="font-mono text-[11px] uppercase tracking-wider text-primary">{eyebrow}</p>
          <h2 className="mt-3 font-mono text-2xl font-bold leading-tight text-foreground sm:text-3xl">
            {title}
          </h2>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">{body}</p>
          {footnote && (
            <div className="mt-5 border-t border-border pt-4 font-mono text-[11px] text-meta">
              {footnote}
            </div>
          )}
        </div>

        <div
          className={cn(inView && "animate-reveal", side === "left" && "lg:order-1")}
          style={inView ? { animationDelay: "140ms", animationFillMode: "backwards" } : undefined}
        >
          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border">
            <img
              src={src}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover grayscale contrast-110"
            />
            {/* Tinted so the photograph sits in the page's own register rather
                than reading as a stock image dropped on top of it. */}
            <div className="absolute inset-0 bg-background/25" />
          </div>
        </div>
      </div>
    </section>
  );
}
