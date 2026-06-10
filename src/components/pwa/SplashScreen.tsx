import { lazy, Suspense, useEffect, useState } from "react";
import animationData from "@/assets/devstation-loader.json";
import { LogoMark } from "@/components/shared/Logo";
import { cn } from "@/lib/utils";

// Lazy-load the Lottie player so it never runs during SSR and doesn't bloat the
// initial bundle. Until it loads, the static logo mark is shown as a fallback.
const Lottie = lazy(() => import("lottie-react"));

// Module-level flag: the splash plays once per full page load (cold start / PWA
// launch), not on client-side navigations. A fresh server request / refresh
// starts a new load and shows it again.
let splashDone = false;

const FADE_MS = 500;
const MIN_VISIBLE_MS = 1200;

// Full-screen branded loading state shown while the app boots — especially as a
// PWA launch/splash. Fades out once the window has loaded and the loader has
// played for a minimum duration so it never just flickers.
export function SplashScreen() {
  const [visible, setVisible] = useState(!splashDone);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    if (splashDone) return;
    const start = Date.now();
    let hideTimer: ReturnType<typeof setTimeout>;
    let removeTimer: ReturnType<typeof setTimeout>;

    const finish = () => {
      const wait = Math.max(0, MIN_VISIBLE_MS - (Date.now() - start));
      hideTimer = setTimeout(() => {
        setFading(true);
        removeTimer = setTimeout(() => {
          splashDone = true;
          setVisible(false);
        }, FADE_MS);
      }, wait);
    };

    if (document.readyState === "complete") finish();
    else window.addEventListener("load", finish, { once: true });

    return () => {
      clearTimeout(hideTimer);
      clearTimeout(removeTimer);
      window.removeEventListener("load", finish);
    };
  }, []);

  if (!visible) return null;

  return (
    <div
      role="status"
      aria-label="Loading DevStation"
      className={cn(
        "fixed inset-0 z-[100] flex flex-col items-center justify-center bg-background transition-opacity ease-out",
        fading ? "pointer-events-none opacity-0" : "opacity-100",
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
    >
      <div className="h-40 w-40">
        <Suspense
          fallback={
            <div className="flex h-full w-full items-center justify-center">
              <LogoMark className="h-20 w-20 animate-pulse" />
            </div>
          }
        >
          <Lottie animationData={animationData} loop autoplay />
        </Suspense>
      </div>
      <div className="mt-4 font-mono text-base font-bold tracking-tight text-foreground">
        Dev<span className="text-primary">Station</span>
      </div>
      <div className="mt-1 font-mono text-[10px] uppercase tracking-wider text-meta">
        Loading console…
      </div>
    </div>
  );
}
