import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_FILE,
  formatEntry,
  memoryPath,
  parseMemory,
  readMemory,
  remember,
  renderMemory,
} from "./project-memory";

const dirs: string[] = [];
function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "mem-"));
  dirs.push(root);
  return root;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("where memory is kept", () => {
  it("stays private to the workspace by default", () => {
    // The agent does not create a file in somebody's repository to hold its
    // own notes. That is theirs to decide.
    const root = scratch();
    expect(memoryPath(root)).toBe(join(root, ".agent", DEFAULT_FILE));
    remember(root, "the runner is self-hosted");
    expect(existsSync(join(root, DEFAULT_FILE))).toBe(false);
    expect(existsSync(join(root, ".agent", DEFAULT_FILE))).toBe(true);
  });

  it("uses a checked-in file when the person has made one", () => {
    const root = scratch();
    writeFileSync(join(root, DEFAULT_FILE), "# Project memory\n");
    expect(memoryPath(root)).toBe(join(root, DEFAULT_FILE));

    remember(root, "deploys happen on a push to main");
    expect(readFileSync(join(root, DEFAULT_FILE), "utf8")).toContain("deploys happen");
    expect(existsSync(join(root, ".agent", DEFAULT_FILE))).toBe(false);
  });
});

describe("remembering", () => {
  it("keeps a note, dated, and reads it back", () => {
    const root = scratch();
    const result = remember(root, "The runner is self-hosted on port 8792.", "infrastructure");
    expect(result.ok).toBe(true);

    const entries = readMemory(root);
    expect(entries).toHaveLength(1);
    expect(entries[0].note).toBe("The runner is self-hosted on port 8792.");
    expect(entries[0].tag).toBe("infrastructure");
    expect(entries[0].at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("only ever appends, so an earlier note cannot be written away", () => {
    const root = scratch();
    remember(root, "first thing");
    remember(root, "second thing");
    remember(root, "third thing");
    expect(readMemory(root).map((e) => e.note)).toEqual([
      "first thing",
      "second thing",
      "third thing",
    ]);
  });

  it("does not write the same note twice", () => {
    // Otherwise the file grows a new copy of the same sentence every session,
    // and is useless long before it is large.
    const root = scratch();
    remember(root, "Pushes go to app-builder, never main.");
    const again = remember(root, "  pushes go to APP-BUILDER, never main.  ");

    expect(again.duplicate).toBe(true);
    expect(again.message).toContain("Already remembered");
    expect(readMemory(root)).toHaveLength(1);
  });

  it("refuses an empty note instead of writing a blank line", () => {
    const root = scratch();
    const result = remember(root, "   ");
    expect(result.ok).toBe(false);
    expect(readMemory(root)).toEqual([]);
  });

  it("keeps a multi-line note on one line, so the file stays parseable", () => {
    const root = scratch();
    remember(root, "line one\nline two\n  line three");
    expect(readMemory(root)[0].note).toBe("line one line two line three");
  });

  it("leaves anything a person wrote in the file alone", () => {
    const root = scratch();
    writeFileSync(
      join(root, DEFAULT_FILE),
      "# Project memory\n\nSome prose a person wrote by hand.\n",
    );
    remember(root, "an agent note");
    const text = readFileSync(join(root, DEFAULT_FILE), "utf8");
    expect(text).toContain("Some prose a person wrote by hand.");
    expect(text).toContain("an agent note");
  });

  it("survives across sessions, because it is a file", () => {
    const root = scratch();
    remember(root, "The QIE explorer certificate was renewed on 2026-09-03.");
    // A second "session" is a second read with nothing carried over.
    expect(readMemory(root)[0].note).toContain("certificate was renewed");
  });
});

describe("reading a memory file", () => {
  it("ignores prose and picks up entries", () => {
    const entries = parseMemory(`# Project memory

Some explanation.

- [2026-09-01] (infra) The runner is self-hosted.
- [2026-09-02] Deploys go out on a push to main.
`);
    expect(entries).toHaveLength(2);
    expect(entries[0].tag).toBe("infra");
    expect(entries[1].tag).toBeNull();
  });

  it("returns nothing for a workspace that has none", () => {
    expect(readMemory(scratch())).toEqual([]);
  });

  it("round-trips an entry through formatting and parsing", () => {
    const entry = { note: "a note", tag: "t", at: "2026-09-11T10:00:00.000Z" };
    expect(parseMemory(formatEntry(entry))[0]).toEqual({
      note: "a note",
      tag: "t",
      at: "2026-09-11",
    });
  });
});

describe("putting memory in front of the agent", () => {
  it("says nothing at all when there is nothing to say", () => {
    expect(renderMemory([])).toBe("");
  });

  it("marks it as notes rather than as instructions", () => {
    // A note from a previous session is not the user speaking now, and an
    // agent that treats it as such will follow stale orders.
    const rendered = renderMemory([
      { note: "always deploy on Friday", tag: null, at: "2026-01-01" },
    ]);
    expect(rendered).toContain("not instructions from the user");
    expect(rendered).toContain("may be out of date");
  });

  it("caps how much of it goes into the prompt", () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      note: `note ${i}`,
      tag: null,
      at: "2026-01-01",
    }));
    const rendered = renderMemory(many);
    expect(rendered).toContain("note 99");
    expect(rendered).not.toContain("note 5 ");
    expect(rendered).toContain("older entries");
  });
});
