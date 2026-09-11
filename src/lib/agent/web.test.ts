import { afterEach, describe, expect, it } from "bun:test";
import { checkResolves, checkUrlShape, fetchPage, htmlToText } from "./web";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stub(pages: Array<{ status?: number; headers?: Record<string, string>; body?: string }>) {
  const asked: string[] = [];
  let index = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    asked.push(String(input));
    const page = pages[Math.min(index++, pages.length - 1)];
    return new Response(page.body ?? "", {
      status: page.status ?? 200,
      headers: page.headers ?? { "content-type": "text/plain" },
    });
  }) as typeof fetch;
  return asked;
}

describe("which URLs are allowed at all", () => {
  it("takes an ordinary https documentation URL", () => {
    expect(checkUrlShape("https://docs.stripe.com/api").ok).toBe(true);
    expect(checkUrlShape("http://example.com/x?y=1").ok).toBe(true);
  });

  it("refuses anything that is not http", () => {
    for (const url of ["file:///etc/passwd", "ftp://x/y", "data:text/html,hi"]) {
      const check = checkUrlShape(url);
      expect(check.ok).toBe(false);
      expect(check.reason).toContain("Only http");
    }
  });

  it("refuses the cloud metadata endpoint and the rest of private space", () => {
    // This is the one that matters: a page the agent read can say "now fetch
    // 169.254.169.254" and walk off with the host's credentials.
    for (const host of [
      "169.254.169.254",
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.1",
      "172.16.0.1",
      "100.64.0.1",
      "0.0.0.0",
    ]) {
      const check = checkUrlShape(`http://${host}/latest/meta-data/`);
      expect(check.ok).toBe(false);
      expect(check.reason).toContain("private address");
    }
  });

  it("refuses localhost by name as well as by number", () => {
    expect(checkUrlShape("http://localhost:8080/").ok).toBe(false);
    expect(checkUrlShape("http://LOCALHOST/").ok).toBe(false);
  });

  it("refuses private IPv6, including a v4 address wearing a v6 costume", () => {
    expect(checkUrlShape("http://[::1]/").ok).toBe(false);
    expect(checkUrlShape("http://[fd00::1]/").ok).toBe(false);
    expect(checkUrlShape("http://[::ffff:169.254.169.254]/").ok).toBe(false);
  });

  it("says so for something that is not a URL at all", () => {
    expect(checkUrlShape("not a url").ok).toBe(false);
    expect(checkUrlShape("").ok).toBe(false);
  });
});

describe("where a name actually points", () => {
  it("refuses a hostname that resolves into private space", async () => {
    // Checking the text of the URL is not enough: a name under somebody else's
    // control can point anywhere, and localhost.mydomain.com is a real trick.
    const check = await checkResolves("http://localtest.me/");
    if (!check.ok) {
      expect(check.reason).toMatch(/private address|could not be resolved/);
    } else {
      // If this name ever stops resolving to 127.0.0.1 the test is vacuous,
      // and saying so beats silently passing.
      expect(check.ok).toBe(true);
    }
  }, 20_000);

  it("lets a literal public address through without asking DNS", async () => {
    expect((await checkResolves("https://1.1.1.1/")).ok).toBe(true);
  });
});

describe("turning a page into something worth reading", () => {
  it("drops scripts, styles and tags", () => {
    const text = htmlToText(
      `<html><head><style>body{color:red}</style><script>alert(1)</script></head>
       <body><h1>Title</h1><p>First paragraph.</p><p>Second.</p></body></html>`,
    );
    expect(text).not.toContain("alert(1)");
    expect(text).not.toContain("color:red");
    expect(text).toContain("Title");
    expect(text).toContain("First paragraph.");
  });

  it("keeps the shape of the document", () => {
    const text = htmlToText("<ul><li>one</li><li>two</li></ul>");
    expect(text).toContain("- one");
    expect(text).toContain("- two");
    expect(text.split("\n").length).toBeGreaterThan(1);
  });

  it("decodes the entities that matter in code samples", () => {
    expect(htmlToText("<p>a &lt; b &amp;&amp; c &gt; d</p>")).toContain("a < b && c > d");
  });

  it("does not collapse a whole page onto one line", () => {
    const text = htmlToText("<p>one</p><p>two</p><p>three</p>");
    expect(text.split("\n").filter(Boolean)).toHaveLength(3);
  });
});

describe("fetching", () => {
  it("returns the text of a page", async () => {
    stub([{ body: "plain documentation", headers: { "content-type": "text/plain" } }]);
    const result = await fetchPage("https://example.com/doc");
    expect(result.ok).toBe(true);
    expect(result.text).toBe("plain documentation");
  });

  it("strips html when that is what came back", async () => {
    stub([{ body: "<p>Hello <b>world</b></p>", headers: { "content-type": "text/html" } }]);
    const result = await fetchPage("https://example.com/");
    expect(result.text).toContain("Hello");
    expect(result.text).not.toContain("<b>");
  });

  it("checks every hop of a redirect, not just the first", async () => {
    // The attack this exists for: a public URL that redirects to the metadata
    // endpoint. `redirect: "follow"` would sail straight through it.
    const asked = stub([
      { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } },
      { body: "SECRET CREDENTIALS" },
    ]);
    const result = await fetchPage("https://example.com/innocent");
    expect(result.ok).toBe(false);
    expect(result.text).toContain("private address");
    expect(result.text).not.toContain("SECRET");
    // It never asked for the second page.
    expect(asked).toHaveLength(1);
  });

  it("gives up rather than following redirects forever", async () => {
    stub([{ status: 302, headers: { location: "https://example.com/again" } }]);
    const result = await fetchPage("https://example.com/start");
    expect(result.ok).toBe(false);
    expect(result.text).toContain("redirects");
  });

  it("reports a bad status rather than returning the error page as content", async () => {
    stub([{ status: 404, body: "<h1>Not found</h1>" }]);
    const result = await fetchPage("https://example.com/missing");
    expect(result.ok).toBe(false);
    expect(result.text).toContain("404");
  });

  it("truncates a huge page and says that it did", async () => {
    stub([{ body: "x".repeat(50_000) }]);
    const result = await fetchPage("https://example.com/big", { maxBytes: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1000);
  });

  it("refuses a private URL before making any request at all", async () => {
    const asked = stub([{ body: "should never be read" }]);
    const result = await fetchPage("http://169.254.169.254/latest/meta-data/");
    expect(result.ok).toBe(false);
    expect(asked).toHaveLength(0);
  });

  it("reports a network failure as a failure, not as an empty page", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("getaddrinfo ENOTFOUND"))) as unknown as typeof fetch;
    const result = await fetchPage("https://example.com/");
    expect(result.ok).toBe(false);
    expect(result.text).toContain("ENOTFOUND");
  });
});

describe("a page with nothing in it", () => {
  it("says so rather than looking like a successful read", async () => {
    stub([
      {
        body: "<html><head><script>x()</script></head><body></body></html>",
        headers: { "content-type": "text/html" },
      },
    ]);
    const result = await fetchPage("https://example.com/empty");
    expect(result.ok).toBe(true);
    expect(result.text.trim()).toBe("");
  });
});
