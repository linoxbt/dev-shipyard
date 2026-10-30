import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getPreference, preferencesAllowed, setPreference, useConsent } from "./consent";

// A minimal localStorage for the test runtime.
class MemoryStorage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}

const g = globalThis as unknown as { localStorage?: Storage };
const original = g.localStorage;
beforeEach(() => {
  g.localStorage = new MemoryStorage() as unknown as Storage;
  useConsent.setState({ consent: null, loaded: false, managing: false });
});
afterEach(() => {
  g.localStorage = original;
});

describe("consent", () => {
  it("stores no preference until preferences are accepted", () => {
    expect(preferencesAllowed()).toBe(false);
    setPreference("devstation-theme", "light");
    expect(localStorage.getItem("devstation-theme")).toBeNull();
    useConsent.getState().decide(true);
    setPreference("devstation-theme", "light");
    expect(getPreference("devstation-theme")).toBe("light");
  });

  it("deletes saved preferences when they are refused, and keeps essentials", () => {
    useConsent.getState().decide(true);
    setPreference("devstation-theme", "light");
    localStorage.setItem("react-resizable-panels:devstation-app-builder", "x");
    localStorage.setItem("devstation-apps-v1", "projects");
    useConsent.getState().decide(false);
    expect(localStorage.getItem("devstation-theme")).toBeNull();
    expect(localStorage.getItem("react-resizable-panels:devstation-app-builder")).toBeNull();
    expect(localStorage.getItem("devstation-apps-v1")).toBe("projects");
  });

  it("remembers the choice, so the banner does not ask again", () => {
    useConsent.getState().decide(false);
    useConsent.setState({ consent: null });
    useConsent.getState().load();
    expect(useConsent.getState().consent?.preferences).toBe(false);
  });
});
