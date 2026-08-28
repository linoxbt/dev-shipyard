import { describe, expect, it, beforeEach } from "bun:test";

// Simulate a browser whose SAVED preference is BOT Chain while the app's
// default is QIE. This is the exact condition that used to produce a
// server/client hydration mismatch on every chain-dependent string.
const BOT_MAINNET = 677;
const store: Record<string, string> = {};
(globalThis as unknown as { window: unknown }).window = globalThis;
(globalThis as unknown as { localStorage: unknown }).localStorage = {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => {
    store[k] = v;
  },
  removeItem: (k: string) => {
    delete store[k];
  },
};
store["devstation-network-pref"] = String(BOT_MAINNET);

const { useNetworkPref } = await import("./active-chain");
const { DEFAULT_CHAIN } = await import("./chains");

describe("useNetworkPref SSR determinism", () => {
  beforeEach(() => {
    useNetworkPref.setState({ preferredChainId: DEFAULT_CHAIN.id, hydrated: false });
  });

  it("starts on DEFAULT_CHAIN even when a different chain is stored", () => {
    // The store must NOT read localStorage at init: the server cannot see it,
    // so doing so makes the client's first render disagree with the SSR HTML.
    expect(useNetworkPref.getState().preferredChainId).toBe(DEFAULT_CHAIN.id);
    expect(useNetworkPref.getState().hydrated).toBe(false);
  });

  it("adopts the stored preference only after hydrate()", () => {
    useNetworkPref.getState().hydrate();
    expect(useNetworkPref.getState().preferredChainId).toBe(BOT_MAINNET);
    expect(useNetworkPref.getState().hydrated).toBe(true);
  });

  it("hydrate() is idempotent", () => {
    useNetworkPref.getState().hydrate();
    useNetworkPref.setState({ preferredChainId: 1990 });
    useNetworkPref.getState().hydrate(); // must not clobber a later selection
    expect(useNetworkPref.getState().preferredChainId).toBe(1990);
  });

  it("setPreferred persists and marks hydrated", () => {
    useNetworkPref.getState().setPreferred(1983);
    expect(store["devstation-network-pref"]).toBe("1983");
    expect(useNetworkPref.getState().hydrated).toBe(true);
  });

  it("ignores an unsupported stored chain id", () => {
    store["devstation-network-pref"] = "999999";
    useNetworkPref.setState({ preferredChainId: DEFAULT_CHAIN.id, hydrated: false });
    useNetworkPref.getState().hydrate();
    expect(useNetworkPref.getState().preferredChainId).toBe(DEFAULT_CHAIN.id);
    store["devstation-network-pref"] = String(BOT_MAINNET);
  });
});
