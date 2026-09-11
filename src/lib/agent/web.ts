import { lookup } from "node:dns/promises";
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

/** Ranges nobody on the public internet lives in, and the metadata endpoints
 *  that make this matter. */
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return (
      lower === "::1" ||
      lower === "::" ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("fe80") ||
      // IPv4 mapped into IPv6, which is otherwise a way straight past this.
      (lower.startsWith("::ffff:") && isPrivateAddress(lower.slice(7)))
    );
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) || // link-local, and the cloud metadata endpoint
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
    a >= 224
  );
}

export interface UrlCheck {
  ok: boolean;
  reason?: string;
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
  if (isIP(host)) return { ok: true };

  try {
    const addresses = await lookup(host, { all: true });
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
  } catch {
    return { ok: false, reason: `${host} could not be resolved.` };
  }
  return { ok: true };
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

/**
 * Fetch one page as text.
 *
 * Redirects are followed by hand rather than by the fetch implementation, so
 * every hop is checked. A URL that passes the check and then redirects to the
 * metadata endpoint is exactly the shape this is guarding against, and
 * `redirect: "follow"` would sail straight through it.
 */
export async function fetchPage(
  raw: string,
  options: { signal?: AbortSignal; maxBytes?: number } = {},
): Promise<FetchResult> {
  let url = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const allowed = await checkResolves(url);
    if (!allowed.ok) return { ok: false, url, text: allowed.reason ?? "Refused." };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    options.signal?.addEventListener("abort", () => controller.abort(), { once: true });

    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.8",
          "user-agent": "DevStation-Agent/0.1 (+https://devstation.online)",
        },
      });
    } catch (error) {
      clearTimeout(timer);
      const why = error instanceof Error ? error.message : String(error);
      return { ok: false, url, text: `Could not fetch ${url}: ${why}` };
    }
    clearTimeout(timer);

    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get("location");
      if (!next)
        return { ok: false, url, status: response.status, text: "Redirect with no target." };
      url = new URL(next, url).toString();
      continue;
    }

    if (!response.ok) {
      return {
        ok: false,
        url,
        status: response.status,
        text: `${url} returned ${response.status}.`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    const limit = options.maxBytes ?? MAX_BYTES;
    const body = await response.text();
    const truncated = body.length > limit;
    const clipped = truncated ? body.slice(0, limit) : body;

    const text = /html/i.test(contentType) ? htmlToText(clipped) : clipped;
    return { ok: true, url, status: response.status, contentType, text, truncated };
  }

  return { ok: false, url, text: `Gave up after ${MAX_REDIRECTS} redirects.` };
}
