import { describe, expect, it } from "bun:test";
import { SLASH_COMMANDS } from "./args";
import { slashMenuItems, slashMenuLines } from "./slash-menu";

describe("the command list under the prompt", () => {
  it("shows every command as soon as / is typed", () => {
    const lines = slashMenuLines("/", slashMenuItems());
    expect(lines).toHaveLength(SLASH_COMMANDS.length);
    expect(lines[0]).toContain("/new");
    expect(lines.join("\n")).toContain("/exit");
  });

  it("narrows as more is typed, matching aliases too", () => {
    const lines = slashMenuLines("/re", slashMenuItems());
    expect(lines.map((l) => l.trim().split(" ")[0])).toEqual(["/resume", "/rename"]);
    expect(slashMenuLines("/cle", slashMenuItems())[0]).toContain("/new");
  });

  it("includes the project's skills", () => {
    expect(slashMenuLines("/rel", slashMenuItems(["release-notes"]))[0]).toContain(
      "/release-notes",
    );
  });

  it("stays out of the way of ordinary text and finished commands", () => {
    expect(slashMenuLines("hello", slashMenuItems())).toEqual([]);
    expect(slashMenuLines("/model gpt", slashMenuItems())).toEqual([]);
  });

  it("says when nothing matches, and fits the screen", () => {
    expect(slashMenuLines("/zzz", slashMenuItems())[0]).toContain("No command starts with /zzz");
    const lines = slashMenuLines("/", slashMenuItems(), { maxRows: 5 });
    expect(lines).toHaveLength(5);
    expect(lines[4]).toContain("more");
  });
});
