// DevStation service worker. Kept deliberately simple: it exists mainly to make
// the app installable ("Add to Home Screen") and to give a fast app-shell.
//
// Strategy:
//  - Navigations (HTML): network-first, fall back to the cached shell when
//    offline. We never want to serve a stale SSR page when online.
//  - Static build assets (/_build/, icons, manifest): cache-first (immutable).
//  - Everything else (RPC, explorer API, /api/*): straight to the network,
//    never cached, so live chain data is always fresh.

const VERSION = "devstation-v1";
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
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_build/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/favicon.svg" ||
    /\.(?:png|svg|ico|woff2?|css|js)$/.test(url.pathname)
  );
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

  // Static build assets: cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((resp) => {
            const copy = resp.clone();
            caches.open(ASSETS).then((cache) => cache.put(request, copy).catch(() => undefined));
            return resp;
          }),
      ),
    );
  }
});
