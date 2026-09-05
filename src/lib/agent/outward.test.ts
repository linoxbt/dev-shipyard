import { describe, expect, it } from "bun:test";
import { preflight, requiresPerson, TOOLS } from "./tools";
import { evaluate, alwaysRequiresPerson } from "./policy";
import { actionFingerprint, type ProtectedAction } from "./authorization";

// The tools that reach outside DevStation. The agent never performs one and
// never holds a credential for one: it proposes, a person approves, and their
// own session carries it out. These pin the three properties that makes safe -
// that it always asks, that an approval covers exactly one target, and that the
// agent cannot be handed the job of doing it.

const ctx = { taskId: "t1", userId: "0xowner", projectId: "p1" } as const;

describe("who performs an outward action", () => {
  it("marks pushing and publishing as the person's to do, not the agent's", () => {
    expect(requiresPerson("push_to_github")).toBe(true);
    expect(requiresPerson("publish_app")).toBe(true);
  });

  it("leaves ordinary development to the agent", () => {
    for (const name of ["read_file", "search_files", "write_file", "run_build"]) {
      expect(requiresPerson(name)).toBe(false);
    }
  });

  it("says no for a tool that does not exist, rather than throwing", () => {
    expect(requiresPerson("launch_missiles")).toBe(false);
  });
});

describe("pushing to GitHub", () => {
  it("always asks first", () => {
    const r = preflight({ id: "p1", name: "push_to_github", args: { repoName: "my-app" } }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok && r.rejection.reason === "needs_authorization") {
      expect(r.rejection.verdict.riskLevel).toBe("high");
      // The reason is about what actually happens, not "are you sure?".
      expect(r.rejection.message).toContain("repository");
    }
  });

  it("scopes the approval to one repository", () => {
    const forOne = preflight(
      { id: "p1", name: "push_to_github", args: { repoName: "my-app" } },
      ctx,
    );
    const forAnother = preflight(
      { id: "p2", name: "push_to_github", args: { repoName: "someone-elses-app" } },
      ctx,
    );
    expect(forOne.ok).toBe(false);
    expect(forAnother.ok).toBe(false);
    if (
      !forOne.ok &&
      !forAnother.ok &&
      forOne.rejection.reason === "needs_authorization" &&
      forAnother.rejection.reason === "needs_authorization"
    ) {
      expect(forOne.rejection.action.resources).toEqual(["github:my-app"]);
      // Approving a push to one repo must not authorise a push to another:
      // different resources, therefore a different fingerprint, therefore no
      // grant issued for the first will ever match the second.
      expect(actionFingerprint(forOne.rejection.action)).not.toBe(
        actionFingerprint(forAnother.rejection.action),
      );
    }
  });

  it("refuses a repository name that is not one", () => {
    for (const repoName of ["../escape", "has spaces", "a/b", ""]) {
      const r = preflight({ id: "p1", name: "push_to_github", args: { repoName } }, ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejection.reason).toBe("invalid_arguments");
    }
  });
});

describe("what an approval is bound to", () => {
  function fingerprintFor(args: Record<string, unknown>): string {
    const r = preflight({ id: "p", name: "push_to_github", args }, ctx);
    if (r.ok || r.rejection.reason !== "needs_authorization") throw new Error("expected a gate");
    return actionFingerprint(r.rejection.action);
  }

  it("survives a commit message the model did not mention the first time", () => {
    // A live run: the push was approved, the resumed turn re-proposed it with
    // "Initial commit" attached, the fingerprint no longer matched, and it
    // asked a second time. A commit message does not change what was agreed to.
    expect(fingerprintFor({ repoName: "my-app" })).toBe(
      fingerprintFor({ repoName: "my-app", message: "Initial commit" }),
    );
  });

  it("treats an unstated private push and a stated one as the same action", () => {
    expect(fingerprintFor({ repoName: "my-app" })).toBe(
      fingerprintFor({ repoName: "my-app", isPrivate: true }),
    );
  });

  it("does NOT let approval of a private push authorise a public one", () => {
    // Visibility is the argument that matters, and it stays in the fingerprint.
    expect(fingerprintFor({ repoName: "my-app", isPrivate: true })).not.toBe(
      fingerprintFor({ repoName: "my-app", isPrivate: false }),
    );
  });

  it("still distinguishes repositories", () => {
    expect(fingerprintFor({ repoName: "my-app" })).not.toBe(fingerprintFor({ repoName: "other" }));
  });
});

describe("publishing a site", () => {
  it("always asks first", () => {
    const r = preflight({ id: "s1", name: "publish_app", args: { slug: "my-app" } }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok && r.rejection.reason === "needs_authorization") {
      expect(r.rejection.verdict.riskLevel).toBe("high");
    }
  });

  it("scopes the approval to one subdomain", () => {
    const r = preflight({ id: "s1", name: "publish_app", args: { slug: "my-app" } }, ctx);
    if (!r.ok && r.rejection.reason === "needs_authorization") {
      expect(r.rejection.action.resources).toEqual(["site:my-app"]);
    }
  });

  it("refuses anything that is not a subdomain", () => {
    for (const slug of ["Has-Caps", "under_score", "dots.here", "../x", ""]) {
      const r = preflight({ id: "s1", name: "publish_app", args: { slug } }, ctx);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.rejection.reason).toBe("invalid_arguments");
    }
  });
});

describe("autonomy cannot switch these off", () => {
  const push: ProtectedAction = {
    actionId: "a1",
    taskId: "t1",
    userId: "0xowner",
    operation: "vcs.push",
    resources: ["github:my-app"],
    environment: "development",
    projectId: "p1",
  };

  it("still asks under the most permissive setting short of full autonomy", () => {
    // ask_deploy widens ordinary work; a push is not ordinary work.
    expect(evaluate(push, { autonomy: "ask_sensitive" }).decision).toBe("confirm");
    expect(evaluate(push, { autonomy: "ask_integrations" }).decision).toBe("confirm");
  });

  it("is escalated rather than waved through in production", () => {
    const inProd = { ...push, environment: "production" as const };
    const v = evaluate(inProd);
    expect(v.decision).toBe("confirm");
    if (v.decision === "confirm") expect(v.riskLevel).toBe("critical");
    // And a critical action asks whatever the autonomy setting says.
    expect(alwaysRequiresPerson(inProd)).toBe(true);
  });
});

describe("the registry as a whole", () => {
  it("classifies every tool it offers, so nothing is unknown by accident", () => {
    for (const [name, tool] of Object.entries(TOOLS)) {
      const verdict = evaluate({
        actionId: "x",
        taskId: "t",
        userId: "u",
        operation: tool.operation,
        resources: ["r"],
        projectId: "p",
      });
      // Either it is recognised safe, or it is recognised as needing a person.
      // What must never happen is a tool whose operation the policy engine has
      // never heard of, which it reports as needing approval with a generic
      // reason: correct, but a sign the tool was added and not classified.
      if (verdict.decision === "confirm") {
        expect(verdict.why).not.toContain("not a recognised safe operation");
      }
      expect(name).toBe(tool.name);
    }
  });
});
