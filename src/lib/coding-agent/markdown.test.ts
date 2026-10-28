import { describe, expect, it } from "bun:test";
import { parseInline, parseMarkdown, safeHref } from "./markdown";

describe("parseMarkdown", () => {
  it("reads the blocks a reply uses", () => {
    const blocks = parseMarkdown(
      [
        "## Done",
        "I built **the page** and ran `bun test`.",
        "",
        "- one",
        "- two",
        "",
        "1. first",
        "2. second",
        "",
        "```ts",
        "const a = 1;",
        "```",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.kind)).toEqual(["heading", "paragraph", "list", "list", "code"]);
    expect(blocks[2]).toMatchObject({ kind: "list", ordered: false });
    expect(blocks[3]).toMatchObject({ kind: "list", ordered: true });
    expect(blocks[4]).toEqual({ kind: "code", lang: "ts", text: "const a = 1;" });
  });

  it("keeps an unterminated fence as code rather than losing it", () => {
    expect(parseMarkdown("```\nhalf")).toEqual([{ kind: "code", lang: "", text: "half" }]);
  });
});

describe("parseInline", () => {
  it("parses code, bold, italics and links", () => {
    expect(parseInline("run `x` **now** and *then* see [docs](https://a.test/d)")).toEqual([
      { kind: "text", text: "run " },
      { kind: "code", text: "x" },
      { kind: "text", text: " " },
      { kind: "bold", children: [{ kind: "text", text: "now" }] },
      { kind: "text", text: " and " },
      { kind: "italic", children: [{ kind: "text", text: "then" }] },
      { kind: "text", text: " see " },
      { kind: "link", href: "https://a.test/d", children: [{ kind: "text", text: "docs" }] },
    ]);
  });

  it("never makes a link out of a script URL", () => {
    expect(parseInline("[click](javascript:alert(1))")).not.toContainEqual(
      expect.objectContaining({ kind: "link" }),
    );
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
  });

  it("leaves snake_case alone and links bare URLs without trailing punctuation", () => {
    expect(parseInline("my_var_name")).toEqual([{ kind: "text", text: "my_var_name" }]);
    expect(parseInline("at https://x.test/a.")).toEqual([
      { kind: "text", text: "at " },
      {
        kind: "link",
        href: "https://x.test/a",
        children: [{ kind: "text", text: "https://x.test/a" }],
      },
      { kind: "text", text: "." },
    ]);
  });
});
