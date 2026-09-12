import { describe, expect, it } from "bun:test";
import { classifyCommand } from "./command-class";

describe("chains of read-only commands", () => {
  it("does not gate a chain where every part only reads", () => {
    // The real prompt that asked for approval as high risk.
    expect(classifyCommand('ls -a; echo "--- top level ---"; ls -d */ 2>/dev/null')).toBe("safe");
    expect(classifyCommand("cat package.json | grep version")).toBe("safe");
    expect(classifyCommand("git status && git log --oneline")).toBe("safe");
    expect(classifyCommand("ls -la 2>&1 | head -20")).toBe("safe");
  });

  it("still gates a chain with any part that is not read-only", () => {
    expect(classifyCommand("ls && npm install")).toBe("writes");
    expect(classifyCommand("cat a.txt | tee b.txt")).toBe("writes");
  });

  it("still gates a redirect into a file", () => {
    expect(classifyCommand("echo hi > notes.txt")).toBe("writes");
    expect(classifyCommand("ls >> listing.txt")).toBe("writes");
  });

  it("still gates substitution, which can run anything", () => {
    expect(classifyCommand("ls $(whoami)")).toBe("writes");
    expect(classifyCommand("echo `id`")).toBe("writes");
  });

  it("still reports destruction in a chain as destructive", () => {
    expect(classifyCommand("ls && rm -rf build")).toBe("destructive");
  });
});
