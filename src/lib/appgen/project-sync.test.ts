import { afterAll, beforeAll, describe, expect, it } from "bun:test";

// Two devices signed in to one account, one after the other, against an
// in-memory stand-in for api/projects that keeps the same rule as the
// database: a newer version wins, an older one is refused.

interface Row {
  id: string;
  name: string;
  updatedAt: number;
  deleted: boolean;
  body: string | null;
}
const server = new Map<string, Row>();

const fake = async (url: string, init?: RequestInit): Promise<Response> => {
  const u = new URL(url, "https://site.test");
  if (init?.method === "POST") {
    const p = JSON.parse(String(init.body)) as Row & { body?: string };
    const old = server.get(p.id);
    if (!old || old.updatedAt < p.updatedAt) {
      server.set(p.id, {
        id: p.id,
        name: p.name ?? "",
        updatedAt: p.updatedAt,
        deleted: !!p.deleted,
        body: p.deleted ? null : (p.body ?? null),
      });
    }
    const stored = server.get(p.id)!.updatedAt;
    return Response.json({ ok: true, stored, applied: stored === p.updatedAt });
  }
  const id = u.searchParams.get("id");
  if (id) {
    const row = server.get(id);
    return row ? Response.json({ ok: true, ...row }) : Response.json({}, { status: 404 });
  }
  return Response.json({
    ok: true,
    projects: [...server.values()].map(({ body: _b, ...rest }) => rest),
  });
};

const storage = new Map<string, string>();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const added: string[] = [];
afterAll(() => {
  for (const k of added) delete (globalThis as Record<string, unknown>)[k];
});

beforeAll(() => {
  const g = globalThis as Record<string, unknown>;
  for (const k of ["localStorage", "window", "document"]) if (!(k in g)) added.push(k);
  g.localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  };
  g.window ??= { addEventListener() {}, removeEventListener() {} };
  g.document ??= {
    visibilityState: "visible",
    addEventListener() {},
    removeEventListener() {},
  };
});

describe("projects across devices", () => {
  it("brings a project, its chat and its build to another device, and deletes it everywhere", async () => {
    const { useProjects } = await import("./projects");
    const { startProjectSync } = await import("./project-sync");

    // Device A builds something.
    useProjects.setState({ projects: [], activeId: null, hydrated: true });
    const stopA = startProjectSync("me@example.com", { pushDelayMs: 10, fetch: fake });
    const id = useProjects.getState().create("Habit tracker", "me@example.com");
    useProjects.getState().update(id, {
      files: { "src/App.tsx": "export default () => <h1>Habits</h1>;" },
      dist: { "index.html": "<!doctype html><h1>Habits</h1>" },
      turns: [
        { role: "user", text: "Build a habit tracker" },
        {
          role: "assistant",
          text: "Built.",
          steps: [{ tool: "run_build", title: "Built the app" }],
        },
      ],
    });
    await wait(120);
    stopA();
    expect(server.get(id)?.deleted).toBe(false);

    // Device B: a different browser, nothing in it, the same account.
    storage.clear();
    useProjects.setState({ projects: [], activeId: null, hydrated: true });
    const stopB = startProjectSync("me@example.com", { pushDelayMs: 10, fetch: fake });
    await wait(120);
    const there = useProjects.getState().projects.find((p) => p.id === id);
    expect(there?.name).toBe("Habit tracker");
    expect(there?.files["src/App.tsx"]).toContain("Habits");
    expect(there?.dist?.["index.html"]).toContain("Habits");
    expect(there?.turns[1].steps?.[0].title).toBe("Built the app");

    // Opening it on B sends nothing back: it is already the stored version.
    const before = server.get(id)!.updatedAt;
    await wait(60);
    expect(server.get(id)!.updatedAt).toBe(before);

    // B deletes it: the server keeps the deletion for the other devices.
    useProjects.getState().remove(id);
    await wait(60);
    stopB();
    expect(server.get(id)?.deleted).toBe(true);

    // Back on A (its own browser storage still has the project): it goes.
    storage.clear();
    useProjects.setState({ projects: [there!], activeId: id, hydrated: true });
    const stopA2 = startProjectSync("me@example.com", { pushDelayMs: 10, fetch: fake });
    await wait(120);
    stopA2();
    expect(useProjects.getState().projects.some((p) => p.id === id)).toBe(false);
    expect(useProjects.getState().activeId).toBeNull();
  });

  it("never rolls a newer version back with an older one", async () => {
    const { useProjects } = await import("./projects");
    const { startProjectSync } = await import("./project-sync");
    storage.clear();
    server.clear();
    useProjects.setState({ projects: [], activeId: null, hydrated: true });
    const stop = startProjectSync("me@example.com", { pushDelayMs: 10, fetch: fake });
    const id = useProjects.getState().create("Notes", "me@example.com");
    await wait(80);
    // Another device saved a later version meanwhile.
    const newer = { ...server.get(id)!, updatedAt: server.get(id)!.updatedAt + 60_000 };
    const { encodeProject } = await import("./project-sync");
    const p = useProjects.getState().projects.find((x) => x.id === id)!;
    newer.body = await encodeProject({
      ...p,
      name: "Notes (edited elsewhere)",
      updatedAt: newer.updatedAt,
    });
    server.set(id, newer);
    // This device's stale edit is refused, and the newer one is taken instead.
    useProjects.setState({
      projects: useProjects
        .getState()
        .projects.map((x) =>
          x.id === id ? { ...x, name: "stale", updatedAt: x.updatedAt + 1 } : x,
        ),
    });
    await wait(150);
    stop();
    expect(server.get(id)!.updatedAt).toBe(newer.updatedAt);
    expect(useProjects.getState().projects.find((x) => x.id === id)?.name).toBe(
      "Notes (edited elsewhere)",
    );
  });

  it("drops pictures and then the build before refusing a project that is too large", async () => {
    const { lighterVersions } = await import("./project-sync");
    const versions = lighterVersions({
      id: "x",
      name: "x",
      createdAt: 1,
      updatedAt: 1,
      files: { a: "1" },
      history: [],
      turns: [{ role: "assistant", text: "t", steps: [{ title: "s", shot: "data:x" }] }],
      dist: { "index.html": "x" },
    });
    expect(versions[0].turns[0].steps?.[0].shot).toBe("data:x");
    expect(versions[2].turns[0].steps?.[0].shot).toBeUndefined();
    expect(versions[3].dist).toBeNull();
    expect(versions[3].files).toEqual({ a: "1" });
  });
});
