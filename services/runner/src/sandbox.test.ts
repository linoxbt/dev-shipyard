import { afterAll, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  stripAnsi,
  createContainer,
  destroyContainer,
  dockerAvailable,
  getDir,
  putFiles,
  runPhase,
} from "./sandbox";
import { packTar, unpackTar } from "./tar";

// The timeouts here are generous because the sandbox is genuinely slow: under
// gVisor a warm install measured 138s against 43s under runc, and every phase
// carries 1.4-3.2x. Sized for runc, three of these failed at exactly their
// declared limit the moment gVisor was switched on: a timeout, not a defect.
//
// These drive real Docker, so they are slow and they are skipped when there is
// no daemon (CI without a socket, a laptop with Docker stopped). They are worth
// the seconds they cost: the isolation claims in ARCHITECTURE.md are the reason
// this service is allowed to run model-written code at all, and an untested
// security control is a wish. Every failure fixed here: the network that could
// not be attached, the workspace that could not execute: passed a typecheck,
// a lint and a review first, and was only ever visible by running it.

const IMAGE = process.env.RUNNER_IMAGE ?? "devstation-runner:3";
const hasDocker = await dockerAvailable();
const imageExists =
  hasDocker &&
  (() => {
    try {
      execFileSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

const containers: string[] = [];
async function container(): Promise<string> {
  const name = `devstation-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  containers.push(name);
  await createContainer(IMAGE, name);
  return name;
}

// Sweep anything a previous run left behind. afterAll does not fire when a run
// is killed or times out, and eight stale containers from an earlier aborted
// run were still sitting on this host hours later. Cleaning up on the way IN
// makes the suite self-healing rather than relying on it always exiting
// cleanly.
function sweepStaleContainers() {
  try {
    const out = execFileSync("docker", ["ps", "-aq", "--filter", "name=devstation-test-"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) execFileSync("docker", ["rm", "-f", ...out.split("\n")], { stdio: "ignore" });
  } catch {
    // Best effort: a failed sweep must not fail the suite.
  }
}
if (imageExists) sweepStaleContainers();

afterAll(async () => {
  await Promise.all(containers.map(destroyContainer));
  sweepStaleContainers();
});

const when = imageExists ? describe : describe.skip;

when("sandbox", () => {
  it("gives install the network and takes it away again afterwards", async () => {
    // The single most important property here. `install` needs a registry,
    // so it gets the bridge; everything after it: the build, the tests,
    // anything the model wrote: must not be able to reach anything.
    const probe = [
      "const net=require('net');",
      "const s=net.connect(443,'104.16.0.35');",
      "s.setTimeout(8000);",
      // The markers are split so the source cannot spell them: npm echoes the
      // build script before running it, and a whole word in there satisfies the
      // assertions without anything having been executed.
      "s.on('connect',()=>{console.log('REA'+'CHED');process.exit(0)});",
      "s.on('timeout',()=>{console.log('BLOC'+'KED timeout');process.exit(0)});",
      "s.on('error',e=>{console.log('BLOC'+'KED '+e.code);process.exit(0)});",
    ].join("");
    const name = await container();
    await putFiles(
      name,
      packTar({
        "package.json": JSON.stringify({
          name: "netprobe",
          private: true,
          version: "0.0.0",
          // A real dependency, so a passing install proves the registry was
          // actually reachable rather than that npm had nothing to do.
          dependencies: { "is-odd": "3.0.1" },
          scripts: { build: `node -e "${probe}"` },
        }),
      }),
    );

    const install = await runPhase(name, "install");
    expect(install.ok).toBe(true);
    expect(install.log).toContain("added");

    const build = await runPhase(name, "build");
    expect(build.ok).toBe(true);
    expect(build.log).toContain("BLOCKED");
    expect(build.log).not.toContain("REACHED");
  }, 300_000);

  it("can execute a binary from the workspace", async () => {
    // Docker mounts every tmpfs noexec unless told otherwise, and the
    // workspace holds node_modules/.bin as well as anything a postinstall
    // downloads and then runs. When this regresses, npm fails inside a
    // postinstall with a bare EACCES that never mentions the mount.
    const name = await container();
    await putFiles(
      name,
      packTar({
        "run.sh": "#!/bin/sh\necho executed-from-workspace\n",
        "package.json": JSON.stringify({
          name: "execprobe",
          private: true,
          version: "0.0.0",
          scripts: { build: "chmod +x ./run.sh && ./run.sh" },
        }),
      }),
    );
    await runPhase(name, "install");
    const build = await runPhase(name, "build");
    expect(build.log).toContain("executed-from-workspace");
    expect(build.ok).toBe(true);
  }, 300_000);

  it("returns the built directory", async () => {
    const name = await container();
    await putFiles(
      name,
      packTar({
        "package.json": JSON.stringify({
          name: "outbox",
          private: true,
          version: "0.0.0",
          scripts: { build: "mkdir -p dist && echo hello > dist/index.html" },
        }),
      }),
    );
    await runPhase(name, "install");
    const build = await runPhase(name, "build");
    expect(build.ok).toBe(true);

    const tar = await getDir(name, "dist");
    expect(tar).not.toBeNull();
    const entries = [...unpackTar(tar!)];
    expect(entries.map((e) => e.path)).toContain("dist/index.html");
  }, 300_000);

  it("kills a phase that runs past its deadline", async () => {
    const name = await container();
    await putFiles(
      name,
      packTar({
        "package.json": JSON.stringify({
          name: "spinner",
          private: true,
          version: "0.0.0",
          scripts: { build: "while true; do :; done" },
        }),
      }),
    );
    await runPhase(name, "install");
    const build = await runPhase(name, "build");
    expect(build.ok).toBe(false);
    expect(build.timedOut).toBe(true);
  }, 480_000);

  it("runs as a non-root user on a read-only root filesystem", async () => {
    const name = await container();
    await putFiles(
      name,
      packTar({
        "package.json": JSON.stringify({
          name: "perms",
          private: true,
          version: "0.0.0",
          scripts: {
            build: "id -u; touch /etc/should-not-write 2>&1 || echo 'root fs read-only'",
          },
        }),
      }),
    );
    await runPhase(name, "install");
    const build = await runPhase(name, "build");
    expect(build.log).toContain("1000");
    expect(build.log).toContain("root fs read-only");
  }, 300_000);
});

describe("stripAnsi", () => {
  it("removes the colour codes npm and vite emit even under CI", () => {
    // Every consumer of this output is something other than a terminal: a JSON
    // API, a model reading an error, and an HTML page where these render as
    // mojibake.
    const raw = "\u001b[36mvite v7.1.5\u001b[39m \u001b[32mbuilding\u001b[39m";
    expect(stripAnsi(raw)).toBe("vite v7.1.5 building");
  });

  it("leaves ordinary text alone", () => {
    expect(stripAnsi("added 2 packages, and removed 187 packages in 20s")).toBe(
      "added 2 packages, and removed 187 packages in 20s",
    );
  });

  it("handles an empty string", () => {
    expect(stripAnsi("")).toBe("");
  });
});
