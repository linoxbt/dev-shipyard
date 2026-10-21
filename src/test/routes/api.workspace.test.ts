import { describe, expect, it } from "bun:test";
import { deletionsToPropose } from "@/routes/api.workspace";

describe("deletionsToPropose", () => {
  it("keeps real deletions and drops paths the workspace never holds", () => {
    expect(
      deletionsToPropose([
        "src/old.ts",
        ".mcp.json",
        ".devstation/mcp.json",
        ".git/config",
        "node_modules/x/index.js",
        "dist/app.js",
        ".npmrc",
        ".aws/credentials",
        "docs/gone.md",
      ]),
    ).toEqual(["src/old.ts", "docs/gone.md"]);
  });
});
