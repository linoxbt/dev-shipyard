// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import process from "node:process";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Deploy target. The Lovable config defaults to the Cloudflare Workers preset,
// whose output layout Vercel can't serve as an SSR app — the static client gets
// served but the server entry isn't wired as a Vercel function, so SSR never
// runs and deep links / refreshes 404. Pinning the `vercel` preset makes Nitro
// emit `.vercel/output` (static assets + a serverless SSR function that routes
// every path), fixing both the blank render and refresh-on-any-route.
//
// Override with NITRO_PRESET (e.g. "cloudflare-module", "node-server") to target
// another host without editing this file.
const preset = process.env.NITRO_PRESET || "vercel";

export default defineConfig({
  nitro: { preset },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
