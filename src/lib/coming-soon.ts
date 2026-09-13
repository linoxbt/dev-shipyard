import type { ComponentType } from "react";

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

/**
 * Nothing is held back.
 *
 * Dashboard, Leaderboard and Marketplace all shipped: each reads real data and
 * says so honestly when there is none -- the leaderboard reports the explorer
 * as unreachable rather than inventing rankings, the dashboard derives
 * reputation only from deployments that cost gas, and a wallet's .qie names are
 * shown only when the QIE ID contract says it owns them. That was the bar for
 * taking the gate off, not the pages merely rendering.
 *
 * The map stays, empty, and so do the branches in the routes. Gating a page
 * again is one entry here, and nothing else: the sidebar badge and the route
 * placeholder both read this, which is the whole reason the file exists.
 */
export const COMING_SOON: Record<string, ComingSoonPage> = {};

export function isComingSoon(path: string): boolean {
  return path in COMING_SOON;
}

export function comingSoon(path: string): ComingSoonPage | null {
  return COMING_SOON[path] ?? null;
}
