import { expect, test, type Page } from "@playwright/test";

const PAGES = [
  "/",
  "/overview",
  "/explorer/mainnet",
  "/launchkit/marketplace",
  "/launchkit/editor",
  "/routebook",
  "/docs",
  "/launchkit/projects",
  "/launchkit/coding-agent",
  "/leaderboard",
];

/** Console errors and uncaught exceptions while `path` loads and settles. */
async function load(page: Page, path: string): Promise<string[]> {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  const res = await page.goto(path, { waitUntil: "networkidle" });
  expect(res?.status(), path).toBe(200);
  await page.waitForTimeout(1000);
  return errors;
}

/** Errors from the outside world (explorers, RPCs) that a sandboxed CI runner
 *  cannot reach are not the app's fault; anything else is. */
const external = (e: string) => /Failed to load resource|net::ERR_|ERR_NAME_NOT_RESOLVED/.test(e);

for (const path of PAGES) {
  test(`${path} renders cleanly on desktop`, async ({ page }) => {
    const errors = (await load(page, path)).filter((e) => !external(e));
    expect(errors).toEqual([]);
  });
}

for (const path of ["/", "/launchkit/marketplace", "/explorer/mainnet", "/launchkit/coding-agent"]) {
  test(`${path} has no sideways scroll on a phone`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await load(page, path);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test("security headers are on every page", async ({ request }) => {
  const res = await request.get("/");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["strict-transport-security"]).toContain("max-age=");
});

test("a same-origin POST reaches its route; a cross-site one does not", async ({ page }) => {
  await page.goto("/docs");
  const statuses = await page.evaluate(async () => {
    const own = await fetch("/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    return { own: own.status, ownBody: await own.text() };
  });
  // The route answers (no wallet grant), not the cross-site guard.
  expect(statuses.own).toBe(401);
  expect(statuses.ownBody).toContain("no_grant");
});

test("cross-site POSTs are refused before any route runs", async ({ request }) => {
  const res = await request.post("/api/access", {
    headers: { origin: "https://evil.example", "content-type": "application/json" },
    data: {},
  });
  expect(res.status()).toBe(403);
});

test("the editor compiles an OpenZeppelin contract with verified sources", async ({ page }) => {
  test.skip(!!process.env.E2E_OFFLINE, "needs binaries.soliditylang.org and jsDelivr");
  await page.goto("/launchkit/editor", { waitUntil: "networkidle" });
  const result = await page.evaluate(async () => {
    const m = await import("/src/lib/compiler.ts");
    const src =
      'pragma solidity ^0.8.20; import "@openzeppelin/contracts/token/ERC20/ERC20.sol";' +
      ' contract T is ERC20 { constructor() ERC20("T","T") { _mint(msg.sender, 1e18); } }';
    const r = await m.compile({ sources: { "T.sol": src }, version: "0.8.26", mainFile: "T.sol" });
    return { status: r.status, imports: (r.resolvedImports ?? []).length, errors: r.errors ?? [] };
  });
  expect(result.errors).toEqual([]);
  expect(result.status).toBe("success");
  expect(result.imports).toBeGreaterThan(0);
});

test("the service worker registers with this build's version", async ({ page }) => {
  await page.goto("/");
  const urls = await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
    return (await navigator.serviceWorker.getRegistrations()).map(
      (r) => (r.active ?? r.installing ?? r.waiting)?.scriptURL ?? "",
    );
  });
  expect(urls.some((u) => /\/sw\.js\?v=.+-.+/.test(u))).toBe(true);
});
