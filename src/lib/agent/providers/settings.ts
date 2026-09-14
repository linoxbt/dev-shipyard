import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

// Where a run gets its model from, when nobody exported anything.
//
// Until this existed the only way to configure DevStation was an environment
// variable, which is fine for a server and tedious for a person: every new
// shell needed the key again, and there was nowhere to say "use this endpoint"
// at all. Claude Code and Codex both keep a settings file and a separate
// credentials store; this is the same shape.
//
// Two files, on purpose. config.json says WHICH model and WHERE, and is safe to
// read, share and check into a project. credentials.json holds the keys, lives
// only in the home directory, and is written readable by its owner alone. A
// project config that could carry a key is a key that ends up in git.

export type ProviderId = "anthropic" | "openrouter" | "openai";
export const PROVIDER_IDS: readonly ProviderId[] = ["anthropic", "openrouter", "openai"];

export interface Settings {
  provider?: ProviderId;
  model?: string;
  /** An OpenAI-compatible endpoint, or an Anthropic-compatible one for that
   *  provider. The path up to, not including, `/chat/completions`. */
  baseUrl?: string;
  /** "off" runs commands on this machine, with its logins and tools, instead
   *  of in a container. Only a flag or DEVSTATION_SANDBOX overrides it. */
  sandbox?: "on" | "off";
}

/** The keys `config set` accepts. apiKey is deliberately absent: see login. */
export const SETTING_KEYS = ["provider", "model", "baseUrl", "sandbox"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export type Credentials = Partial<Record<ProviderId, string>>;

/** Environment variables that carry a key, per provider, in priority order.
 *  AI_API_KEY stays an OpenRouter alias because the runner already uses it. */
export const KEY_ENV: Record<ProviderId, readonly string[]> = {
  anthropic: ["ANTHROPIC_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY", "AI_API_KEY"],
  openai: ["OPENAI_API_KEY"],
};

export const DEFAULT_BASE_URL: Record<ProviderId, string> = {
  anthropic: "https://api.anthropic.com",
  openrouter: "https://openrouter.ai/api/v1",
  openai: "https://api.openai.com/v1",
};

export function globalDir(home: string): string {
  return join(home, ".devstation");
}
export function globalConfigPath(home: string): string {
  return join(globalDir(home), "config.json");
}
export function projectConfigPath(root: string): string {
  return join(root, ".devstation", "config.json");
}
export function credentialsPath(home: string): string {
  return join(globalDir(home), "credentials.json");
}

function isProvider(value: unknown): value is ProviderId {
  return typeof value === "string" && (PROVIDER_IDS as readonly string[]).includes(value);
}

/** A settings file, tolerating one that is missing or malformed. A broken file
 *  disables that file, not the agent, and says so through `problems`. */
export function readSettingsFile(path: string, problems: string[] = []): Settings {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const out: Settings = {};
    if (raw.provider !== undefined) {
      const named = typeof raw.provider === "string" ? raw.provider.toLowerCase() : raw.provider;
      if (isProvider(named)) out.provider = named;
      else problems.push(`${path}: unknown provider "${String(raw.provider)}".`);
    }
    if (typeof raw.model === "string" && raw.model.trim()) out.model = raw.model.trim();
    if (typeof raw.baseUrl === "string" && raw.baseUrl.trim()) {
      out.baseUrl = raw.baseUrl.trim().replace(/\/+$/, "");
    }
    if (raw.sandbox !== undefined) {
      const choice = typeof raw.sandbox === "string" ? raw.sandbox.toLowerCase() : raw.sandbox;
      if (choice === "on" || choice === "off") out.sandbox = choice;
      else problems.push(`${path}: sandbox must be "on" or "off", not "${String(raw.sandbox)}".`);
    }
    // A key here would be a key in whatever this file gets committed with.
    if ("apiKey" in raw) {
      problems.push(
        `${path} contains "apiKey", which is ignored. Keys belong in ${"~/.devstation/credentials.json"}: run \`devstation login\`.`,
      );
    }
    return out;
  } catch {
    problems.push(`${path} is not valid JSON, so it was ignored.`);
    return {};
  }
}

