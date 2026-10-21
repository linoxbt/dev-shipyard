import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";

// Reading the web, carefully.
//
// An agent that cannot read documentation cannot use an SDK it has not
// memorised, and the version it remembers is the version that was current when
// it was trained. Fetching a page is the difference between writing an API call
// from memory and writing one from the reference.
//
// Two things make this more than a fetch call.
//
// The first is that a URL the model chose is a URL an attacker may have chosen:
// a page the agent read earlier can contain "now fetch http://169.254.169.254/"
// and walk off with cloud credentials. So private address space is refused, and
// refused after DNS resolution, because a hostname that resolves to 127.0.0.1
// looks nothing like localhost.
//
// The second is that everything it returns is untrusted text written by someone
// else. It is labelled as such on the way back, the same as any other tool
// result that carries content from outside.

export interface FetchResult {
  ok: boolean;
  url: string;
  status?: number;
  contentType?: string;
  text: string;
  truncated?: boolean;
}

const MAX_BYTES = 400_000;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20_000;

/** Expand an IPv6 address to eight 16-bit groups, or null. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0];
  // A trailing dotted quad (::ffff:1.2.3.4, ::1.2.3.4) becomes two groups.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (dotted) {
    const parts = dotted[1].split(".").map(Number);
    if (parts.some((n) => n > 255)) return null;
    text =
      text.slice(0, -dotted[1].length) +
      `${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill("0"), ...tail].map(
    (g) => parseInt(g, 16),
  );
  return groups.length === 8 && groups.every((g) => g >= 0 && g <= 0xffff) ? groups : null;
}

function v4FromGroups(hi: number, lo: number): string {
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

/** Ranges nobody on the public internet lives in, and the metadata endpoints
 *  that make this matter.
 *
 *  IPv6 is checked by value, not by spelling: NAT64 (64:ff9b::/96), 6to4
 *  (2002::/16), IPv4-compatible (::a.b.c.d) and IPv4-mapped addresses all
 *  carry an IPv4 address inside them, and each was a way past a prefix test. */
export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const g = ipv6Groups(ip);
    if (!g) return true;
    const zeroHead = (n: number) => g.slice(0, n).every((x) => x === 0);
    if (g.every((x) => x === 0)) return true; // ::
    if (zeroHead(7) && g[7] === 1) return true; // ::1
    if (zeroHead(5) && g[5] === 0xffff) return isPrivateAddress(v4FromGroups(g[6], g[7])); // mapped
    if (zeroHead(6)) return isPrivateAddress(v4FromGroups(g[6], g[7])); // compatible
    if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateAddress(v4FromGroups(g[6], g[7])); // NAT64
    if (g[0] === 0x2002) return isPrivateAddress(v4FromGroups(g[1], g[2])); // 6to4
    if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local
    if ((g[0] & 0xffc0) === 0xfec0) return true; // site-local (deprecated)
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard 100::/64
    return false;
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local, and the cloud metadata endpoint
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // IETF and documentation
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224 // multicast and reserved
  );
}

export interface UrlCheck {
  ok: boolean;
  reason?: string;
  /** The address that was checked, which is the one the request must use. */
  address?: string;
  family?: 4 | 6;
}

/** Everything that can be decided without a network round trip. */
export function checkUrlShape(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: `"${raw}" is not a URL.` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: `Only http and https are fetched, not ${url.protocol}` };
  }
  // A literal address skips DNS, so it is checked here instead.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) && isPrivateAddress(host)) {
    return { ok: false, reason: `${host} is a private address and was not fetched.` };
  }
  if (/^localhost$/i.test(url.hostname)) {
    return { ok: false, reason: "localhost was not fetched." };
  }
  return { ok: true };
}

/** The same check, after asking DNS where the name actually points. */
export async function checkResolves(raw: string): Promise<UrlCheck> {
  const shape = checkUrlShape(raw);
  if (!shape.ok) return shape;

  const url = new URL(raw);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return { ok: true, address: host, family: isIP(host) as 4 | 6 };

  try {
    const addresses = await lookup(host, { all: true });
    if (addresses.length === 0) return { ok: false, reason: `${host} could not be resolved.` };
    for (const { address } of addresses) {
      if (isPrivateAddress(address)) {
        return {
          ok: false,
          // Said with the address, because "it resolves somewhere private" is
          // the whole point and hiding it makes this look like a random
          // failure.
          reason: `${host} resolves to ${address}, which is a private address, so it was not fetched.`,
        };
      }
    }
    return { ok: true, address: addresses[0].address, family: addresses[0].family as 4 | 6 };
  } catch {
    return { ok: false, reason: `${host} could not be resolved.` };
  }
}

/** Strip a page down to something worth spending context on. */
export function htmlToText(html: string): string {
  return (
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      // Keep the shape of the document: a heading or a list item on its own line
      // reads as structure, and everything on one line does not.
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|pre|blockquote)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/\n\s*\n\s*\n+/g, "\n\n")
      .split("\n")
      .map((line) => line.trim())
      .join("\n")
      .trim()
  );
}

