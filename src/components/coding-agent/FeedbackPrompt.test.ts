import { describe, expect, it } from "bun:test";
import type { AppProject } from "@/lib/appgen/projects";
import { builtSomething } from "./FeedbackPrompt";

const project = (patch: Partial<AppProject>): AppProject => ({
  id: "p",
  name: "App",
  createdAt: 0,
  updatedAt: 0,
  files: {},
  history: [],
  turns: [],
  ...patch,
});

describe("when feedback is asked for", () => {
  it("waits until the agent has built something, or something is published", () => {
    expect(builtSomething([project({})])).toBeNull();
    expect(
      builtSomething([project({ turns: [{ role: "assistant", text: "Hi!" } as never] })]),
    ).toBeNull();
    // A turn that failed is not something built.
    expect(
      builtSomething([
        project({
          turns: [{ role: "assistant", text: "x", failed: true, changed: ["a.ts"] } as never],
        }),
      ]),
    ).toBeNull();
    const built = project({
      id: "b",
      updatedAt: 5,
      turns: [{ role: "assistant", text: "Done", changed: ["index.html"] } as never],
    });
    const live = project({ id: "l", updatedAt: 1, liveUrl: "https://x.devstation.online" });
    expect(builtSomething([built])?.id).toBe("b");
    // A published app is the one worth asking about.
    expect(builtSomething([built, live])?.id).toBe("l");
  });
});
