import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ActivityStore } from "./activity";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("marketplace activity", () => {
  it("counts a person once a day for each listing and action", () => {
    let now = 1_000;
    const store = new ActivityStore(null, () => now);
    expect(store.record("b-qie-portfolio", "clone", "203.0.113.7")).toBe(true);
    expect(store.record("b-qie-portfolio", "clone", "203.0.113.7")).toBe(false);
    expect(store.record("b-qie-portfolio", "download", "203.0.113.7")).toBe(true);
    expect(
      store.record("b-qie-portfolio", "clone", "0xAbC0000000000000000000000000000000000001"),
    ).toBe(true);
    expect(
      store.record("b-qie-portfolio", "clone", "0xabc0000000000000000000000000000000000001"),
    ).toBe(false);
    now += 24 * 60 * 60 * 1000;
    expect(store.record("b-qie-portfolio", "clone", "203.0.113.7")).toBe(true);
    expect(store.all()).toEqual({ "b-qie-portfolio": { clone: 3, download: 1 } });
  });

  it("refuses listings and actions that do not exist", () => {
    const store = new ActivityStore(null);
    expect(store.record("x-1", "clone", "a")).toBeNull();
    expect(store.record("m-abc", "clone", "a")).toBeNull();
    expect(store.record("b-Not_Valid", "clone", "a")).toBeNull();
    expect(store.record("m-5", "buy", "a")).toBeNull();
    expect(store.record("m-5", "download", "a")).toBe(true);
    expect(store.record("t-2", "clone", "a")).toBe(true);
  });

  it("keeps its counts across a restart", () => {
    const dir = mkdtempSync(join(tmpdir(), "activity-"));
    dirs.push(dir);
    const file = join(dir, "state", "marketplace-activity.json");
    new ActivityStore(file).record("m-7", "download", "someone");
    expect(new ActivityStore(file).all()).toEqual({ "m-7": { clone: 0, download: 1 } });
  });
});
