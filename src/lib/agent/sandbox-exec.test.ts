import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  gatingEcosystems,
  workdirFor,
  createCommand,
  execCommand,
  explainExit,
  imageFor,
  readinessProblem,
  sandboxExecutor,
  sweepStale,
  timeoutScale,
  userFlag,
} from "./sandbox-exec";
import { hostExecutor } from "./executor";

// Split in two on purpose.
//
// The first half is pure and runs everywhere, including CI with no daemon. It
// is where the security-relevant flags are asserted, so a change to them shows
// up as a failing test in a diff rather than as a string nobody reads.
//
// The second half drives real Docker and skips when it is not there, following
// services/runner/src/sandbox.test.ts exactly.

describe("the flags, with no daemon needed", () => {
  const base = {
    name: "devstation-agent-test",
    session: "test",
    workspace: "/home/me/project",
    image: "devstation-sandbox:1",
    runtime: "runsc",
    lifetimeSeconds: 1800,
    memory: "4g",
    cpus: "2.0",
    pidsLimit: 512,
    user: "1000:1000",
  };

  it("drops every capability and forbids gaining more", () => {
    const command = createCommand({ ...base, network: false });
    expect(command).toContain("--cap-drop ALL");
    expect(command).toContain("--security-opt no-new-privileges");
    expect(command).toContain("--read-only");
  });

  it("seals the network unless asked", () => {
    expect(createCommand({ ...base, network: false })).toContain("--network none");
    expect(createCommand({ ...base, network: true })).toContain("--network bridge");
  });

  it("caps memory, cpu and processes, with no swap to escape into", () => {
    const command = createCommand({ ...base, network: false });
    expect(command).toContain("--memory '4g'");
    expect(command).toContain("--memory-swap '4g'");
    expect(command).toContain("--pids-limit 512");
  });

  it("reaps zombies, which a bare sleep as PID 1 would not", () => {
    expect(createCommand({ ...base, network: false })).toContain("--init");
  });

  it("mounts the workspace read-write and nothing else", () => {
    const command = createCommand({ ...base, network: false });
    expect(command).toContain("--volume '/home/me/project:/work:rw'");
    // The one line that would turn this into a more complicated way of being
    // root on the host.
    expect(command).not.toContain("docker.sock");
  });

  it("carries its own deadline, so a dead agent does not leak a container", () => {
    expect(createCommand({ ...base, network: false })).toContain("sleep 1800");
  });

  it("labels the container so a killed run can be swept up", () => {
    expect(createCommand({ ...base, network: false })).toContain("devstation.agent=1");
  });

  it("quotes a workspace path with a space in it", () => {
    const command = createCommand({ ...base, network: false, workspace: "/home/me/my project" });
    expect(command).toContain("'/home/me/my project:/work:rw'");
  });
});

describe("passing a command in without splicing it", () => {
  it("hands the command over as an environment variable", () => {
    // Splicing a model-supplied string into a second shell string is exactly
    // how the git tool ended up with an injection hole. This file is supposed
    // to be the thing that contains a command, not another way to run one.
    const command = execCommand("c", "npm test", 300);
    expect(command).toContain("--env 'DEVSTATION_CMD=npm test'");
    expect(command).toContain('"$DEVSTATION_CMD"');
  });

  it("survives a command full of quotes and metacharacters", () => {
    const nasty = `echo 'it'\\''s'; rm -rf / & $(whoami) \`id\``;
    const command = execCommand("c", nasty, 60);
    // Everything dangerous ends up inside one quoted argument rather than
    // becoming syntax of the outer command.
    expect(command.split("--env ")[1]).toContain("DEVSTATION_CMD=");
    expect(command).toContain("sh -c 'timeout --kill-after=5s 60s sh -c \"$DEVSTATION_CMD\"'");
  });

  it("gives the command a deadline inside the container", () => {
    // The host-side kill cannot reach a process inside a container: killing the
    // docker exec client leaves it running and makes timedOut a lie.
    expect(execCommand("c", "sleep 99", 30)).toContain("timeout --kill-after=5s 30s");
  });
});

describe("where inside the container a command runs", () => {
  it("runs at the workspace root when that is the cwd", () => {
    expect(workdirFor("/home/me/project", "/home/me/project")).toBe("/work");
  });

  it("maps a subdirectory, which is what a monorepo needs", () => {
    // The orchestrator passes the manifest's directory for run_tests and
    // run_build. Everything used to run at /work regardless, so a project with
    // its package.json in apps/web had its tests run from the repository root.
    expect(workdirFor("/home/me/project", "/home/me/project/apps/web")).toBe("/work/apps/web");
  });

  it("refuses a cwd outside the workspace rather than running somewhere else", () => {
    // The silence is the bug. The benchmark harness built a sandbox around the
    // wrong directory and every task ran its commands against the DevStation
    // repository, with nothing said about it.
    expect(workdirFor("/home/me/project", "/etc")).toBeNull();
    expect(workdirFor("/home/me/project", "/home/me/other")).toBeNull();
  });

  it("puts the mapped directory in the exec command, quoted", () => {
    expect(execCommand("c", "npm test", 60, "/work/apps/web")).toContain(
      "--workdir '/work/apps/web'",
    );
  });
});

