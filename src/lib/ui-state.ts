import { create } from "zustand";

// Sidebar state. `mobileNavOpen` drives the mobile drawer; `sidebarCollapsed`
// hides the desktop rail (persisted so the choice survives refresh). One toggle
// button handles both: it opens the drawer on mobile and collapses the rail on
// desktop.
const COLLAPSE_KEY = "devstation-sidebar-collapsed";

function loadCollapsed(): boolean {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return false;
  return localStorage.getItem(COLLAPSE_KEY) === "1";
}

interface UiState {
  mobileNavOpen: boolean;
  sidebarCollapsed: boolean;
  openMobileNav: () => void;
  closeMobileNav: () => void;
  toggleMobileNav: () => void;
  toggleSidebar: () => void;
}

export const useUi = create<UiState>((set) => ({
  mobileNavOpen: false,
  sidebarCollapsed: loadCollapsed(),
  openMobileNav: () => set({ mobileNavOpen: true }),
  closeMobileNav: () => set({ mobileNavOpen: false }),
  toggleMobileNav: () => set((s) => ({ mobileNavOpen: !s.mobileNavOpen })),
  toggleSidebar: () =>
    set((s) => {
      const next = !s.sidebarCollapsed;
      if (typeof window !== "undefined" && typeof localStorage !== "undefined") {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      }
      return { sidebarCollapsed: next };
    }),
}));
