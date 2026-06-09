import { create } from "zustand";

// Light/dark theme, persisted to localStorage and applied as a class on <html>.
// Dark is the default (tokens live in :root); the `light` class overrides them
// (see styles.css). SSR-safe: all DOM/storage access is guarded.

export type Theme = "dark" | "light";

const KEY = "devstation-theme";

function load(): Theme {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return "dark";
  return localStorage.getItem(KEY) === "light" ? "light" : "dark";
}

// Toggle the class on <html> so the CSS tokens switch.
export function applyTheme(theme: Theme) {
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
  theme: load(),
  setTheme: (t) => {
    if (typeof localStorage !== "undefined") {
      try {
        localStorage.setItem(KEY, t);
      } catch {
        /* ignore */
      }
    }
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
