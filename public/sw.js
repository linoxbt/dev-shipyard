// DevStation service worker. Kept deliberately simple: it exists mainly to make
// the app installable ("Add to Home Screen") and to give a fast app-shell.
//
// Strategy:
//  - Navigations (HTML): network-first, fall back to the cached shell when
//    offline. We never want to serve a stale SSR page when online.
//  - Hashed build assets (/assets/*): cache-first. Their names change whenever
//    their content does, so a cached copy can never be stale.
//  - Everything else (icons, manifest, RPC, explorer API, /api/*): straight to
//    the network, never cached, so a changed file or live data is always fresh.
//
// Only successful same-origin responses are cached. A transient 404/500 for a
// chunk used to be stored and then served forever.
//
// The cache name carries the build (the ?v= the page registers this with), so
// activating a new build deletes every older cache instead of growing one
// cache without bound.

const BUILD = new URL(self.location.href).searchParams.get("v") || "dev";
const VERSION = `devstation-${BUILD}`;
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;
const OFFLINE_URL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.add(OFFLINE_URL).catch(() => undefined)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("devstation-") && !k.startsWith(`${VERSION}-`))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isHashedAsset(url) {
  return url.pathname.startsWith("/assets/");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never touch cross-origin (RPC/explorer/AI)
  if (url.pathname.startsWith("/api/")) return; // dynamic server routes: always network

  // App navigations: network-first, fall back to cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((r) => r || Response.error())),
    );
    return;
  }

  // Hashed build assets: cache-first, and only a good response is kept.
  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((resp) => {
            if (resp.ok && resp.type === "basic") {
              const copy = resp.clone();
              caches.open(ASSETS).then((cache) => cache.put(request, copy).catch(() => undefined));
            }
            return resp;
          }),
      ),
    );
  }
});
