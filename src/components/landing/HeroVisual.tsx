import { useEffect, useState } from "react";
import { HERO_IMAGES } from "@/lib/landing-images";

const HOLD_MS = 4000;

/** The chain marks ride in the same rotation as the photographs, adjacent and
 *  the same size, so neither chain reads as the bigger one. */
const MARKS = [
  { src: "/chains/qie.png", label: "QIE" },
  { src: "/chains/bot.png", label: "BOT Chain" },
];

/**
 * The hero's picture: the work this product is about, turning.
 *
 * This began life as a watermark behind the type, where the photographs were
 * dimmed to almost nothing to keep the headline readable. Moved here they get
 * to be seen, and the panel earns its place in the layout instead of being
 * atmosphere.
 *
 * Each layer crossfades with a distinct scale and rotation coming in and a
 * different one going out, so it reads as one image turning away while the next
 * arrives rather than a flat dissolve. The caption names what is on screen,
 * which is also how the two chains get equal billing: every rotation puts the
 * QIE mark and the BOT mark on the same panel at the same size.
 *
 * Under prefers-reduced-motion it holds the first frame and stops. A permanently
 * cycling image is exactly the kind of ambient motion that causes problems, and
 * a still photograph is a perfectly good hero.
 */
export function HeroVisual({ className }: { className?: string }) {
  const slides = [
    ...MARKS.map((m) => ({ kind: "mark" as const, src: m.src, label: m.label })),
    ...HERO_IMAGES.map((i) => ({ kind: "photo" as const, src: i.src, label: i.note })),
  ];
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setActive((v) => (v + 1) % slides.length), HOLD_MS);
    return () => window.clearInterval(id);
  }, [slides.length]);

  return (
    <div className={className}>
      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-lg border border-border bg-surface">
        {slides.map((s, i) => (
          <div
            key={s.src}
            aria-hidden
            className="absolute inset-0 flex items-center justify-center transition-all duration-[1400ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{
              opacity: i === active ? 1 : 0,
              transform: i === active ? "scale(1) rotate(0deg)" : "scale(1.12) rotate(4deg)",
            }}
          >
            {s.kind === "photo" ? (
              <img
                src={s.src}
                alt=""
                loading={i < 3 ? "eager" : "lazy"}
                className="h-full w-full object-cover grayscale contrast-110"
              />
            ) : (
              // The marks sit on the surface rather than bleeding to the edges:
              // a logo cropped by a frame reads as a mistake.
              <img src={s.src} alt="" className="max-h-[45%] w-auto object-contain" />
            )}
          </div>
        ))}

        {/* Tinted so a photograph sits in the page's own register rather than
            reading as a stock image dropped on top of it. */}
        <div className="pointer-events-none absolute inset-0 bg-background/15" />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-background/90 to-transparent px-3 pb-2.5 pt-8">
          <span className="font-mono text-[10px] lowercase tracking-wide text-meta">
            {slides[active].label}
          </span>
          <span className="ml-auto flex gap-1">
            {slides.map((s, i) => (
              <i
                key={s.src}
                className={
                  i === active
                    ? "h-1 w-4 rounded-full bg-primary"
                    : "h-1 w-1 rounded-full bg-border"
                }
              />
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
