import { create } from "zustand";
import { setPreference } from "@/lib/consent";

// Light/dark theme, persisted to localStorage and applied as a class on <html>.
// Dark is the default (tokens live in :root); the `light` class overrides them
// (see styles.css).
//
// The store always STARTS as "dark", on the server and on the client alike,
// so the first client render matches the server's markup. The inline script
// in __root.tsx sets the <html> class from storage before paint, so the page
// never flashes; hydrate() then brings the store in line after mount.

export type Theme = "dark" | "light";

const KEY = "devstation-theme";

function load(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    // No storage (SSR, a private window, blocked site data): the default.
    return "dark";
  }
}

// Toggle the class on <html> so the CSS tokens switch.
function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.classList.toggle("light", theme === "light");
  el.classList.toggle("dark", theme === "dark");
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
  /** Re-apply the persisted theme to <html> (call once on mount). */
  hydrate: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: "dark",
  setTheme: (t) => {
    // A preference: remembered only if preferences were accepted
    // (lib/consent.ts); otherwise it lasts for this visit.
    setPreference(KEY, t);
    applyTheme(t);
    set({ theme: t });
  },
  toggle: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
  hydrate: () => {
    const t = load();
    applyTheme(t);
    set({ theme: t });
  },
}));
