// @lovable.dev/vite-tanstack-config already includes the following: do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, nitro (build-only using cloudflare as a default target),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import process from "node:process";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// Deploy target selection.
//
// The Lovable config defaults to the Cloudflare Workers preset, whose output
// layout neither Vercel nor Netlify can serve as an SSR app: the static client
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
  // Default for manual/local production builds: Netlify, because it is the
  // live host (netlify.toml carries the security headers, DEPLOY.md documents
  // it). The default used to be Vercel, so a local `bun run build` produced
  // output for a host this app is not deployed on.
  "netlify";

// Identifies this build, so the service worker can drop caches from older ones
// (public/sw.js is copied verbatim, so it receives this as `?v=` on its
// registration URL rather than through `define`). Package version plus the
// commit, or the build time when there is no git checkout.
function appVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
    version?: string;
  };
  let rev = env.COMMIT_REF?.slice(0, 12) || env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) || "";
  if (!rev) {
    try {
      rev = execSync("git rev-parse --short=12 HEAD", { stdio: ["ignore", "pipe", "ignore"] })
        .toString()
        .trim();
    } catch {
      rev = String(Date.now());
    }
  }
  return `${pkg.version ?? "0.0.0"}-${rev}`;
}

export default defineConfig({
  // Function time limits are host settings on both Netlify and Vercel (the
  // Lovable config passes only `preset` through to Nitro): see DEPLOYMENT.md.
  nitro: { preset },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    define: {
      __APP_VERSION__: JSON.stringify(appVersion()),
    },
    // Accepting any Host header switches off Vite's DNS-rebinding guard on a
    // dev server whose server functions hold RUNNER_TOKEN and AI keys. So it
    // is opt-in: set DEV_ALLOW_ANY_HOST=1 to reach the dev server through a
    // Cloudflare quick tunnel (random *.trycloudflare.com host).
    ...(env.DEV_ALLOW_ANY_HOST === "1" ? { server: { allowedHosts: true as const } } : {}),
  },
});
