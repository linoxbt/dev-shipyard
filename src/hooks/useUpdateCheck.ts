import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "sonner";

// A tab left open across a deploy keeps running the code it loaded: moving
// around the app never fetches the page again. So it asks which build is
// deployed when it comes back into view (and every few minutes), and once it
// is behind, the next move to another page loads it fresh, and a notice
// offers to reload now. Nothing reloads under someone while they type.

const EVERY_MS = 5 * 60_000;

export function useUpdateCheck() {
  const router = useRouter();
  useEffect(() => {
    const mine = __APP_VERSION__;
    let stale = false;
    let asked = 0;
    const check = async () => {
      if (stale || document.visibilityState !== "visible" || Date.now() - asked < 30_000) return;
      asked = Date.now();
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (!build || build === mine) return;
        stale = true;
        toast.message("DevStation has been updated.", {
          description: "Reload to use the latest version.",
          duration: Infinity,
          action: { label: "Reload", onClick: () => window.location.reload() },
        });
      } catch {
        // Offline or between deploys: ask again later.
      }
    };
    const unsubscribe = router.subscribe("onBeforeNavigate", ({ toLocation, pathChanged }) => {
      // Another page, on new code: a full load instead of a client move.
      if (stale && pathChanged) window.location.assign(toLocation.href);
    });
    const onVisible = () => void check();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    const timer = setInterval(onVisible, EVERY_MS);
    void check();
    return () => {
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      clearInterval(timer);
    };
  }, [router]);
}
