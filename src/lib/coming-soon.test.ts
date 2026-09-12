import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { COMING_SOON, comingSoon, isComingSoon, type ComingSoonPage } from "./coming-soon";

// The property worth protecting here is not what the map contains today: that
// changes as pages ship, but that ONE map decides both the sidebar badge and
// what a route renders. Two lists would drift, and the drift is silent: a badge
// promising "Soon" over a working page, or a nav item landing on a placeholder.

describe("the map", () => {
  it("holds nothing back", () => {
    // Dashboard, Leaderboard and Marketplace all shipped. App Builder left by
    // being merged into the Coding Agent rather than by shipping on its own.
    expect(Object.keys(COMING_SOON)).toEqual([]);
  });

  it("reports every page as available", () => {
    for (const path of [
      "/activity",
      "/leaderboard",
      "/launchkit/marketplace",
      "/launchkit/coding-agent",
      "/explorer",
      "/launchkit/templates",
    ]) {
      expect(isComingSoon(path)).toBe(false);
      expect(comingSoon(path)).toBeNull();
    }
  });

  // The rules an entry has to satisfy, kept alive against a fixture rather than
  // against the map. Looping over an empty map would pass without asserting
  // anything, and the next person to gate a page would inherit checks that had
  // quietly stopped checking.
  describe("the rules an entry must satisfy, when there is one", () => {
    const entry: ComingSoonPage = {
      label: "Dashboard",
      statement:
        "Your reputation, your apps, your contracts and your QIE identity, gathered in one place.",
      icon: () => null,
      instead: { label: "Browse the explorer", to: "/explorer" },
    };
    const gated: Record<string, ComingSoonPage> = { "/activity": entry };

    it("says what the page will do, not just that it is coming", () => {
      expect(entry.label.length).toBeGreaterThan(0);
      // A statement short enough to be a label tells the reader nothing.
      expect(entry.statement.length).toBeGreaterThan(40);
      expect(entry.icon).toBeDefined();
    });

    it("offers somewhere that works, so a placeholder is not a dead end", () => {
      expect(entry.instead.to.startsWith("/")).toBe(true);
      // And never from one placeholder to another.
      expect(gated[entry.instead.to]).toBeUndefined();
    });
  });
});

describe("one source of truth", () => {
  const read = (p: string) => readFileSync(p, "utf8");

  it("has the sidebar decide the badge from the map", () => {
    // Not from a list of its own. If this ever becomes a hardcoded array, the
    // badge and the page can disagree and nothing will say so.
    const sidebar = read("src/components/layout/Sidebar.tsx");
    expect(sidebar).toContain('from "@/lib/coming-soon"');
    expect(sidebar).toContain("isComingSoon(to)");
  });

  it("keeps the gate wired in the routes that have ever used it", () => {
    // The branches stay even with the map empty, so gating one of these again
    // is a single entry in coming-soon.ts and nothing else. Asserted against
    // the file list rather than against the map, which is now empty: iterating
    // the map here would check nothing at all.
    const routes: Record<string, string> = {
      "/activity": "src/routes/activity.tsx",
      "/leaderboard": "src/routes/leaderboard.tsx",
      "/launchkit/marketplace": "src/routes/launchkit.marketplace.tsx",
    };
    for (const [path, file] of Object.entries(routes)) {
      const source = read(file);
      expect(source).toContain(`isComingSoon("${path}")`);
      expect(source).toContain(`<ComingSoon path="${path}" />`);
    }
  });

  it("keeps the real page referenced, so it is one line to bring back", () => {
    // Deleting or commenting out the implementation would make re-enabling a
    // page an archaeology exercise. Both branches stay live.
    expect(read("src/routes/activity.tsx")).toContain("<DashboardPage />");
    expect(read("src/routes/leaderboard.tsx")).toContain("<LeaderboardPage />");
    expect(read("src/routes/launchkit.marketplace.tsx")).toContain("<Marketplace />");
  });

  it("sends the old App Builder route to the page that replaced it", () => {
    // The page was linked to for months. A redirect is the difference between
    // a moved page and a broken bookmark.
    const source = read("src/routes/launchkit.app-builder.tsx");
    expect(source).toContain("redirect");
    expect(source).toContain("/launchkit/coding-agent");
    expect(isComingSoon("/launchkit/app-builder")).toBe(false);
  });
});
