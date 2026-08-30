import { describe, expect, it, beforeEach, afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A real directory, so persistence is exercised rather than mocked — the whole
// point of this module is surviving a restart.
const dir = mkdtempSync(join(tmpdir(), "runner-history-"));
process.env.RUNNER_STATE_DIR = dir;

const { MAX_AGE_MS, MAX_JOBS, historyStats, recentJobs, recordJob, resetHistory } =
  await import("./history");
import type { JobRecord } from "./history";

afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => resetHistory());

function job(overrides: Partial<Parameters<typeof recordJob>[0]> = {}) {
  return {
    id: "job-" + Math.random().toString(36).slice(2, 8),
    startedAt: Date.now(),
    durationMs: 1000,
    ok: true,
    fileCount: 3,
    distFileCount: 2,
    phases: [
      { phase: "install", ok: true, durationMs: 900, timedOut: false, log: "added 2 packages" },
    ],
    ...overrides,
  };
}

describe("history", () => {
  it("returns the most recent first, which is how anyone reads them", () => {
    recordJob(job({ id: "old" }));
    recordJob(job({ id: "new" }));
    expect(recentJobs().map((j) => j.id)).toEqual(["new", "old"]);
  });

  it("keeps a bounded number of jobs", () => {
    for (let i = 0; i < MAX_JOBS + 25; i++) recordJob(job());
    expect(recentJobs(1000).length).toBe(MAX_JOBS);
  });

  it("keeps the tail of a failing log, where the error is", () => {
    const log = "noise\n".repeat(3000) + "ERROR: the actual problem";
    recordJob(
      job({
        ok: false,
        phases: [{ phase: "build", ok: false, durationMs: 10, timedOut: false, log }],
      }),
    );
    const kept = recentJobs()[0].phases[0].log;
    expect(kept).toContain("ERROR: the actual problem");
    expect(kept.length).toBeLessThan(3000);
  });

  it("keeps far less of a passing log", () => {
    // A successful build's output is noise; the failure's is evidence.
    const log = "ok\n".repeat(3000);
    recordJob(
      job({ phases: [{ phase: "build", ok: true, durationMs: 10, timedOut: false, log }] }),
    );
    expect(recentJobs()[0].phases[0].log.length).toBeLessThan(600);
  });

  it("summarises pass, fail and a median that one outlier cannot skew", () => {
    recordJob(job({ durationMs: 1000 }));
    recordJob(job({ durationMs: 2000 }));
    recordJob(job({ durationMs: 3000 }));
    recordJob(job({ ok: false, durationMs: 900_000 }));
    const s = historyStats();
    expect(s.total).toBe(4);
    expect(s.ok).toBe(3);
    expect(s.failed).toBe(1);
    // A mean here would be ~226s and describe nothing that ever happened.
    expect(s.medianMs).toBeLessThan(10_000);
  });

  it("survives a restart", async () => {
    recordJob(job({ id: "persisted" }));
    // A fresh module instance reads the same file the previous one wrote.
    const fresh = (await import("./history?reload=" + Math.random())) as typeof import("./history");
    expect(fresh.recentJobs().some((j: JobRecord) => j.id === "persisted")).toBe(true);
  });
});

describe("retention", () => {
  it("drops jobs past the age bound, not just past the count", () => {
    // Job logs carry fragments of user code. Capping only by count kept months
    // of it on disk through a quiet week.
    recordJob(job({ id: "ancient", startedAt: Date.now() - MAX_AGE_MS - 1000 }));
    recordJob(job({ id: "recent", startedAt: Date.now() }));
    expect(recentJobs().map((j) => j.id)).toEqual(["recent"]);
  });
});
