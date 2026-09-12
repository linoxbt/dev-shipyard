import { describe, expect, it } from "bun:test";
import { parseSearchResults, resolveResultUrl, webSearch } from "./web";

// Web search without a key. The fixture is DuckDuckGo's real result markup,
// trimmed, so a change on their side fails here instead of search quietly
// returning nothing.

const FIXTURE = `
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.sh%2F&amp;rut=947b">Bun &mdash; A fast all-in-one JavaScript runtime</a>
    </h2>
    <a class="result__url" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.sh%2F&amp;rut=947b">bun.sh</a>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.sh%2F&amp;rut=947b">Bun is a <b>fast</b> JavaScript runtime &amp; toolkit.</a>
  </div>
</div>
<div class="result results_links results_links_deep web-result ">
  <div class="links_main links_deep result__body">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fbun.com%2Fdocs%2Fruntime&amp;rut=b1f6">Runtime docs</a>
    </h2>
    <a class="result__snippet" href="#">How the runtime works.</a>
  </div>
</div>
<div class="result result--ad">
  <a rel="nofollow" class="result__a" href="https://duckduckgo.com/y.js?ad_provider=x">Sponsored</a>
</div>
`;

describe("reading search results", () => {
  it("pulls titles, real links and snippets out of the page", () => {
    const results = parseSearchResults(FIXTURE);
    expect(results).toHaveLength(2);
    expect(results[0].url).toBe("https://bun.sh/");
    expect(results[0].title).toContain("Bun");
    expect(results[0].snippet).toBe("Bun is a fast JavaScript runtime & toolkit.");
    expect(results[1].url).toBe("https://bun.com/docs/runtime");
    expect(results[1].snippet).toBe("How the runtime works.");
  });

  it("drops ads and unwraps DuckDuckGo's redirect", () => {
    expect(resolveResultUrl("https://duckduckgo.com/y.js?ad_provider=x")).toBeNull();
    expect(
      resolveResultUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fa&amp;rut=1"),
    ).toBe("https://example.com/a");
  });

  it("respects the limit", () => {
    expect(parseSearchResults(FIXTURE, 1)).toHaveLength(1);
  });
});

describe("searching", () => {
  it("reports a rate-limit page as unavailable rather than as no results", async () => {
    const result = await webSearch("bun", {
      fetchImpl: (async () =>
        new Response("slow down", { status: 202 })) as unknown as typeof fetch,
    });
    expect(result.ok).toBe(false);
  });

  it("returns parsed results on success", async () => {
    const result = await webSearch("bun", {
      fetchImpl: (async () => new Response(FIXTURE, { status: 200 })) as unknown as typeof fetch,
    });
    expect(result.ok && result.results[0].url).toBe("https://bun.sh/");
  });

  it("refuses an empty query", async () => {
    expect((await webSearch("   ")).ok).toBe(false);
  });
});