describe("timeouts under a user-space kernel", () => {
  it("widens them for gVisor and leaves them alone otherwise", () => {
    expect(timeoutScale("runsc")).toBeGreaterThan(1);
    expect(timeoutScale("runc")).toBe(1);
  });
});

describe("exit codes that are not the command's fault", () => {
  it("explains a timeout and an out-of-memory kill", () => {
    expect(explainExit(124, "4g")).toContain("time limit");
    expect(explainExit(137, "4g")).toContain("ran out of memory");
    expect(explainExit(137, "4g")).toContain("4g");
  });

  it("says nothing about an ordinary failure", () => {
    // A failing test must still read as a failing test.
    expect(explainExit(1, "4g")).toBeNull();
    expect(explainExit(0, "4g")).toBeNull();
    expect(explainExit(null, "4g")).toBeNull();
  });
});

describe("what to do when the sandbox cannot start", () => {
  const base = { runtimeName: "runsc", imageName: "devstation-sandbox:1" };

  it("names the fix rather than only the problem", () => {
    expect(readinessProblem({ ...base, docker: false, runtime: false, image: false })).toContain(
      "--no-sandbox",
    );
    expect(readinessProblem({ ...base, docker: true, runtime: false, image: false })).toContain(
      "gVisor",
    );
    expect(readinessProblem({ ...base, docker: true, runtime: true, image: false })).toContain(
      "sandbox:image",
    );
  });

  it("is silent when everything is there", () => {
    expect(readinessProblem({ ...base, docker: true, runtime: true, image: true })).toBeNull();
  });
});

// --- the half that needs a daemon ------------------------------------------

