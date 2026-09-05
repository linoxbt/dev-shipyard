import { useEffect, useState } from "react";
import { LogoMark } from "@/components/shared/Logo";
import { HERO_IMAGES } from "@/lib/landing-images";

const ROTATION_MS = 4400;

/**
 * The large, slowly-turning watermark behind the hero: the DevStation mark, the
 * two chains it is built on, and the work itself: code, silicon, the machines
 * a contract lands on: oversized and cycling one at a time.
 *
 * Each layer crossfades with a distinct scale and rotation coming in and a
 * different one going out, so it reads as one image turning away while the next
 * arrives rather than a flat dissolve. A tint sits between this and the real
 * content, light enough that the imagery still shows through.
 *
 * The QIE and BOT marks are both in the cycle, adjacent and the same size. The
 * page says the two chains are equal; this is the part that shows it without
 * anyone having to read a word.
 *
 * The rotation stops entirely under prefers-reduced-motion: a permanently
 * cycling background is exactly the kind of ambient motion that causes
 * problems, and a still first frame is a perfectly good page.
 */
export function HeroWatermark() {
  const [active, setActive] = useState(0);
  // The DevStation mark, the two chain marks, then the photography.
  const total = HERO_IMAGES.length + 3;

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => setActive((v) => (v + 1) % total), ROTATION_MS);
    return () => window.clearInterval(id);
  }, [total]);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <Layer isActive={active === 0}>
        <LogoMark className="animate-slow-spin h-[62vw] max-h-[560px] w-[62vw] max-w-[560px]" />
      </Layer>

      {/* Same box, same scale, adjacent in the loop: deliberately, so neither
          chain reads as the bigger one. */}
      <Layer isActive={active === 1}>
        <img
          src="/chains/qie.png"
          alt=""
          className="h-[46vw] max-h-[380px] w-auto object-contain"
        />
      </Layer>
      <Layer isActive={active === 2}>
        <img
          src="/chains/bot.png"
          alt=""
          className="h-[46vw] max-h-[380px] w-auto object-contain"
        />
      </Layer>

      {HERO_IMAGES.map((img, i) => (
        <Layer key={img.src} isActive={active === i + 3}>
          <img
            src={img.src}
            alt={img.alt}
            loading={i === 0 ? "eager" : "lazy"}
            className="h-[150vw] max-h-[1100px] w-[150vw] max-w-[1100px] rounded-full object-cover grayscale contrast-125 sm:h-[88vw] sm:w-[88vw]"
          />
        </Layer>
      ))}

      {/* Lighter than the page's solid sections, so the imagery reads through
          without ever competing with the text in front of it. */}
      <div className="absolute inset-0 bg-background/80" />
    </div>
  );
}

function Layer({ isActive, children }: { isActive: boolean; children: React.ReactNode }) {
  return (
    <div
      className="absolute inset-0 flex items-center justify-center transition-all duration-[1500ms] ease-[cubic-bezier(0.16,1,0.3,1)]"
      style={{
        opacity: isActive ? 0.4 : 0,
        transform: isActive ? "scale(1) rotate(0deg)" : "scale(1.32) rotate(16deg)",
      }}
    >
      {children}
    </div>
  );
}
