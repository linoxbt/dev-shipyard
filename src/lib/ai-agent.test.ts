import { describe, expect, it } from "bun:test";
import { parseAction, extractLastSolidity, extractLastJson } from "./ai-agent";

describe("parseAction", () => {
  it("parses the original directives", () => {
    expect(parseAction("text\n@@DONE").kind).toBe("done");
    expect(parseAction("```solidity\ncontract A {}\n```\n@@COMPILE name=A").kind).toBe("compile");
    const d = parseAction('@@DEPLOY name=A args=["$WALLET",1]');
    expect(d.kind).toBe("deploy");
    if (d.kind === "deploy") expect(d.args).toEqual(["$WALLET", 1]);
  });

  it("parses @@TEST and its JSON suite", () => {
    const msg = [
      "Here are the tests.",
      "```json",
      '{"deployArgs":["$OWNER"],"tests":[{"name":"t","call":"x","expect":{"equals":"1"}}]}',
      "```",
      "@@TEST name=Token",
    ].join("\n");
    const a = parseAction(msg);
    expect(a.kind).toBe("test");
    if (a.kind === "test") {
      expect(a.name).toBe("Token");
      expect((a.suite as { tests: unknown[] }).tests).toHaveLength(1);
    }
  });

  it("returns a null suite for malformed JSON instead of throwing", () => {
    // Must be recoverable: the model gets told to fix it, same as a bad compile.
    const a = parseAction("```json\n{not valid json,,,}\n```\n@@TEST name=T");
    expect(a.kind).toBe("test");
    if (a.kind === "test") expect(a.suite).toBeNull();
  });

  it("parses @@REVIEW", () => {
    const a = parseAction("Reviewing.\n@@REVIEW name=Token");
    expect(a.kind).toBe("review");
    if (a.kind === "review") expect(a.name).toBe("Token");
  });

  it("parses @@LABEL with a multi-word category", () => {
    const a = parseAction('@@LABEL name=MyToken category="Token Standards"');
    expect(a.kind).toBe("label");
    if (a.kind === "label") {
      expect(a.name).toBe("MyToken");
      expect(a.category).toBe("Token Standards");
    }
  });

  it("uses the LAST directive when several appear", () => {
    expect(parseAction("@@COMPILE name=A\nmore\n@@REVIEW name=A").kind).toBe("review");
  });

  it("returns none when there is no directive", () => {
    expect(parseAction("just prose").kind).toBe("none");
  });
});

describe("extractors", () => {
  it("takes the LAST solidity block", () => {
    expect(extractLastSolidity("```solidity\nold\n```\ntext\n```solidity\nnew\n```")).toBe("new");
  });

  it("takes the LAST json block", () => {
    expect(extractLastJson('```json\n{"a":1}\n```\n```json\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it("returns null when there is no json block", () => {
    expect(extractLastJson("no code here")).toBeNull();
  });
});