const IMAGE = imageFor();
const hasDocker = (() => {
  try {
    execFileSync("docker", ["version", "--format", "{{.Server.Version}}"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const hasImage =
  hasDocker &&
  (() => {
    try {
      execFileSync("docker", ["image", "inspect", IMAGE], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  })();

const when = hasImage ? describe : describe.skip;

when("a real container", () => {
  const dirs: string[] = [];
  function workspace(): string {
    const root = mkdtempSync(join(tmpdir(), "sbx-"));
    dirs.push(root);
    return root;
  }
  afterEach(async () => {
    await sweepStale();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("writes into the workspace as the host user", async () => {
    // The scariest failure in the feature. Wrong ownership makes the host's git
    // report dubious ownership, breaks checkpoint(), and silently stops undo
    // working, which is the safety net people turned the sandbox on for.
    const root = workspace();
    const exec = sandboxExecutor({ workspace: root });
    try {
      const result = await exec.run("echo made-inside > from-container.txt", { cwd: root });
      expect(result.ok).toBe(true);

      const path = join(root, "from-container.txt");
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).uid).toBe(process.getuid!());
    } finally {
      await exec.dispose();
    }
  }, 180_000);

  it("cannot reach the host filesystem", async () => {
    // Asserting on /etc/shadow would prove nothing: that is the IMAGE's
    // /etc/shadow, and on a host running as root the container runs as root
    // too, so it reads fine and says nothing about isolation. What matters is
    // the mount namespace, so the test is a real host file outside the
    // workspace that the container must not be able to see.
    const outside = workspace();
    const secret = join(outside, "host-only-secret.txt");
    writeFileSync(secret, "this lives on the host and must stay there\n");

    const root = workspace();
    const exec = sandboxExecutor({ workspace: root });
    try {
      const read = await exec.run(`cat ${secret} 2>&1 || echo UNREACHABLE`, { cwd: root });
      expect(read.stdout).toContain("UNREACHABLE");
      expect(read.stdout).not.toContain("must stay there");

      // And the host's own home directory is not the container's.
      const home = await exec.run("ls -a $HOME", { cwd: root });
      expect(home.stdout).not.toContain(".ssh");
    } finally {
      await exec.dispose();
    }
  }, 180_000);

  it("does not carry the parent's environment in", async () => {
    process.env.DEVSTATION_SANDBOX_LEAK_PROBE = "must-not-appear-inside";
    const root = workspace();
    const exec = sandboxExecutor({ workspace: root });
    try {
      const result = await exec.run("printenv", { cwd: root });
      expect(result.stdout).not.toContain("must-not-appear-inside");
    } finally {
      delete process.env.DEVSTATION_SANDBOX_LEAK_PROBE;
      await exec.dispose();
    }
  }, 180_000);

  it("has no network when sealed", async () => {
    const root = workspace();
    const exec = sandboxExecutor({ workspace: root });
    try {
      // A raw address, so a DNS failure cannot be mistaken for the block
      // working, and split markers so echoing the command cannot satisfy it.
      const result = await exec.run(
        `node -e 'require("net").connect(443,"1.1.1.1")` +
          `.on("connect",()=>console.log("REA"+"CHED"))` +
          `.on("error",()=>console.log("BLOC"+"KED"))' || echo "BLOC""KED"`,
        { cwd: root, timeoutMs: 20_000 },
      );
      expect(result.stdout).toContain("BLOCKED");
      expect(result.stdout).not.toContain("REACHED");
    } finally {
      await exec.dispose();
    }
  }, 180_000);

  it("kills a command inside the container, not just the client", async () => {
    // The bug this exists for: killing the local docker exec leaves the process
    // running inside, holding cpu and the pids budget, and makes timedOut a lie.
    const root = workspace();
    const exec = sandboxExecutor({ workspace: root });
    try {
      const result = await exec.run("sleep 120", { cwd: root, timeoutMs: 3000 });
      expect(result.timedOut).toBe(true);
      expect(result.stderr).toContain("time limit");

      // And it is genuinely gone, not merely detached from us.
      const survivors = await exec.run("pgrep -f 'sleep 120' || echo NONE", { cwd: root });
      expect(survivors.stdout).toContain("NONE");
    } finally {
      await exec.dispose();
    }
  }, 240_000);

  it("keeps one container for the session", async () => {
    const root = workspace();
    const exec = sandboxExecutor({ workspace: root });
    try {
      await exec.run("echo first > /tmp/marker", { cwd: root });
      const second = await exec.run("cat /tmp/marker", { cwd: root });
      // /tmp is inside the container, so seeing it again proves reuse.
      expect(second.stdout.trim()).toBe("first");
    } finally {
      await exec.dispose();
    }
  }, 180_000);

  it("refuses a secrets file the same way the host executor does", async () => {
    const root = workspace();
    writeFileSync(join(root, ".env"), "PLAIN=visible-text\n");
    const exec = sandboxExecutor({ workspace: root });
    try {
      const result = await exec.run("cat .env", { cwd: root });
      expect(result.stderr).toContain("credentials file");
      expect(result.stdout).not.toContain("visible-text");
    } finally {
      await exec.dispose();
    }
  }, 180_000);

  it("returns the same shape the host executor does", async () => {
    const root = workspace();
    const exec = sandboxExecutor({ workspace: root });
    try {
      for (const command of ["echo hello", "exit 3"]) {
        const inside = await exec.run(command, { cwd: root });
        const outside = await hostExecutor().run(command, { cwd: root });
        expect(Object.keys(inside).sort()).toEqual(Object.keys(outside).sort());
        expect(inside.ok).toBe(outside.ok);
        expect(inside.code).toBe(outside.code);
      }
    } finally {
      await exec.dispose();
    }
  }, 240_000);

  it("cleans up after itself", async () => {
    const root = workspace();
    const exec = sandboxExecutor({ workspace: root });
    await exec.run("true", { cwd: root });
    await exec.dispose();

    const left = execFileSync("docker", [
      "ps",
      "-aq",
      "--filter",
      "label=devstation.agent=1",
    ]).toString();
    expect(left.trim()).toBe("");
  }, 180_000);

  it("says which user it is running as", () => {
    const exec = sandboxExecutor({ workspace: mkdtempSync(join(tmpdir(), "sbx-d-")) });
    expect(exec.describe).toContain(userFlag());
    expect(exec.kind).toBe("sandbox");
  });
});

describe("which toolchains the sandbox must carry", () => {
  it("counts only the project at the workspace root", () => {
    // Run from a home directory, the scan found npm, pip and cargo projects
    // belonging to other repositories, and one Rust folder among them refused
    // the whole session.
    expect(
      gatingEcosystems([
        { dir: "", ecosystem: "npm" },
        { dir: "some-other-repo", ecosystem: "cargo" },
        { dir: "fiscal", ecosystem: "pip" },
      ]),
    ).toEqual(["npm"]);
  });

  it("asks for nothing when there is no project at the root", () => {
    expect(gatingEcosystems([{ dir: "nested", ecosystem: "cargo" }])).toEqual([]);
  });
});
