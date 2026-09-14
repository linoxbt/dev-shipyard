import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalRequest } from "../orchestrator";
import { CODING_AGENT_SYSTEM } from "../system-prompt";
import { VERSION } from "./args";
import type { Terminal } from "./commands";
import { LiveView } from "./live";
import { renderApproval } from "./render";
import { cachedUpdate, notifyIfOutdated, updateQuestion } from "./upgrade";

// What someone meets in the first minutes of a session: the question about a
// newer version, the permission prompts, the notes under a turn, and whether
// the agent knows which chain QIE is.

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function homeWith(latest: string): string {
  const home = mkdtempSync(join(tmpdir(), "first-run-"));
  dirs.push(home);
  mkdirSync(join(home, ".devstation"), { recursive: true });
  writeFileSync(
    join(home, ".devstation", "update-check.json"),
    JSON.stringify({ checkedAt: Date.now(), latest }),
  );
  return home;
}

describe("a newer version at start", () => {
  it("is offered as a choice: upgrade now, or continue with this one", () => {
    const home = homeWith("9.9.9");
    expect(cachedUpdate({ home, env: {} })).toBe("9.9.9");
    const question = updateQuestion("9.9.9");
    expect(question.heading).toContain(`9.9.9 is available. You have ${VERSION}.`);
    expect(question.choices.map((c) => c.label)).toEqual([
      "Upgrade to 9.9.9 now",
      `Continue with ${VERSION}`,
    ]);
  });

  it("is not offered when this is the latest, or checks are off", () => {
    expect(cachedUpdate({ home: homeWith(VERSION), env: {} })).toBeNull();
    expect(cachedUpdate({ home: homeWith("9.9.9"), env: { CI: "true" } })).toBeNull();
    expect(
      cachedUpdate({ home: homeWith("9.9.9"), env: { DEVSTATION_NO_UPDATE_CHECK: "1" } }),
    ).toBeNull();
  });

  it("does not also print the one-line notice once the person has been asked", async () => {
    const errors: string[] = [];
    const terminal = { err: (t: string) => errors.push(t), out: () => {} } as unknown as Terminal;
    const home = homeWith("9.9.9");
    await notifyIfOutdated(terminal, { home, env: {}, silent: true });
    expect(errors).toEqual([]);
    await notifyIfOutdated(terminal, { home, env: {} });
    expect(errors.join("")).toContain("devstation upgrade");
  });
});

describe("the permission prompt", () => {
  const request = (riskLevel: string): ApprovalRequest => ({
    tool: "run_shell",
    input: { command: "curl -s https://rpc1mainnet.qie.digital/" },
    operation: "shell.write",
    resources: [],
    riskLevel,
    why: "Running a command can change files, install software, or reach the network.",
  });

  it("does not label an ordinary command as high risk", () => {
    expect(renderApproval(request("high"))).not.toContain("Risk");
    expect(renderApproval(request("medium"))).not.toContain("Risk");
  });

  it("still says so when an action is critical", () => {
    expect(renderApproval(request("critical"))).toContain("Risk: critical");
  });
});

describe("notes under a turn", () => {
  it("do not show the model's note about calls that did not take effect", () => {
    const chunks: string[] = [];
    const live = new LiveView((t) => chunks.push(t), { colour: false, tickMs: 0 });
    live.event({
      kind: "turn.partial",
      message:
        "Only part of that turn happened. 1 of 2 tool calls took effect (run_shell), and 1 did not (run_shell).",
      at: "",
    });
    live.stop();
    expect(chunks.join("")).not.toContain("Only part of that turn happened");
  });
});

describe("what the agent knows about QIE", () => {
  it("has the real chain IDs and endpoints, and knows 5656 is another chain", () => {
    expect(CODING_AGENT_SYSTEM).toContain("QIE Mainnet: chain ID 1990");
    expect(CODING_AGENT_SYSTEM).toContain("https://rpc1mainnet.qie.digital");
    expect(CODING_AGENT_SYSTEM).toContain("QIE Testnet: chain ID 1983");
    expect(CODING_AGENT_SYSTEM).toContain("Chain ID 5656");
    expect(CODING_AGENT_SYSTEM).toContain("is not QIE Mainnet");
  });
});
