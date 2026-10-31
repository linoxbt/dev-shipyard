import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Executor } from "./executor";
import { Orchestrator, type AgentEvent } from "./orchestrator";
import { MockProvider } from "./providers";
import { takeScreenshot } from "./screenshot";
import { Workspace } from "./workspace";

// The browser itself is exercised by hand (it needs Chromium); here a fake
// machine plays the script's part, so what the tool does around it is tested.

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "shot-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Acts as the screenshot script: writes the pictures and prints its report. */
function fakeBrowser(report: Record<string, unknown> = {}): Executor & { commands: string[] } {
  const commands: string[] = [];
  return {
    kind: "host",
    describe: "fake",
    commands,
    dispose: async () => {},
    run: async (command, opts) => {
      commands.push(command);
      const args = JSON.parse(readFileSync(join(opts.cwd, ".devstation/shot-args.json"), "utf8"));
      writeFileSync(join(opts.cwd, `${args.out}.model.jpg`), "JPEGDATA");
      writeFileSync(join(opts.cwd, `${args.out}.jpg`), "THUMB");
      const line = JSON.stringify({
        url: "http://127.0.0.1:4000/",
        status: 200,
        title: "Shop",
        errors: [],
        text: "Welcome to the shop",
        ...report,
      });
      return { ok: true, code: 0, stdout: `@@SHOT@@${line}\n`, stderr: "", timedOut: false };
    },
  };
}

describe("the screenshot tool", () => {
  it("opens built files and returns what the page showed, with the picture", async () => {
    const root = tmp();
    writeFileSync(join(root, "index.html"), "<h1>Shop</h1>");
    const machine = fakeBrowser({ errors: ["Uncaught TypeError: x is undefined"] });
    const shot = await takeScreenshot(machine, root, { width: 390 });
    expect(shot.ok).toBe(true);
    expect(shot.output).toContain("390x800");
    expect(shot.output).toContain("Uncaught TypeError");
    expect(shot.output).toContain("Welcome to the shop");
    expect(shot.image).toBe(`data:image/jpeg;base64,${Buffer.from("JPEGDATA").toString("base64")}`);
    expect(shot.name).toMatch(/^shot-[a-z0-9]+-\d+$/);
    const args = JSON.parse(readFileSync(join(root, ".devstation/shot-args.json"), "utf8"));
    expect(args.dir).toBe(".");
    // Playwright goes in a tools folder, never into the person's project.
    expect(machine.commands[0]).toContain("$HOME/.devstation-tools");
  });

  it("says plainly when there is nothing to open, and refuses paths outside the project", async () => {
    const root = tmp();
    const machine = fakeBrowser();
    expect((await takeScreenshot(machine, root, {})).output).toContain("no dist/index.html");
    expect((await takeScreenshot(machine, root, { dir: "../etc" })).ok).toBe(false);
    expect((await takeScreenshot(machine, root, { url: "file:///etc/passwd" })).ok).toBe(false);
    expect(machine.commands).toHaveLength(0);
  });

  it("reports a browser that could not start", async () => {
    const root = tmp();
    writeFileSync(join(root, "index.html"), "x");
    const broken: Executor = {
      kind: "host",
      describe: "broken",
      dispose: async () => {},
      run: async () => ({
        ok: false,
        code: 1,
        stdout: '@@SHOT@@{"fatal":"Executable doesn\'t exist"}\n',
        stderr: "",
        timedOut: false,
      }),
    };
    const shot = await takeScreenshot(broken, root, {});
    expect(shot.ok).toBe(false);
    expect(shot.output).toContain("Executable doesn't exist");
  });

  it("shows the agent its screenshot, and names it in the step for the chat", async () => {
    const root = tmp();
    const workspace = new Workspace(root);
    workspace.write("index.html", "<h1>Shop</h1>");
    const provider = new MockProvider([
      { text: "Checking it renders.", toolCalls: [{ id: "1", name: "screenshot", input: {} }] },
      { text: "It renders." },
    ]);
    const events: AgentEvent[] = [];
    await new Orchestrator({
      provider,
      workspace,
      executor: fakeBrowser(),
      onEvent: (e) => events.push(e),
    }).run("check the page");

    const seen = provider.calls[1].messages.at(-1) as { role: string; images?: string[] };
    expect(seen.role).toBe("user");
    expect(seen.images).toHaveLength(1);
    const done = events.find((e) => e.kind === "step.completed" && e.tool === "screenshot");
    expect(String(done?.detail?.shot)).toMatch(/^shot-/);
  });
});

describe("a model that cannot see pictures", () => {
  it("gets the conversation with each picture said in words instead", async () => {
    const { withoutImages } = await import("./providers/openrouter");
    const out = withoutImages([
      { role: "user", content: "Look", images: ["data:image/jpeg;base64,AAAA"] },
      { role: "assistant", content: "ok" },
    ]);
    expect(out[0]).toEqual({
      role: "user",
      content: expect.stringContaining("1 picture(s) left out"),
    });
    expect("images" in out[0]).toBe(false);
    expect(out[1]).toEqual({ role: "assistant", content: "ok" });
  });
});
