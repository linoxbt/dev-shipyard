import { create } from "zustand";
import { setPreference } from "@/lib/consent";

// Sidebar state. `mobileNavOpen` drives the mobile drawer; `sidebarCollapsed`
// hides the desktop rail (persisted so the choice survives refresh). One toggle
// button handles both: it opens the drawer on mobile and collapses the rail on
// desktop.
const COLLAPSE_KEY = "devstation-sidebar-collapsed";

function loadCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {
    return false;
  }
}

interface UiState {
  mobileNavOpen: boolean;
  sidebarCollapsed: boolean;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  toggleMobileNav: () => void;
  toggleSidebar: () => void;
  /** Read the persisted rail state. Called once after mount (AppShell), so the
   *  first client render matches the server's, which cannot see storage. */
  hydrate: () => void;
}

export const useUi = create<UiState>((set) => ({
  mobileNavOpen: false,
  sidebarCollapsed: false,
  hydrate: () => set({ sidebarCollapsed: loadCollapsed() }),
  openMobileNav: () => set({ mobileNavOpen: true }),
  closeMobileNav: () => set({ mobileNavOpen: false }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      try {
        setPreference(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* not persisted; the toggle still applies for this page */
      }
      return { sidebarCollapsed: next };
    }),
}));
