import { describe, expect, it } from "bun:test";
import { isolationFrom } from "./runner-health.server";

// The check that would have caught the live gap.
//
// These are the two /health replies, copied from what the two runners actually
// returned: production, which predated the sandbox, and a current one.

const PRODUCTION_AS_FOUND = {
  ok: true,
  docker: true,
  image: "devstation-runner:3",
  runtime: "runsc",
  runtimeAvailable: true,
  active: 0,
  queued: 0,
};

const CURRENT = {
  ...PRODUCTION_AS_FOUND,
  agentSandbox: {
    enabled: true,
    ready: true,
    image: "devstation-sandbox:1",
    runtime: "runsc",
  },
};

describe("deciding whether a runner may be given agent work", () => {
  it("refuses a runner with no sandbox field at all", () => {
    // This exact body was live. The app was sending it agent jobs, which ran
    // model-chosen commands on the runner host with nothing around them.
    const verdict = isolationFrom(PRODUCTION_AS_FOUND);
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toContain("needs redeploying");
  });

  it("accepts a runner that reports a ready sandbox", () => {
    expect(isolationFrom(CURRENT).ok).toBe(true);
  });

  it("refuses a runner whose sandbox is switched off", () => {
    const verdict = isolationFrom({
      agentSandbox: { enabled: false, ready: false, why: "DEVSTATION_SANDBOX=off" },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toContain("switched off");
  });

  it("refuses a runner that cannot start its sandbox, and passes on the reason", () => {
    const verdict = isolationFrom({
      agentSandbox: {
        enabled: true,
        ready: false,
        why: "the image devstation-sandbox:1 is not built",
      },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.why).toContain("devstation-sandbox:1 is not built");
  });

  it("refuses an empty or unreadable reply", () => {
    expect(isolationFrom(null).ok).toBe(false);
    expect(isolationFrom({}).ok).toBe(false);
  });
});
