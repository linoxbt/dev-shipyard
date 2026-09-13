import { describe, expect, it } from "bun:test";
import {
  consoleHref,
  crossHostTarget,
  docsHref,
  hostKind,
  siteHref,
  toInternalPath,
  toPublicPath,
} from "./site-hosts";

const ROOT = "devstation.online";

describe("which part of the app a hostname is", () => {
  it("names the three front doors, and nothing else", () => {
    expect(hostKind("devstation.online", ROOT)).toBe("site");
    expect(hostKind("www.devstation.online", ROOT)).toBe("site");
    expect(hostKind("docs.devstation.online", ROOT)).toBe("docs");
    expect(hostKind("console.devstation.online:443", ROOT)).toBe("console");
    // Published apps and the runner are someone else's hostnames.
    expect(hostKind("my-tip-jar.devstation.online", ROOT)).toBeNull();
    expect(hostKind("devstation-app-builder.netlify.app", ROOT)).toBeNull();
  });

  it("is one host with plain paths when no root domain is set", () => {
    expect(hostKind("docs.devstation.online", "")).toBeNull();
    expect(docsHref("/docs/cli", "")).toBe("/docs/cli");
    expect(consoleHref("/overview", "")).toBe("/overview");
  });
});

describe("docs.devstation.online", () => {
  it("serves docs at clean URLs", () => {
    expect(toInternalPath("docs", "/")).toBe("/docs");
    expect(toInternalPath("docs", "/cli/install")).toBe("/docs/cli/install");
    expect(toPublicPath("docs", "/docs")).toBe("/");
    expect(toPublicPath("docs", "/docs/cli/install")).toBe("/cli/install");
  });

  it("leaves API routes, server functions and files alone", () => {
    expect(toInternalPath("docs", "/api/listings")).toBe("/api/listings");
    expect(toInternalPath("docs", "/_serverFn/abc")).toBe("/_serverFn/abc");
    expect(toInternalPath("docs", "/favicon.svg")).toBe("/favicon.svg");
  });
});

describe("console.devstation.online", () => {
  it("opens on the overview", () => {
    expect(toInternalPath("console", "/")).toBe("/overview");
    expect(toPublicPath("console", "/overview")).toBe("/");
    expect(toInternalPath("console", "/launchkit/marketplace")).toBe("/launchkit/marketplace");
  });
});

describe("links between the three", () => {
  it("builds absolute links when the root domain is set", () => {
    expect(docsHref("/docs/cli", ROOT)).toBe("https://docs.devstation.online/cli");
    expect(docsHref("/docs", ROOT)).toBe("https://docs.devstation.online");
    expect(consoleHref("/activity", ROOT)).toBe("https://console.devstation.online/activity");
    expect(consoleHref("/overview", ROOT)).toBe("https://console.devstation.online");
    expect(siteHref("/", ROOT)).toBe("https://devstation.online");
  });

  it("sends wrong-host requests where they belong, keeping the query", () => {
    expect(crossHostTarget("devstation.online", "/overview", "", ROOT)).toBe(
      "https://console.devstation.online",
    );
    expect(
      crossHostTarget("devstation.online", "/launchkit/marketplace", "?kind=template", ROOT),
    ).toBe("https://console.devstation.online/launchkit/marketplace?kind=template");
    expect(crossHostTarget("devstation.online", "/docs/networks", "", ROOT)).toBe(
      "https://docs.devstation.online/networks",
    );
    expect(crossHostTarget("console.devstation.online", "/docs", "", ROOT)).toBe(
      "https://docs.devstation.online",
    );
    expect(crossHostTarget("docs.devstation.online", "/launchkit/deploy", "", ROOT)).toBe(
      "https://console.devstation.online/launchkit/deploy",
    );
  });

  it("leaves right-host requests, the landing page and API calls alone", () => {
    expect(crossHostTarget("devstation.online", "/", "", ROOT)).toBeNull();
    expect(crossHostTarget("devstation.online", "/api/publish", "", ROOT)).toBeNull();
    expect(crossHostTarget("console.devstation.online", "/overview", "", ROOT)).toBeNull();
    expect(crossHostTarget("docs.devstation.online", "/docs/cli", "", ROOT)).toBeNull();
    expect(crossHostTarget("localhost:5173", "/overview", "", ROOT)).toBeNull();
  });
});
