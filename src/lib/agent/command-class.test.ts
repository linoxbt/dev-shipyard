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

  it("does not gate reading inside a folder, but gates what writes there", () => {
    expect(
      classifyCommand('cd genlayer-provenance && find . -type f -not -path "./.venv/*" | head -80'),
    ).toBe("safe");
    expect(classifyCommand("cd contracts && npm install --save-dev hardhat")).toBe("writes");
  });

  it("does not gate asking which account is signed in, or reading git config", () => {
    // Both asked for permission, labelled high risk, when someone asked which
    // GitHub account was logged in.
    expect(
      classifyCommand(
        'echo "--- git config user ---"; git config --get user.name 2>&1; git config --global --list 2>&1 | head -30',
      ),
    ).toBe("safe");
    expect(
      classifyCommand('command -v gh 2>&1 || echo "gh not on PATH"; gh auth status 2>&1 || true'),
    ).toBe("safe");
    expect(classifyCommand("gh repo view linoxbt/dev-shipyard")).toBe("safe");
  });

  it("still gates what changes config, repositories or runs a program", () => {
    expect(classifyCommand("git config --global user.name someone")).toBe("writes");
    expect(classifyCommand("gh repo create my-app --public")).toBe("writes");
    expect(classifyCommand("gh auth login")).toBe("writes");
    expect(classifyCommand("command rm notes.txt")).toBe("writes");
  });

  it("still reports destruction in a chain as destructive", () => {
    expect(classifyCommand("ls && rm -rf build")).toBe("destructive");
  });
});
