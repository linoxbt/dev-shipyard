import { afterEach, describe, expect, it } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  credentialsPath,
  globalConfigPath,
  maskKey,
  projectConfigPath,
  readCredentials,
  resolveSettings,
  writeCredentials,
  writeSettingsFile,
} from "./settings";
import { providerFromSettings } from "./index";

// Where a run gets its model when nobody exported anything.

const dirs: string[] = [];
function scratch(): { home: string; root: string } {
  const base = mkdtempSync(join(tmpdir(), "settings-"));
  dirs.push(base);
  const home = join(base, "home");
  const root = join(base, "project");
  mkdirSync(home, { recursive: true });
  mkdirSync(root, { recursive: true });
  return { home, root };
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("with no settings files at all", () => {
  it("behaves exactly as the environment-only path did", () => {
    // Every machine that works on exported keys today must keep working the
    // same way, including the Anthropic-first order.
    const { home, root } = scratch();
    const both = resolveSettings({
      root,
      home,
      env: { ANTHROPIC_API_KEY: "a", OPENROUTER_API_KEY: "o" },
    });
    expect(both.provider).toBe("anthropic");
    expect(both.apiKey).toBe("a");
    expect(both.problem).toBeNull();

    const one = resolveSettings({ root, home, env: { AI_API_KEY: "o" } });
    expect(one.provider).toBe("openrouter");
    expect(one.source.apiKey).toBe("AI_API_KEY");
  });

  it("says how to fix it when nothing is configured", () => {
    const { home, root } = scratch();
    const r = resolveSettings({ root, home, env: {} });
    expect(r.provider).toBeNull();
    expect(r.problem).toContain("devstation login");
    expect(providerFromSettings(r)).toBeNull();
  });
});

describe("the settings files", () => {
  it("uses a stored key and the global config, with no environment at all", () => {
    const { home, root } = scratch();
    writeSettingsFile(globalConfigPath(home), { provider: "openrouter", model: "x/y" });
    writeCredentials(home, { openrouter: "sk-or-stored" });

    const r = resolveSettings({ root, home, env: {} });
    expect(r.provider).toBe("openrouter");
    expect(r.model).toBe("x/y");
    expect(r.apiKey).toBe("sk-or-stored");
    expect(r.source.apiKey).toContain("credentials.json");
    expect(providerFromSettings(r)?.name).toBe("openrouter");
  });

  it("lets a project override the global model", () => {
    const { home, root } = scratch();
    writeSettingsFile(globalConfigPath(home), { provider: "openrouter", model: "global/model" });
    writeSettingsFile(projectConfigPath(root), { model: "project/model" });
    writeCredentials(home, { openrouter: "k" });

    const r = resolveSettings({ root, home, env: {} });
    expect(r.model).toBe("project/model");
    expect(r.source.model).toBe(".devstation/config.json");
  });

  it("lets --model beat every file and variable", () => {
    const { home, root } = scratch();
    writeSettingsFile(projectConfigPath(root), { model: "project/model" });
    const r = resolveSettings({
      root,
      home,
      env: { OPENROUTER_API_KEY: "k", DEVSTATION_MODEL: "env/model" },
      model: "flag/model",
    });
    expect(r.model).toBe("flag/model");
    expect(r.source.model).toBe("--model");
  });

  it("does not let an unrelated exported key override a provider somebody chose", () => {
    // A machine with ANTHROPIC_API_KEY exported for some other tool must not
    // silently ignore a config that says "use my local Ollama".
    const { home, root } = scratch();
    writeSettingsFile(globalConfigPath(home), {
      provider: "openai",
      model: "llama3.3",
      baseUrl: "http://localhost:11434/v1",
    });
    const r = resolveSettings({ root, home, env: { ANTHROPIC_API_KEY: "unrelated" } });
    expect(r.provider).toBe("openai");
    expect(r.apiKey).toBeNull();
    expect(r.problem).toBeNull();

    const provider = providerFromSettings(r);
    expect(provider?.name).toBe("openai");
    expect(provider?.model).toBe("llama3.3");
  });

  it("prefers a key exported for the chosen provider over a stored one", () => {
    const { home, root } = scratch();
    writeSettingsFile(globalConfigPath(home), { provider: "anthropic" });
    writeCredentials(home, { anthropic: "stored" });
    const r = resolveSettings({ root, home, env: { ANTHROPIC_API_KEY: "exported" } });
    expect(r.apiKey).toBe("exported");
    expect(r.source.apiKey).toBe("ANTHROPIC_API_KEY");
  });

  it("refuses an openai setup with no model, and says why", () => {
    const { home, root } = scratch();
    writeSettingsFile(globalConfigPath(home), { provider: "openai" });
    writeCredentials(home, { openai: "sk-x" });
    const r = resolveSettings({ root, home, env: {} });
    expect(r.problem).toContain("model name");
  });

  it("survives a malformed file and says which one", () => {
    const { home, root } = scratch();
    mkdirSync(join(root, ".devstation"), { recursive: true });
    writeFileSync(projectConfigPath(root), "{ not json");
    const r = resolveSettings({ root, home, env: { OPENROUTER_API_KEY: "k" } });
    expect(r.provider).toBe("openrouter");
    expect(r.warnings.join(" ")).toContain("not valid JSON");
  });

  it("ignores a key put in a config file, and warns", () => {
    // config.json is the file people share and commit. A key there is a key
    // in git, so it is refused rather than used.
    const { home, root } = scratch();
    mkdirSync(join(home, ".devstation"), { recursive: true });
    writeFileSync(
      globalConfigPath(home),
      JSON.stringify({ provider: "openrouter", apiKey: "leaked" }),
    );
    const r = resolveSettings({ root, home, env: {} });
    expect(r.apiKey).toBeNull();
    expect(r.warnings.join(" ")).toContain("apiKey");
  });

  it("can ignore the home directory entirely, for a server", () => {
    const { home, root } = scratch();
    writeSettingsFile(globalConfigPath(home), {
      provider: "openai",
      model: "m",
      baseUrl: "http://x",
    });
    const r = resolveSettings({ root, home: "", env: { OPENROUTER_API_KEY: "k" } });
    expect(r.provider).toBe("openrouter");
  });
});

describe("the credentials file", () => {
  it("is readable only by its owner, and so is its directory", () => {
    const { home } = scratch();
    writeCredentials(home, { openrouter: "sk-or-secret" });
    expect(statSync(credentialsPath(home)).mode & 0o777).toBe(0o600);
    expect(statSync(join(home, ".devstation")).mode & 0o777).toBe(0o700);
    expect(readCredentials(home).openrouter).toBe("sk-or-secret");
  });

  it("warns when someone else could read it", () => {
    const { home, root } = scratch();
    writeCredentials(home, { openrouter: "k" });
    // Loosened by hand, the way a careless copy does it.
    chmodSync(credentialsPath(home), 0o644);
    const r = resolveSettings({ root, home, env: {} });
    expect(r.warnings.join(" ")).toContain("chmod 600");
  });

  it("never shows a whole key", () => {
    expect(maskKey("sk-or-v1-0123456789abcdef")).toBe("sk-o…cdef");
    expect(maskKey("short")).toBe("set");
    expect(maskKey(null)).toBe("none");
  });
});
