// After a Vercel build: send published apps (<slug>.devstation.online) to
// the server function before this app's own static files, so a site's
// /favicon.ico, /sw.js or /manifest.webmanifest is its own, never
// DevStation's. DevStation's own subdomains are left alone.
//
// The rule is safe if the host is not matched: it then matches nothing and
// the app routes exactly as before.

import { existsSync, readFileSync, writeFileSync } from "node:fs";

const file = ".vercel/output/config.json";
if (!existsSync(file)) {
  console.log("vercel-site-routes: no Vercel output, nothing to do");
  process.exit(0);
}
const domain = (process.env.SITES_DOMAIN || "devstation.online").toLowerCase();
const d = domain.replace(/\./g, "\\.");
const rule = {
  src: "/(.*)",
  has: [{ type: "host", value: `^[a-z0-9-]+\\.${d}$` }],
  missing: [{ type: "host", value: `^(www|roots|docs|console|app|api|admin)\\.${d}$` }],
  dest: "/__server",
};
const config = JSON.parse(readFileSync(file, "utf8")) as { routes?: unknown[] };
const routes = (config.routes ?? []).filter(
  (r) => !(r && typeof r === "object" && "has" in r && JSON.stringify(r).includes(d)),
);
config.routes = [rule, ...routes];
writeFileSync(file, JSON.stringify(config, null, 2));
console.log(`vercel-site-routes: *.${domain} goes to the server first`);
