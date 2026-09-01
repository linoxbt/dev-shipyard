import { afterEach, describe, expect, it, mock } from "bun:test";
import { projectFiles, runBuildJob, buildConfigured, resetBuildConfigured } from "./build";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  resetBuildConfigured();
});

function respondWith(status: number, body: unknown) {
  globalThis.fetch = mock(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("projectFiles", () => {
  it("makes the app directory the project root", () => {
    // npm installs from ./package.json. Left as app/package.json there is
    // nothing to install and nothing to build.
    const out = projectFiles({
      "app/package.json": "{}",
      "app/src/app.js": "x",
      "notes.md": "ignored",
    });
    expect(Object.keys(out).sort()).toEqual(["package.json", "src/app.js"]);
  });
});

describe("runBuildJob", () => {
  const files = { "app/package.json": "{}", "app/src/app.js": "x" };

  it("returns the job's phases and built output", async () => {
    respondWith(200, {
      ok: true,
      phases: [{ phase: "build", ok: true, log: "done" }],
      dist: { "index.html": "<html>" },
    });
    const out = await runBuildJob(files);
    expect(out.ok).toBe(true);
    expect(out.dist).toEqual({ "index.html": "<html>" });
    expect(out.unavailable).toBeUndefined();
  });

  it("distinguishes a failed build from one that never ran", async () => {
    // The difference decides whether the model is asked to fix something. A
    // missing runner is not a defect in the app.
    respondWith(200, {
      ok: false,
      phases: [{ phase: "build", ok: false, log: "Could not resolve ./x.js" }],
      dist: null,
    });
    const failed = await runBuildJob(files);
    expect(failed.ok).toBe(false);
    expect(failed.unavailable).toBeUndefined();

    respondWith(501, {
      ok: false,
      reason: "not_configured",
      message: "Builds are not configured.",
    });
    const never = await runBuildJob(files);
    expect(never.unavailable).toBe("Builds are not configured.");
  });

  it("does not throw when the service is unreachable", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const out = await runBuildJob(files);
    expect(out.unavailable).toContain("Could not reach");
  });

  it("refuses a project with no package.json rather than posting it", async () => {
    let called = false;
    globalThis.fetch = mock(async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch;
    const out = await runBuildJob({ "app/index.html": "<html>" });
    expect(out.unavailable).toContain("no package.json");
    expect(called).toBe(false);
  });
});

describe("buildConfigured", () => {
  it("reports false when the endpoint says so, and asks only once", async () => {
    let calls = 0;
    globalThis.fetch = mock(async () => {
      calls++;
      return new Response(JSON.stringify({ configured: false }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await buildConfigured()).toBe(false);
    expect(await buildConfigured()).toBe(false);
    expect(calls).toBe(1);
  });

  it("treats an unreachable endpoint as 'no builds here'", async () => {
    globalThis.fetch = mock(async () => {
      throw new TypeError("nope");
    }) as unknown as typeof fetch;
    expect(await buildConfigured()).toBe(false);
  });
});

describe("projectFiles — the workspace prefix", () => {
  it("moves the project to the root, because npm installs in /work", () => {
    // 38 of 54 recorded builds failed on "ENOENT /work/package.json" because a
    // caller sent app/-prefixed paths straight to the runner. The container
    // installs at /work, so package.json has to be at the top.
    const out = projectFiles({
      "app/package.json": "{}",
      "app/src/main.js": "x",
      "app/index.html": "<h1/>",
    });
    expect(Object.keys(out).sort()).toEqual(["index.html", "package.json", "src/main.js"]);
  });

  it("drops anything outside the workspace directory", () => {
    const out = projectFiles({ "app/package.json": "{}", "notes.md": "x" });
    expect(out["notes.md"]).toBeUndefined();
    expect(out["package.json"]).toBe("{}");
  });

  it("returns nothing when NOTHING carries the prefix — the failure mode", () => {
    // An empty result is what the runner saw: a container with no package.json.
    // Callers must not hand these files to the runner expecting a build.
    expect(projectFiles({ "package.json": "{}", "index.html": "<h1/>" })).toEqual({});
  });

  it("honours a non-default workspace directory", () => {
    const out = projectFiles({ "site/package.json": "{}" }, "site");
    expect(out["package.json"]).toBe("{}");
  });
});
