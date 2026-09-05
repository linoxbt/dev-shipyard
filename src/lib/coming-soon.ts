import type { ComponentType } from "react";
import { LayoutDashboard, Store, Trophy, Wand2 } from "lucide-react";

// Pages that are built but not yet shown.
//
// One map, read by two places: the sidebar decides which items get a "Soon"
// badge from it, and each gated route decides from it whether to render itself
// or the placeholder. That pairing is the entire reason this file exists. Two
// separate lists drift, and the drift is silent: a badge saying "Soon" over a
// page that works, or a nav item that navigates to a placeholder, so the badge
// and the gate are made the same fact rather than two facts kept in step.
//
// Nothing here deletes a page. Removing an entry restores the real component
// and drops the badge together, because both read this.

export interface ComingSoonPage {
  label: string;
  /** What the page will do, in the words the page already uses about itself. */
  statement: string;
  icon: ComponentType<{ className?: string }>;
  /** Somewhere that works today. A placeholder with no way onward is a dead
   *  end, which is worse than the half-finished page it replaced. */
  instead: { label: string; to: string };
}

export const COMING_SOON: Record<string, ComingSoonPage> = {
  "/activity": {
    label: "Dashboard",
    statement:
      "Your reputation, your apps, your contracts and your QIE identity, gathered in one place for the connected wallet.",
    icon: LayoutDashboard,
    instead: { label: "Browse the explorer", to: "/explorer" },
  },
  "/leaderboard": {
    label: "Leaderboard",
    statement:
      "Builders ranked by what they have actually deployed through DevStation, counted on-chain rather than self-reported.",
    icon: Trophy,
    instead: { label: "See network analytics", to: "/analytics" },
  },
  "/launchkit/marketplace": {
    label: "Marketplace",
    statement:
      "Community contract templates published on-chain, with their source free to read before you use one.",
    icon: Store,
    instead: { label: "Browse templates", to: "/launchkit/templates" },
  },
  "/launchkit/app-builder": {
    label: "App Builder",
    statement:
      "Describe an app in plain language, watch it get built and previewed as you talk, then publish it to a live URL.",
    icon: Wand2,
    instead: { label: "Write a contract", to: "/launchkit/editor" },
  },
};

export function isComingSoon(path: string): boolean {
  return path in COMING_SOON;
}

export function comingSoon(path: string): ComingSoonPage | null {
  return COMING_SOON[path] ?? null;
}