/** Written beside the target and renamed, so a crash cannot leave half a file. */
function writeJson(path: string, value: unknown, mode: number) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const partial = `${path}.partial`;
  writeFileSync(partial, `${JSON.stringify(value, null, 2)}\n`, { mode });
  chmodSync(partial, mode);
  renameSync(partial, path);
}

export function writeSettingsFile(path: string, settings: Settings): void {
  const clean: Settings = {};
  for (const key of SETTING_KEYS) {
    if (settings[key] !== undefined && settings[key] !== "") {
      (clean as Record<string, unknown>)[key] = settings[key];
    }
  }
  writeJson(path, clean, 0o644);
}

export function readCredentials(home: string, problems: string[] = []): Credentials {
  const path = credentialsPath(home);
  if (!existsSync(path)) return {};
  try {
    // Looser than owner-only means someone else on the machine can read the
    // keys. Worth saying rather than silently using them.
    // Not on Windows: NTFS has no Unix modes, so every file reports 666 and
    // chmod cannot change it. Access there is governed by the user profile.
    const mode = statSync(path).mode & 0o777;
    if (process.platform !== "win32" && mode & 0o077) {
      problems.push(
        `${path} is readable by other users (mode ${mode.toString(8)}). Fix it: chmod 600 ${path}`,
      );
    }
    const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const out: Credentials = {};
    for (const id of PROVIDER_IDS) {
      if (typeof raw[id] === "string" && (raw[id] as string).trim())
        out[id] = (raw[id] as string).trim();
    }
    return out;
  } catch {
    problems.push(`${path} is not valid JSON, so no stored keys were read.`);
    return {};
  }
}

/** Always owner-only, whatever the umask, and the directory too. */
export function writeCredentials(home: string, credentials: Credentials): void {
  mkdirSync(globalDir(home), { recursive: true, mode: 0o700 });
  chmodSync(globalDir(home), 0o700);
  writeJson(credentialsPath(home), credentials, 0o600);
}

export interface Resolved {
  provider: ProviderId | null;
  /** Null means "let the provider pick its default". */
  model: string | null;
  baseUrl: string | null;
  apiKey: string | null;
  /** The saved sandbox choice, project first, or null when none is saved. */
  sandbox: "on" | "off" | null;
  /** Where each value came from, in words a person can act on. */
  source: { provider: string; model: string; baseUrl: string; apiKey: string };
  /** Why nothing can run, when nothing can. */
  problem: string | null;
  /** Things worth fixing that did not stop anything. */
  warnings: string[];
}

export interface ResolveOptions {
  root: string;
  env?: NodeJS.ProcessEnv;
  /** Defaults to env.HOME. Empty string disables the home directory entirely,
   *  which is what a server that must behave exactly as before wants. */
  home?: string;
  /** --model on the command line. */
  model?: string;
}

/**
 * Work out provider, model, endpoint and key, and say where each came from.
 *
 * Provider: DEVSTATION_PROVIDER, then the project config, then the global
 * config, and only then inferred from whichever key exists. A choice somebody
 * wrote down beats a key that happens to be in the environment for some other
 * tool: a machine with ANTHROPIC_API_KEY exported for something else must not
 * quietly override a config that says "use my local Ollama".
 *
 * With no config at all, inference is the old order -- Anthropic, then
 * OpenRouter -- so every machine that works on environment variables today
 * behaves identically.
 *
 * Key: the environment variable for the chosen provider, then the stored
 * credential. A key exported right now is the more deliberate of the two.
 */
