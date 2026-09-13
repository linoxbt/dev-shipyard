import { describe, expect, it } from "bun:test";
import { containerGone } from "./sandbox-exec";

// A session's container can die under it: killed for memory by a large
// `forge install`, or stopped at its time limit. Before this was recognised,
// every later command failed with "No such container" and the session could
// not run anything again.

describe("a sandbox container that has died", () => {
  it("is recognised from docker's own words", () => {
    expect(
      containerGone({
        code: 1,
        stderr: "Error response from daemon: No such container: devstation-agent-cbe5b5466d",
      }),
    ).toBe(true);
    expect(
      containerGone({
        code: 1,
        stderr: "Error response from daemon: container abc123 is not running",
      }),
    ).toBe(true);
  });

  it("is not confused with a command that simply failed", () => {
    expect(containerGone({ code: 1, stderr: "npm ERR! Missing script: build" })).toBe(false);
    expect(containerGone({ code: 137, stderr: "" })).toBe(false);
    expect(
      containerGone({ code: 2, stderr: "ls: cannot access 'x': No such file or directory" }),
    ).toBe(false);
  });
});
