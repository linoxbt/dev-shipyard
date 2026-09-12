import { describe, expect, it } from "bun:test";
import { alwaysRequiresPerson, evaluate } from "./policy";
import type { ProtectedAction } from "./authorization";

const act = (over: Partial<ProtectedAction>): ProtectedAction => ({
  actionId: "a",
  taskId: "t",
  userId: "u",
  operation: "file.write",
  resources: ["src/app.js"],
  projectId: "p",
  ...over,
});

describe("ordinary development is never interrupted", () => {
  it("allows the everyday operations without asking", () => {
    for (const op of [
      "component.create",
      "component.edit",
      "style.edit",
      "route.create",
      "file.write",
      "file.read",
      "test.run",
      "code.refactor",
      "project.inspect",
    ]) {
      expect(evaluate(act({ operation: op })).decision).toBe("allow");
    }
  });
});

describe("consequential actions ask, and say why", () => {
  it("gates destructive and expensive operations", () => {
    const gated: Array<[string, string]> = [
      ["file.delete", "high"],
      ["database.migration", "high"],
      ["database.drop", "critical"],
      ["funds.transfer", "critical"],
      ["secret.read", "critical"],
      ["shell.exec", "critical"],
      ["deploy.publish", "high"],
      ["auth.modify", "high"],
      ["dependency.install", "medium"],
    ];
    for (const [op, risk] of gated) {
      const v = evaluate(act({ operation: op }));
      expect(v.decision).toBe("confirm");
      if (v.decision !== "confirm") continue;
      expect(v.riskLevel).toBe(risk as never);
      // "Are you sure?" is not enough: the reason must be concrete.
      expect(v.why.length).toBeGreaterThan(30);
    }
  });

  it("raises the stakes in production", () => {
    const dev = evaluate(act({ operation: "database.migration", environment: "development" }));
    const prod = evaluate(act({ operation: "database.migration", environment: "production" }));
    if (dev.decision !== "confirm" || prod.decision !== "confirm")
      throw new Error("expected confirm");
    expect(dev.riskLevel).toBe("high");
    expect(prod.riskLevel).toBe("critical");
  });
});

describe("unknown operations fail closed", () => {
  it("does not assume a new tool is safe", () => {
    // A tool added later must be classified before it runs unattended.
    expect(evaluate(act({ operation: "wallet.drain" })).decision).toBe("confirm");
    expect(evaluate(act({ operation: "something.new" })).decision).toBe("confirm");
  });
});

describe("autonomy cannot dissolve the floor", () => {
  it("lets a fully autonomous user skip medium and high", () => {
    expect(
      evaluate(act({ operation: "dependency.install" }), { autonomy: "autonomous" }).decision,
    ).toBe("allow");
  });

  it("still asks for critical actions however autonomous the setting", () => {
    for (const op of ["funds.transfer", "database.drop", "project.delete", "shell.exec"]) {
      expect(evaluate(act({ operation: op }), { autonomy: "autonomous" }).decision).toBe("confirm");
      expect(alwaysRequiresPerson(act({ operation: op }))).toBe(true);
    }
  });

  it("keeps production database work behind a person even when autonomous", () => {
    const v = evaluate(act({ operation: "database.migration", environment: "production" }), {
      autonomy: "autonomous",
    });
    expect(v.decision).toBe("confirm");
  });
});

describe("the four autonomy rungs", () => {
  // Each is strictly wider than the one before, and none can reach critical.
  const medium = { operation: "dependency.install", resources: ["npm:left-pad"] };
  const high = { operation: "vcs.push", resources: ["github:owner/repo"] };
  const critical = { operation: "shell.exec", resources: ["sh:rm"] };
  const deploy = { operation: "deploy.publish", resources: ["site:app"] };

  const decide = (
    action: { operation: string; resources: string[] },
    autonomy: "ask_sensitive" | "ask_integrations" | "ask_deploy" | "autonomous",
  ) =>
    evaluate(
      {
        actionId: "a",
        taskId: "t",
        userId: "u",
        projectId: "p",
        environment: "development",
        parameters: {},
        ...action,
      },
      { autonomy },
    ).decision;

  it("asks about everything gated on the default rung", () => {
    expect(decide(medium, "ask_sensitive")).toBe("confirm");
    expect(decide(high, "ask_sensitive")).toBe("confirm");
  });

  it("lets routine integration work through on ask_integrations", () => {
    // This rung was offered in --help and did nothing at all: it fell through
    // to the same answer as the default, so choosing it changed nothing and
    // there was no way to tell.
    expect(decide(medium, "ask_integrations")).toBe("allow");
    // And still asks about the things that publish or push.
    expect(decide(high, "ask_integrations")).toBe("confirm");
    expect(decide(deploy, "ask_integrations")).toBe("confirm");
    expect(decide(critical, "ask_integrations")).toBe("confirm");
  });

  it("lets high risk through on ask_deploy, except deploys", () => {
    expect(decide(high, "ask_deploy")).toBe("allow");
    expect(decide(deploy, "ask_deploy")).toBe("confirm");
  });

  it("never lets critical through, on any rung", () => {
    for (const mode of ["ask_sensitive", "ask_integrations", "ask_deploy", "autonomous"] as const) {
      expect(decide(critical, mode)).toBe("confirm");
    }
  });
});
