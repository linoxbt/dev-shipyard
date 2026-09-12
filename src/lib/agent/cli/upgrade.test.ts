import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockProvider } from "../providers";
import { VERSION } from "./args";
import type { CommandContext, Terminal } from "./commands";
import {
  PACKAGE,
  compareVersions,
  installMethod,
  notifyIfOutdated,
  targetFor,
  upgradeCommand,
} from "./upgrade";

// Staying current: knowing how it was installed, and doing the matching thing.

const dirs: string[] = [];
function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), "upgrade-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function terminal() {
  const out: string[] = [];
  const err: string[] = [];
  const t: Terminal = {
    out: (s) => out.push(s),
    err: (s) => err.push(s),
    ask: async () => "",
    colour: false,
  };
  return { t, text: () => out.join("\n"), errors: () => err.join("\n") };
}
function context(t: Terminal): CommandContext {
  return { root: scratch(), terminal: t, provider: new MockProvider([]) };
}

const NEWER = "99.0.0";
function registry(version: string, extra: Record<string, Response> = {}): typeof fetch {
  return (async (url: string) => {
    if (String(url).includes("registry.npmjs.org")) return Response.json({ version });
    for (const [suffix, res] of Object.entries(extra))
      if (String(url).endsWith(suffix)) return res.clone();
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("how it was installed", () => {
  it("recognises an npm install by its platform binary", () => {
    expect(
      installMethod(`/usr/local/lib/node_modules/${PACKAGE}/scripts/devstation-linux-x64`, ""),
    ).toBe("npm");
  });
  it("recognises an npm install running the bundle through Bun", () => {
    expect(
      installMethod("/root/.bun/bin/bun", `/usr/lib/node_modules/${PACKAGE}/devstation.js`),
    ).toBe("npm");
  });
  it("recognises a source checkout", () => {
    expect(installMethod("/root/.bun/bin/bun", "/src/lib/agent/cli/index.ts")).toBe("source");
  });
  it("treats anything else as a standalone binary", () => {
    expect(installMethod("/root/.devstation/bin/devstation", "/$bunfs/root/devstation")).toBe(
      "binary",
    );
  });
});

describe("comparing versions", () => {
  it("compares numerically, not as text", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBe(1);
    expect(compareVersions("0.1.2", "0.1.2")).toBe(0);
    expect(compareVersions("0.1.2", "1.0.0")).toBe(-1);
  });
});

describe("devstation upgrade", () => {
  it("says so when already current, and changes nothing", async () => {
    const term = terminal();
    let ran = false;
    const code = await upgradeCommand(context(term.t), {
      fetchImpl: registry(VERSION),
      execPath: `/x/node_modules/${PACKAGE}/scripts/devstation-linux-x64`,
      run: () => {
        ran = true;
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(term.text()).toContain("is the latest version");
    expect(ran).toBe(false);
  });

  it("only reports with --check", async () => {
    const term = terminal();
    let ran = false;
    await upgradeCommand(context(term.t), {
      check: true,
      fetchImpl: registry(NEWER),
      execPath: `/x/node_modules/${PACKAGE}/scripts/devstation-linux-x64`,
      run: () => {
        ran = true;
        return 0;
      },
    });
    expect(term.text()).toContain(`${NEWER} is available`);
    expect(ran).toBe(false);
  });

  it("upgrades an npm install through npm, pinned to the version it found", async () => {
    const term = terminal();
    const calls: string[][] = [];
    const code = await upgradeCommand(context(term.t), {
      fetchImpl: registry(NEWER),
      execPath: `/x/node_modules/${PACKAGE}/scripts/devstation-linux-x64`,
      run: (cmd, args) => {
        calls.push([cmd, ...args]);
        return 0;
      },
    });
    expect(code).toBe(0);
    expect(calls).toEqual([["npm", "install", "-g", `${PACKAGE}@${NEWER}`]]);
  });

  it("replaces a standalone binary with a verified download", async () => {
    const target = targetFor();
    if (!target || process.platform === "win32") return;
    const dir = scratch();
    const exec = join(dir, "devstation");
    writeFileSync(exec, "old binary");
    const body = "new binary";
    const sum = createHash("sha256").update(body).digest("hex");

    const term = terminal();
    const code = await upgradeCommand(context(term.t), {
      execPath: exec,
      script: "/$bunfs/root/devstation",
      fetchImpl: registry(NEWER, {
        "/SHA256SUMS": new Response(`${sum}  ${target}\n`),
        [`/${target}`]: new Response(body),
      }),
    });
    expect(code).toBe(0);
    expect(readFileSync(exec, "utf8")).toBe(body);
    expect(statSync(exec).mode & 0o111).not.toBe(0);
    expect(existsSync(`${exec}.partial`)).toBe(false);
  });

  it("leaves the installed binary alone when the checksum does not match", async () => {
    const target = targetFor();
    if (!target || process.platform === "win32") return;
    const dir = scratch();
    const exec = join(dir, "devstation");
    writeFileSync(exec, "old binary");

    const term = terminal();
    const code = await upgradeCommand(context(term.t), {
      execPath: exec,
      script: "/$bunfs/root/devstation",
      fetchImpl: registry(NEWER, {
        "/SHA256SUMS": new Response(`${"0".repeat(64)}  ${target}\n`),
        [`/${target}`]: new Response("tampered"),
      }),
    });
    expect(code).toBe(1);
    expect(readFileSync(exec, "utf8")).toBe("old binary");
    expect(term.errors()).toContain("left untouched");
  });
});

describe("the update notice", () => {
  it("prints from the cache when a newer version is known", async () => {
    const home = scratch();
    mkdirSync(join(home, ".devstation"), { recursive: true });
    writeFileSync(
      join(home, ".devstation", "update-check.json"),
      JSON.stringify({ checkedAt: Date.now(), latest: NEWER }),
    );
    const term = terminal();
    await notifyIfOutdated(term.t, { home, env: {}, fetchImpl: registry(NEWER) });
    expect(term.errors()).toContain("devstation upgrade");
  });

  it("says nothing when current", async () => {
    const home = scratch();
    const term = terminal();
    await notifyIfOutdated(term.t, { home, env: {}, fetchImpl: registry(VERSION) });
    expect(term.errors()).toBe("");
  });

  it("refreshes a stale cache without printing a stale answer as fresh", async () => {
    const home = scratch();
    const term = terminal();
    await notifyIfOutdated(term.t, { home, env: {}, now: 1_000, fetchImpl: registry(NEWER) });
    const cache = JSON.parse(readFileSync(join(home, ".devstation", "update-check.json"), "utf8"));
    expect(cache.latest).toBe(NEWER);
    expect(cache.checkedAt).toBe(1_000);
  });

  it("stays silent and offline in CI or when turned off", async () => {
    const home = scratch();
    let fetched = false;
    const spy = (async () => {
      fetched = true;
      return Response.json({ version: NEWER });
    }) as unknown as typeof fetch;
    const term = terminal();
    await notifyIfOutdated(term.t, { home, env: { CI: "true" }, fetchImpl: spy });
    await notifyIfOutdated(term.t, {
      home,
      env: { DEVSTATION_NO_UPDATE_CHECK: "1" },
      fetchImpl: spy,
    });
    expect(fetched).toBe(false);
    expect(term.errors()).toBe("");
  });
});
