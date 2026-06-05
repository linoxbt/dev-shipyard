// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import process from "node:process";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Deploy target selection.
//
// The Lovable config defaults to the Cloudflare Workers preset, whose output
// layout neither Vercel nor Netlify can serve as an SSR app — the static client
// is served but the SSR server isn't wired as a function, so deep links and
// refreshes 404 and pages don't render.
//
// We auto-detect the host from its build-time env var and pick the matching
// Nitro preset, which emits that host's expected output (static assets + an SSR
// function with a catch-all route for every path). Set NITRO_PRESET to override
// (e.g. "node-server", "cloudflare-module", "bun") for self-hosting.
const env = process.env;
const preset =
  env.NITRO_PRESET ||
  (env.NETLIFY ? "netlify" : undefined) ||
  (env.VERCEL ? "vercel" : undefined) ||
  // Default for manual/local production builds. Change if your primary host differs.
  "vercel";

export default defineConfig({
  nitro: { preset },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
