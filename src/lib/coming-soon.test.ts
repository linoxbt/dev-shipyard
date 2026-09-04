import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { COMING_SOON, comingSoon, isComingSoon } from "./coming-soon";

// The property worth protecting here is not what the map contains today — that
// changes as pages ship — but that ONE map decides both the sidebar badge and
// what a route renders. Two lists would drift, and the drift is silent: a badge
// promising "Soon" over a working page, or a nav item landing on a placeholder.

describe("the map", () => {
  it("covers exactly the four pages held back", () => {
    expect(Object.keys(COMING_SOON).sort()).toEqual([
      "/activity",
      "/launchkit/app-builder",
      "/launchkit/marketplace",
      "/leaderboard",
    ]);
  });

  it("says what each page will do, not just that it is coming", () => {
    for (const [path, page] of Object.entries(COMING_SOON)) {
      expect(page.label.length).toBeGreaterThan(0);
      // A statement short enough to be a label tells the reader nothing.
      expect(page.statement.length).toBeGreaterThan(40);
      expect(page.icon).toBeDefined();
      // And somewhere that works, so the placeholder is not a dead end.
      expect(page.instead.to.startsWith("/")).toBe(true);
      expect(isComingSoon(page.instead.to)).toBe(false);
      expect(path.startsWith("/")).toBe(true);
    }
  });

  it("does not send anyone from one placeholder to another", () => {
    for (const page of Object.values(COMING_SOON)) {
      expect(COMING_SOON[page.instead.to]).toBeUndefined();
    }
  });

  it("reports a page that is not held back as available", () => {
    expect(isComingSoon("/explorer")).toBe(false);
    expect(isComingSoon("/launchkit/templates")).toBe(false);
    expect(comingSoon("/explorer")).toBeNull();
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

  it("has every held-back route gate on the same map", () => {
    const routes: Record<string, string> = {
      "/activity": "src/routes/activity.tsx",
      "/leaderboard": "src/routes/leaderboard.tsx",
      "/launchkit/marketplace": "src/routes/launchkit.marketplace.tsx",
      "/launchkit/app-builder": "src/routes/launchkit.app-builder.tsx",
    };
    for (const path of Object.keys(COMING_SOON)) {
      const file = routes[path];
      expect(file).toBeDefined();
      const source = read(file);
      expect(source).toContain(`isComingSoon("${path}")`);
      expect(source).toContain(`<ComingSoon path="${path}" />`);
    }
  });

  it("keeps the real page referenced, so it is one line to bring back", () => {
    // Deleting or commenting out the implementation would make re-enabling a
    // page an archaeology exercise. Both branches stay live.
    const builder = read("src/routes/launchkit.app-builder.tsx");
    expect(builder).toContain("<AppBuilderPage />");
    expect(read("src/routes/activity.tsx")).toContain("<DashboardPage />");
    expect(read("src/routes/leaderboard.tsx")).toContain("<LeaderboardPage />");
    expect(read("src/routes/launchkit.marketplace.tsx")).toContain("<Marketplace />");
  });
});
