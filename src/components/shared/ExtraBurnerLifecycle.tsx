// Restores the Stacks in-app ("DevStation") wallet from its session after a
// refresh, and auto-locks it after idle — the Stacks analog of the EVM
// BurnerIdleLock and SolanaBurnerLifecycle. Mounted once, app-wide.

import { useEffect, useRef } from "react";
import { useStacksBurner } from "@/lib/stacks/burner/store";
import {
  loadStacksSession,
  touchStacksSession,
  isStacksSessionIdle,
} from "@/lib/stacks/burner/session";

const ACTIVITY_EVENTS = ["mousedown", "keydown", "touchstart", "wheel"] as const;
const IDLE_CHECK_INTERVAL_MS = 30_000;

export function ExtraBurnerLifecycle() {
  const stxRestore = useStacksBurner((s) => s.restoreSession);
  const stxUnlocked = useStacksBurner((s) => s.unlocked);
  const stxLock = useStacksBurner((s) => s.lock);

  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (loadStacksSession()) void stxRestore();
  }, [stxRestore]);

  useEffect(() => {
    if (!stxUnlocked) return;
    const onActivity = () => touchStacksSession();
    for (const evt of ACTIVITY_EVENTS) window.addEventListener(evt, onActivity, { passive: true });
    const interval = setInterval(() => {
      if (stxUnlocked && isStacksSessionIdle()) stxLock();
    }, IDLE_CHECK_INTERVAL_MS);
    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, onActivity);
      clearInterval(interval);
    };
  }, [stxUnlocked, stxLock]);

  return null;
}