interface Hop {
  status: number;
  headers: { get(name: string): string | null };
  /** Read at most `limit` bytes of the body. */
  read(limit: number): Promise<{ body: Buffer; truncated: boolean }>;
  /** Stop reading and release the connection. */
  close(): void;
}

/** How one hop is made. Swappable so tests can stand in for the network. */
export type Transport = (
  url: string,
  address: string,
  family: 4 | 6,
  signal: AbortSignal,
) => Promise<Hop>;

const REQUEST_HEADERS = {
  accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.8",
  "user-agent": "DevStation-Agent/0.1 (+https://devstation.online)",
};

/**
 * One request, connected to exactly the address that was checked.
 *
 * Checking a name and then letting fetch resolve it again is two lookups, and
 * a rebinding DNS server answers them differently: public for the check,
 * 169.254.169.254 for the request. node:http(s) takes a `lookup`, so the
 * socket goes to the checked address while the Host header and TLS name stay
 * the URL's. Works the same under Bun and Node.
 */
export const pinnedTransport: Transport = (url, address, family, signal) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const mod = target.protocol === "https:" ? https : http;
    const req = mod.request(
      target,
      {
        method: "GET",
        headers: REQUEST_HEADERS,
        signal,
        lookup: ((_host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) =>
          opts?.all ? cb(null, [{ address, family }]) : cb(null, address, family)) as never,
      },
      (res) => {
        resolve({
          status: res.statusCode ?? 0,
          headers: {
            get: (name) => {
              const v = res.headers[name.toLowerCase()];
              return Array.isArray(v) ? v.join(", ") : (v ?? null);
            },
          },
          read: (limit) =>
            new Promise((done, fail) => {
              const chunks: Buffer[] = [];
              let size = 0;
              let truncated = false;
              res.on("data", (chunk: Buffer) => {
                if (truncated) return;
                chunks.push(chunk);
                size += chunk.length;
                if (size > limit) {
                  truncated = true;
                  res.destroy();
                  done({ body: Buffer.concat(chunks).subarray(0, limit), truncated });
                }
              });
              res.on("end", () => !truncated && done({ body: Buffer.concat(chunks), truncated }));
              res.on("error", (e) => (truncated ? undefined : fail(e)));
              res.on("close", () => !truncated && done({ body: Buffer.concat(chunks), truncated }));
            }),
          close: () => res.destroy(),
        });
      },
    );
    req.on("error", reject);
    req.end();
  });

/**
 * One request through fetch, for when an HTTP proxy is configured.
 *
 * Behind a proxy the proxy resolves the name, so there is no local connection
 * to pin; the check above still refuses private literals and names that
 * resolve privately here. Also what the tests use, by replacing fetch.
 */
export const fetchTransport: Transport = async (url, _address, _family, signal) => {
  const response = await fetch(url, { redirect: "manual", signal, headers: REQUEST_HEADERS });
  return {
    status: response.status,
    headers: response.headers,
    read: async (limit) => {
      if (!response.body) return { body: Buffer.alloc(0), truncated: false };
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.length;
        if (size > limit) {
          await reader.cancel().catch(() => undefined);
          return { body: Buffer.concat(chunks).subarray(0, limit), truncated: true };
        }
      }
      return { body: Buffer.concat(chunks), truncated: false };
    },
    close: () => {
      response.body?.cancel().catch(() => undefined);
    },
  };
};

function proxyConfigured(): boolean {
  const e = process.env;
  return Boolean(e.HTTPS_PROXY || e.https_proxy || e.HTTP_PROXY || e.http_proxy || e.ALL_PROXY);
}

let transportOverride: Transport | null = null;
/** Tests only: route every hop through `t`, or back to the default. */
export function setTransport(t: Transport | null): void {
  transportOverride = t;
}

function transport(): Transport {
  return transportOverride ?? (proxyConfigured() ? fetchTransport : pinnedTransport);
}

/**
 * Fetch one page as text.
 *
 * Redirects are followed by hand rather than by the fetch implementation, so
 * every hop is checked. A URL that passes the check and then redirects to the
 * metadata endpoint is exactly the shape this is guarding against, and
 * `redirect: "follow"` would sail straight through it.
 *
 * One timer covers the whole read, body included: it used to be cleared once
 * headers arrived, so a server that trickled its body could hold the agent
 * indefinitely. The body is read with a byte cap rather than in full and then
 * cut, so a huge response costs at most the cap.
 */