export function resolveSettings(opts: ResolveOptions): Resolved {
  const env = opts.env ?? process.env;
  const home = opts.home ?? env.HOME ?? "";
  const warnings: string[] = [];

  const project = readSettingsFile(projectConfigPath(opts.root), warnings);
  const global = home ? readSettingsFile(globalConfigPath(home), warnings) : {};
  const stored = home ? readCredentials(home, warnings) : {};

  const projectLabel = ".devstation/config.json";
  const globalLabel = "~/.devstation/config.json";

  let provider: ProviderId | null = null;
  let providerSource = "not set";
  if (env.DEVSTATION_PROVIDER) {
    // "OpenAI" and "openai" are the same answer; refusing one was a papercut.
    const named = env.DEVSTATION_PROVIDER.toLowerCase();
    if (isProvider(named)) {
      provider = named;
      providerSource = "DEVSTATION_PROVIDER";
    } else {
      warnings.push(
        `DEVSTATION_PROVIDER="${env.DEVSTATION_PROVIDER}" is not a provider, so it was ignored.`,
      );
    }
  }
  if (!provider && project.provider) {
    provider = project.provider;
    providerSource = projectLabel;
  }
  if (!provider && global.provider) {
    provider = global.provider;
    providerSource = globalLabel;
  }
  if (!provider) {
    for (const id of ["anthropic", "openrouter", "openai"] as const) {
      const hit = KEY_ENV[id].find((name) => env[name]);
      if (hit) {
        provider = id;
        providerSource = `inferred from ${hit}`;
        break;
      }
    }
  }
  if (!provider) {
    const only = PROVIDER_IDS.filter((id) => stored[id]);
    if (only.length >= 1) {
      provider = only[0];
      providerSource = "inferred from ~/.devstation/credentials.json";
    }
  }

  let model: string | null = null;
  let modelSource = "provider default";
  if (opts.model) {
    model = opts.model;
    modelSource = "--model";
  } else if (env.DEVSTATION_MODEL) {
    model = env.DEVSTATION_MODEL;
    modelSource = "DEVSTATION_MODEL";
  } else if (project.model) {
    model = project.model;
    modelSource = projectLabel;
  } else if (global.model) {
    model = global.model;
    modelSource = globalLabel;
  }

  let baseUrl: string | null = null;
  let baseUrlSource = "provider default";
  if (env.DEVSTATION_BASE_URL) {
    baseUrl = env.DEVSTATION_BASE_URL.replace(/\/+$/, "");
    baseUrlSource = "DEVSTATION_BASE_URL";
  } else if (project.baseUrl) {
    baseUrl = project.baseUrl;
    baseUrlSource = projectLabel;
  } else if (global.baseUrl) {
    baseUrl = global.baseUrl;
    baseUrlSource = globalLabel;
  }

  let apiKey: string | null = null;
  let keySource = "none";
  if (provider) {
    const hit = KEY_ENV[provider].find((name) => env[name]);
    if (hit) {
      apiKey = env[hit] as string;
      keySource = hit;
    } else if (stored[provider]) {
      apiKey = stored[provider] as string;
      keySource = "~/.devstation/credentials.json";
    }
  }

  let problem: string | null = null;
  if (!provider) {
    problem =
      "No model provider is configured. Run `devstation login`, or set ANTHROPIC_API_KEY or OPENROUTER_API_KEY.";
  } else if (!apiKey && provider !== "openai") {
    problem = `No API key for ${provider}. Run \`devstation login ${provider}\`, or set ${KEY_ENV[provider][0]}.`;
  } else if (provider === "openai" && !apiKey && !baseUrl) {
    // A local server (Ollama, LM Studio) needs no key, but it does need saying
    // where it is: the default endpoint is api.openai.com, which does.
    problem =
      "No API key for openai. Run `devstation login openai`, set OPENAI_API_KEY, or point baseUrl at a local server that needs none.";
  } else if (provider === "openai" && !model) {
    problem =
      "The openai provider needs a model name, because every compatible server names them differently. Run `devstation config set model <name>`.";
  }

  return {
    provider,
    model,
    baseUrl,
    apiKey,
    sandbox: project.sandbox ?? global.sandbox ?? null,
    source: {
      provider: providerSource,
      model: modelSource,
      baseUrl: baseUrlSource,
      apiKey: keySource,
    },
    problem,
    warnings,
  };
}

/** Never print a key. Enough to tell two apart. */
export function maskKey(key: string | null): string {
  if (!key) return "none";
  if (key.length <= 8) return "set";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
