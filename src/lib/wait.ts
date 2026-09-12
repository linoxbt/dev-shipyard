/**
 * Wait, unless the work was cancelled.
 *
 * Written as a free function rather than inline in the hook so it can be
 * tested: the polling loops that use it are inside a React hook this project
 * has no renderer for, and the rule they got wrong is worth a test of its own.
 *
 * What they got wrong: a bare `setTimeout` with nothing checking the signal.
 * Pressing stop, or leaving the page, left up to two minutes of polling still
 * running -- calling server functions and writing into a timeline nobody was
 * looking at any more.
 *
 * Checked on BOTH sides of the wait. Before, so an already-cancelled caller
 * does not wait at all; after, because cancellation almost always arrives
 * during the wait rather than before it.
 */
export async function waitUnlessAborted(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false;
  await new Promise<void>((resolve) => {
    if (!signal) {
      setTimeout(resolve, ms);
      return;
    }
    // Resolve early on abort rather than sleeping out the full interval: a
    // cancelled run should stop now, not in four seconds.
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
  return !signal?.aborted;
}
