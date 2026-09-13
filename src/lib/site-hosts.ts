// One deployment, three front doors.
//
//   devstation.online           the landing page
//   docs.devstation.online      the documentation, at clean URLs (/cli, not /docs/cli)
//   console.devstation.online   the console
//
// Netlify serves every hostname from the same site, so the hostname decides
// which part of the app a visitor sees. The router rewrites rather than
// redirects: the address bar keeps saying docs.devstation.online/cli while the
// route underneath is /docs/cli.
//
// With no root domain configured (local development, the app-builder preview,
// a bare netlify.app URL) none of this applies and the app is one host with
// every page at its plain path, so nothing points at a domain that is not
// serving the code being worked on.

export type HostKind = "site" | "docs" | "console";

/** Set only on the production site, as a build-time env var. */
export const ROOT_DOMAIN = String(import.meta.env.VITE_ROOT_DOMAIN ?? "")
  .trim()
  .toLowerCase();

/** Paths that are never pages: API routes, server functions and files. They
 *  resolve the same way on every hostname. */
export function isPassthrough(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname === "/api" ||
    pathname.startsWith("/_serverFn") ||
    /\/[^/]+\.[a-z0-9]{1,8}$/i.test(pathname)
  );
}

const isDocsPath = (p: string) => p === "/docs" || p.startsWith("/docs/");

export function hostKind(host: string, root = ROOT_DOMAIN): HostKind | null {
  if (!root) return null;
  const name = host.split(":")[0].toLowerCase();
  if (name === root || name === `www.${root}`) return "site";
  if (name === `docs.${root}`) return "docs";
  if (name === `console.${root}`) return "console";
  return null;
}

/** Router input: the address a visitor typed, to the route that serves it. */
export function toInternalPath(kind: HostKind | null, pathname: string): string {
  if (kind === "docs") {
    if (isPassthrough(pathname) || isDocsPath(pathname)) return pathname;
    return pathname === "/" ? "/docs" : `/docs${pathname}`;
  }
  if (kind === "console" && pathname === "/") return "/overview";
  return pathname;
}

/** Router output: a route, to the address shown for it on this hostname. */
export function toPublicPath(kind: HostKind | null, pathname: string): string {
  if (kind === "docs" && isDocsPath(pathname)) return pathname.slice("/docs".length) || "/";
  if (kind === "console" && pathname === "/overview") return "/";
  return pathname;
}

function on(sub: "" | "docs" | "console", path: string, root: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (!root) return clean;
  return `https://${sub ? `${sub}.` : ""}${root}${clean === "/" ? "" : clean}`;
}

/** A docs route (/docs/...) as a link that works from any hostname. */
export function docsHref(path = "/docs", root = ROOT_DOMAIN): string {
  const internal = isDocsPath(path) ? path : `/docs${path === "/" ? "" : path}`;
  if (!root) return internal;
  return on("docs", internal.slice("/docs".length) || "/", root);
}

/** A console route as a link that works from any hostname. */
export function consoleHref(path = "/overview", root = ROOT_DOMAIN): string {
  if (!root) return path;
  return on("console", path === "/overview" ? "/" : path, root);
}

/** The landing page. */
export function siteHref(path = "/", root = ROOT_DOMAIN): string {
  return on("", path, root);
}

/**
 * Where a request that landed on the wrong hostname belongs, or null.
 *
 * Old links keep working: devstation.online/overview goes to the console, and
 * a docs page asked for on the console goes to the docs site. Takes the route
 * path (after the input rewrite).
 */
export function crossHostTarget(
  host: string,
  internalPath: string,
  search = "",
  root = ROOT_DOMAIN,
): string | null {
  const kind = hostKind(host, root);
  if (!kind || isPassthrough(internalPath)) return null;
  const query = search && search !== "?" ? (search.startsWith("?") ? search : `?${search}`) : "";
  if (kind === "site") {
    if (isDocsPath(internalPath)) return docsHref(internalPath, root) + query;
    if (internalPath !== "/") return consoleHref(internalPath, root) + query;
    return null;
  }
  if (kind === "console") {
    if (isDocsPath(internalPath)) return docsHref(internalPath, root) + query;
    return null;
  }
  // docs: every public path maps into /docs, so anything else came from an
  // in-app link to a console page.
  if (!isDocsPath(internalPath)) return consoleHref(internalPath, root) + query;
  return null;
}
