import { defineConfig, devices } from "@playwright/test";

// Browser smoke tests against the real app (dev server). They check what unit
// tests cannot: pages render without console errors or sideways scrolling,
// same-origin requests get through the cross-site guard, and the editor
// compiles a contract with checksum-verified solc and OpenZeppelin.
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "e2e",
  timeout: 120_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `bun run dev --port ${PORT} --host 127.0.0.1 --strictPort`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    timeout: 180_000,
    reuseExistingServer: !process.env.CI,
  },
});
