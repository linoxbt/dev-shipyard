import { describe, expect, it, beforeEach } from "bun:test";
import { cleanName, defaultName, nameFromPrompt, useProjects, type AppProject } from "./projects";

const reset = () => useProjects.setState({ projects: [], activeId: null, hydrated: true });
beforeEach(reset);

const project = (over: Partial<AppProject> = {}): AppProject => ({
  id: "x",
  name: "n",
  createdAt: 0,
  updatedAt: 0,
  files: {},
  history: [],
  turns: [],
  ...over,
});

describe("cleanName", () => {
  it("tidies without discarding what was typed", () => {
    expect(cleanName("  My   Tip Jar  ")).toBe("My Tip Jar");
  });

  it("falls back rather than allowing a nameless project", () => {
    expect(cleanName("   ")).toBe("Untitled app");
    expect(cleanName("", "Keep this")).toBe("Keep this");
  });

  it("bounds a very long name", () => {
    expect(cleanName("x".repeat(500)).length).toBe(60);
  });
});

describe("defaultName", () => {
  it("never collides with an existing name", () => {
    const existing = [project({ name: "Untitled app" }), project({ name: "Untitled app 2" })];
    expect(defaultName(existing)).toBe("Untitled app 3");
  });
});

describe("projects", () => {
  it("creates a project and makes it active", () => {
    const id = useProjects.getState().create("Tip Jar");
    const s = useProjects.getState();
    expect(s.activeId).toBe(id);
    expect(s.active()?.name).toBe("Tip Jar");
  });

  it("keeps files and conversation together", () => {
    // The pairing is the point: reopening restores the code AND what was asked
    // for, so the agent is not left with amnesia about everything but the code.
    useProjects.getState().create("App");
    useProjects.getState().save({
      files: { "app/src/app.js": "const x = 1;" },
      history: [{ role: "user", content: "build a counter" }],
    });
    const a = useProjects.getState().active()!;
    expect(a.files["app/src/app.js"]).toBe("const x = 1;");
    expect(a.history[0].content).toBe("build a counter");
  });

  it("switches between projects without mixing them up", () => {
    const first = useProjects.getState().create("First");
    useProjects.getState().save({ files: { a: "1" } });
    const second = useProjects.getState().create("Second");
    useProjects.getState().save({ files: { b: "2" } });

    useProjects.getState().open(first);
    expect(useProjects.getState().active()?.files).toEqual({ a: "1" });
    useProjects.getState().open(second);
    expect(useProjects.getState().active()?.files).toEqual({ b: "2" });
  });

  it("renames without touching anything else", () => {
    const id = useProjects.getState().create("Old");
    useProjects.getState().save({ files: { a: "1" } });
    useProjects.getState().rename(id, "New");
    const a = useProjects.getState().active()!;
    expect(a.name).toBe("New");
    expect(a.files).toEqual({ a: "1" });
  });

  it("picks a new active project when the active one is deleted", () => {
    // Leaving activeId pointing at a deleted project would open the builder
    // onto nothing.
    const first = useProjects.getState().create("First");
    const second = useProjects.getState().create("Second");
    useProjects.getState().open(second);
    useProjects.getState().remove(second);
    expect(useProjects.getState().activeId).toBe(first);
  });

  it("ignores a save when nothing is open", () => {
    expect(() => useProjects.getState().save({ files: { a: "1" } })).not.toThrow();
    expect(useProjects.getState().projects).toEqual([]);
  });

  it("starts empty on the server, so hydration matches", () => {
    // A store that read localStorage during render would give the server and
    // the first client render different trees.
    reset();
    expect(useProjects.getState().projects).toEqual([]);
  });
});

describe("persisted data is validated, not trusted", () => {
  // bun's test environment has no localStorage; the store reads it defensively,
  // so a minimal stand-in is enough to exercise the parsing path.
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });

  it("drops a corrupt project instead of white-screening the app", () => {
    // localStorage is user-editable and carries data from older versions.
    // An unchecked cast rendered straight into JSX: `t.changed.map(...)` on a
    // non-array throws and takes the whole route down.
    localStorage.setItem(
      "devstation-apps-v1",
      JSON.stringify({
        activeId: "bad",
        projects: [
          { id: "bad", name: "Broken", createdAt: 0, updatedAt: 0, turns: "not-an-array" },
          {
            id: "good",
            name: "Fine",
            createdAt: 0,
            updatedAt: 0,
            files: {},
            history: [],
            turns: [],
          },
        ],
      }),
    );
    useProjects.setState({ projects: [], activeId: null, hydrated: false });
    useProjects.getState().hydrate();
    const s = useProjects.getState();
    expect(s.projects.map((p) => p.id)).toEqual(["good"]);
    // And it must not still point at the project that failed validation.
    expect(s.activeId).toBeNull();
  });

  it("survives outright garbage", () => {
    localStorage.setItem("devstation-apps-v1", "{{{not json");
    useProjects.setState({ projects: [], activeId: null, hydrated: false });
    expect(() => useProjects.getState().hydrate()).not.toThrow();
    expect(useProjects.getState().projects).toEqual([]);
  });
});

describe("nameFromPrompt", () => {
  it("names a project after what was asked for", () => {
    expect(nameFromPrompt("Build a tip jar with a QIE amount input")).toBe(
      "Tip jar with a QIE amount input",
    );
    expect(nameFromPrompt("create an NFT gallery")).toBe("NFT gallery");
  });

  it("stops at the first sentence", () => {
    expect(nameFromPrompt("A counter app. Make it colourful and add a reset.")).toBe(
      "A counter app",
    );
  });

  it("bounds a rambling prompt", () => {
    expect(nameFromPrompt("build ".repeat(80)).length).toBeLessThanOrEqual(60);
  });

  it("returns empty for an empty prompt, so the caller can fall back", () => {
    expect(nameFromPrompt("   ")).toBe("");
  });
});
