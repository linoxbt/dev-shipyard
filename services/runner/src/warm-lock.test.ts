import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The runner image installs the warm set with `npm ci`, which refuses to run
// when the lockfile and package.json disagree. Caught here rather than as a
// failed image build on the host.
describe("the warm install's lockfile", () => {
  it("matches warm-package.json exactly", () => {
    const dir = join(import.meta.dir, "..");
    const pkg = JSON.parse(readFileSync(join(dir, "warm-package.json"), "utf8"));
    const lock = JSON.parse(readFileSync(join(dir, "warm-package-lock.json"), "utf8"));
    const root = lock.packages[""];
    expect(root.dependencies).toEqual(pkg.dependencies);
    expect(root.devDependencies).toEqual(pkg.devDependencies);
  });
});
