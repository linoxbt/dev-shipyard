import { describe, expect, it } from "bun:test";
import { repoNameFrom } from "./github";

// GitHub rejects repo names with spaces, and a project name like "nova swap"
// is exactly what the App Builder produces from a prompt.
describe("repoNameFrom", () => {
  it("turns a prompt-derived project name into a valid repo name", () => {
    expect(repoNameFrom("nova swap")).toBe("nova-swap");
    expect(repoNameFrom("Tip Jar with a QIE amount input")).toBe("tip-jar-with-a-qie-amount-input");
  });

  it("strips characters GitHub will not accept", () => {
    expect(repoNameFrom("My App! (v2)")).toBe("my-app-v2");
    expect(repoNameFrom("  spaced  out  ")).toBe("spaced-out");
  });

  it("never returns a name that starts or ends with a separator", () => {
    for (const raw of ["--edge--", "...dots...", "-", "!!!"]) {
      const out = repoNameFrom(raw);
      expect(out.startsWith("-")).toBe(false);
      expect(out.endsWith("-")).toBe(false);
      expect(out.startsWith(".")).toBe(false);
      expect(out.length).toBeGreaterThan(0);
    }
  });

  it("falls back rather than producing an empty name", () => {
    expect(repoNameFrom("")).toBe("devstation-app");
    expect(repoNameFrom("!!!")).toBe("devstation-app");
  });

  it("stays within GitHub's length limit", () => {
    expect(repoNameFrom("a".repeat(200)).length).toBeLessThanOrEqual(90);
  });
});
