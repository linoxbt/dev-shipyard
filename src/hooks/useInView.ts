import { useEffect, useRef, useState } from "react";

/**
 * True once the element has been scrolled into view, and true from then on.
 *
 * It does not flip back on the way out: content that fades away again as you
 * scroll past is a distraction, and re-running the entrance every time an
 * element crosses the edge reads as a glitch rather than a flourish.
 *
 * Returns true immediately when there is no IntersectionObserver, so a browser
 * without it shows the content rather than an empty page.
 */
export function useInView<T extends HTMLElement>(threshold = 0.12) {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true);
            observer.disconnect();
          }
        }
      },
      { threshold },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [threshold]);

  return { ref, inView };
}
