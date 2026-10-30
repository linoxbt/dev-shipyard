import { useSyncExternalStore } from "react";

/** The same breakpoint as Tailwind's `md`, where the app's sidebar changes. */
const MOBILE = "(max-width: 767px)";

/** Whether the screen is phone-sized. False during the server render. */
export function useIsMobile(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(MOBILE);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(MOBILE).matches,
    () => false,
  );
}
