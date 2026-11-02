import { fileUrl, siteForHost, typeOf, type Site } from "./sites.server";

// Serving a published app: the request's hostname names the site (a
// <slug>.devstation.online subdomain or a verified domain of its own), the
// path names a file of its current deploy, read from public storage. A path
// with no file extension that is not a file is the app's own route, and gets
// index.html (single-page apps route in the browser).

/** Hosts that are DevStation itself and never a site (APP_HOSTS, comma separated). */
function appHosts(): string[] {
  return String(process.env.APP_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/** The response for a request to a published app, or null when the request
 *  is for DevStation itself. */
export async function siteResponse(request: Request): Promise<Response | null> {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
  const site = await siteForHost(host, appHosts());
  if (!site) return null;
  return serveSite(site, request);
}

const NOT_PUBLISHED = (name: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0a0e13;color:#e2e8f0;font:15px/1.5 system-ui,sans-serif}main{text-align:center;padding:24px}p{color:#94a3b8}a{color:#e67e22}</style></head><body><main><h1>${name}</h1><p>This app is not published yet.</p><p><a href="https://devstation.online">Built with DevStation</a></p></main></body></html>`;

export async function serveSite(site: Site, request: Request): Promise<Response> {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const escaped = site.name.replace(/[<>&"]/g, "");
  if (!site.current_deploy) {
    return new Response(NOT_PUBLISHED(escaped || site.slug), {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  let path = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
  if (path.split("/").some((p) => p === ".." || p.startsWith("."))) {
    return new Response("Not found", { status: 404 });
  }
  if (!path || path.endsWith("/")) path += "index.html";

  const fetchFile = (p: string) =>
    fetch(fileUrl(site.id, site.current_deploy!, p), { signal: AbortSignal.timeout(20_000) });
  let file = await fetchFile(path);
  let served = path;
  if (!file.ok) {
    // An app route (/about, /game/3), not a file: the app's index.html.
    const isRoute = !/\.[a-z0-9]{1,8}$/i.test(path);
    const folder = `${path}/index.html`;
    if (isRoute) {
      const nested = await fetchFile(folder);
      if (nested.ok) {
        file = nested;
        served = folder;
      } else {
        file = await fetchFile("index.html");
        served = "index.html";
      }
    }
  }
  if (!file.ok) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  const html = served.endsWith(".html");
  // Hashed build files never change; pages are checked each time.
  const hashed = /[.-][A-Za-z0-9_-]{8,}\.(js|css|mjs|woff2?|png|jpe?g|webp|avif|svg)$/.test(served);
  return new Response(method === "HEAD" ? null : file.body, {
    status: 200,
    headers: {
      "content-type": typeOf(served),
      "cache-control": html
        ? "public, max-age=0, must-revalidate"
        : hashed
          ? "public, max-age=31536000, immutable"
          : "public, max-age=3600",
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
      "x-devstation-site": site.slug,
    },
  });
}
