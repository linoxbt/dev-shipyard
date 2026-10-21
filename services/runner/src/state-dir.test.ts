import { describe, expect, it } from "bun:test";
import { DEFAULT_STATE_DIR, stateDir } from "./state-dir";
import { accountsFile } from "./accounts";
import { activityFile } from "./activity";
import { listingsDir } from "./listings";

describe("one state directory", () => {
  it("prefers RUNNER_STATE_DIR, then STATE_DIRECTORY, then the default", () => {
    expect(stateDir({})).toBe(DEFAULT_STATE_DIR);
    expect(stateDir({ STATE_DIRECTORY: "/s" })).toBe("/s");
    expect(stateDir({ RUNNER_STATE_DIR: "/r", STATE_DIRECTORY: "/s" })).toBe("/r");
  });

  it("puts accounts, activity and listings where jobs and history go", () => {
    const env = { RUNNER_STATE_DIR: "/r" };
    expect(accountsFile(env)).toBe("/r/accounts.json");
    expect(activityFile(env)).toBe("/r/marketplace-activity.json");
    expect(listingsDir(env)).toBe("/r/listings");
  });
});
