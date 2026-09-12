import { describe, expect, it } from "bun:test";
import { waitUnlessAborted } from "./wait";

// The rule the verification polling loops got wrong.

describe("waiting, unless cancelled", () => {
  it("waits and reports it may continue", async () => {
    const started = Date.now();
    expect(await waitUnlessAborted(30)).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(25);
  });

  it("does not wait at all when already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const started = Date.now();
    expect(await waitUnlessAborted(5000, controller.signal)).toBe(false);
    // The point: a cancelled run stops now, not in five seconds.
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("stops early when cancelled during the wait", async () => {
    // The case that actually happens. Cancellation almost never arrives before
    // the wait starts; it arrives while it is running, which is why checking
    // only on entry would have left the bug in place.
    const controller = new AbortController();
    const started = Date.now();
    setTimeout(() => controller.abort(), 20);
    expect(await waitUnlessAborted(5000, controller.signal)).toBe(false);
    expect(Date.now() - started).toBeLessThan(300);
  });

  it("does not leak a listener per call", async () => {
    // A poll loop calls this fifteen times. Leaving a listener behind each
    // time is how a long-running page accumulates them.
    const controller = new AbortController();
    for (let i = 0; i < 5; i++) await waitUnlessAborted(1, controller.signal);
    // Node/Bun expose the count; if it is not available the assertion is
    // skipped rather than faked.
    const count = (
      controller.signal as unknown as { listenerCount?: (n: string) => number }
    ).listenerCount?.("abort");
    if (typeof count === "number") expect(count).toBe(0);
  });
});