export async function fetchPage(
  raw: string,
  options: { signal?: AbortSignal; maxBytes?: number } = {},
): Promise<FetchResult> {
  let url = raw;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onAbort, { once: true });
  const finish = (result: FetchResult) => {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    return result;
  };

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const allowed = await checkResolves(url);
      if (!allowed.ok || !allowed.address) {
        return finish({ ok: false, url, text: allowed.reason ?? "Refused." });
      }

      let response: Hop;
      try {
        response = await transport()(url, allowed.address, allowed.family ?? 4, controller.signal);
      } catch (error) {
        const why = controller.signal.aborted
          ? "timed out"
          : error instanceof Error
            ? error.message
            : String(error);
        return finish({ ok: false, url, text: `Could not fetch ${url}: ${why}` });
      }

      if (response.status >= 300 && response.status < 400) {
        const next = response.headers.get("location");
        response.close();
        if (!next) {
          return finish({
            ok: false,
            url,
            status: response.status,
            text: "Redirect with no target.",
          });
        }
        url = new URL(next, url).toString();
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        response.close();
        return finish({
          ok: false,
          url,
          status: response.status,
          text: `${url} returned ${response.status}.`,
        });
      }

      const contentType = response.headers.get("content-type") ?? "";
      const limit = options.maxBytes ?? MAX_BYTES;
      let read: { body: Buffer; truncated: boolean };
      try {
        read = await response.read(limit);
      } catch (error) {
        const why = controller.signal.aborted
          ? "timed out"
          : error instanceof Error
            ? error.message
            : String(error);
        return finish({ ok: false, url, text: `Could not read ${url}: ${why}` });
      }
      const clipped = read.body.toString("utf8");
      const text = /html/i.test(contentType) ? htmlToText(clipped) : clipped;
      return finish({
        ok: true,
        url,
        status: response.status,
        contentType,
        text,
        truncated: read.truncated,
      });
    }
    return finish({ ok: false, url, text: `Gave up after ${MAX_REDIRECTS} redirects.` });
  } catch (error) {
    return finish({ ok: false, url, text: `Could not fetch ${url}: ${String(error)}` });
  }
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
const SEARCH_TIMEOUT_MS = 15_000;

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function cleanText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo wraps each link in a redirect: //duckduckgo.com/l/?uddg=<url>.
 *  Ads go through y.js and are dropped. */
export function resolveResultUrl(href: string): string | null {
  const raw = decodeEntities(href);
  if (/duckduckgo\.com\/y\.js/.test(raw)) return null;
  const absolute = raw.startsWith("//") ? `https:${raw}` : raw;
  try {
    const url = new URL(absolute);
    const target = url.searchParams.get("uddg");
    if (target) return target;
    return /^https?:$/.test(url.protocol) && !/duckduckgo\.com$/.test(url.hostname)
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

/** Results out of DuckDuckGo's HTML page. Pure, so the markup assumptions are
 *  held by a test rather than discovered when search quietly returns nothing. */
export function parseSearchResults(html: string, limit = 8): SearchResult[] {
  const results: SearchResult[] = [];
  const anchor = /<a\b([^>]*\bclass="result__a"[^>]*)>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) && results.length < limit) {
    const href = /\bhref="([^"]+)"/.exec(match[1])?.[1];
    const url = href ? resolveResultUrl(href) : null;
    if (!url || results.some((r) => r.url === url)) continue;
    // The snippet is the next result__snippet after this title, before the next title.
    const rest = html.slice(anchor.lastIndex);
    const nextTitle = rest.search(/class="result__a"/);
    const scope = nextTitle === -1 ? rest : rest.slice(0, nextTitle);
    const snippet =
      /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/i.exec(scope)?.[1] ?? "";
    results.push({ title: cleanText(match[2]), url, snippet: cleanText(snippet) });
  }
  return results;
}

/**
 * Search the web.
 *
 * DuckDuckGo's HTML endpoint, because it needs no key: a search tool that only
 * works after somebody signs up for an API is a search tool most people never
 * have. It is a fixed public host, so the private-address checks fetchPage
 * applies to arbitrary URLs are not needed here.
 */
export async function webSearch(
  query: string,
  options: { signal?: AbortSignal; limit?: number; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; results: SearchResult[] } | { ok: false; error: string }> {
  const q = query.trim();
  if (!q) return { ok: false, error: "A web search needs a query." };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEARCH_TIMEOUT_MS);
  options.signal?.addEventListener("abort", () => controller.abort(), { once: true });
  try {
    const res = await (options.fetchImpl ?? fetch)(
      `${SEARCH_ENDPOINT}?q=${encodeURIComponent(q)}`,
      {
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) DevStation-Agent",
          accept: "text/html",
        },
      },
    );
    // 202 is DuckDuckGo's "slow down" page, which has no results in it.
    if (res.status !== 200) {
      return {
        ok: false,
        error: `Web search is unavailable right now (status ${res.status}). Try again shortly, or fetch_url a known page.`,
      };
    }
    return { ok: true, results: parseSearchResults(await res.text(), options.limit ?? 8) };
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Web search failed: ${why}` };
  } finally {
    clearTimeout(timer);
  }
}
