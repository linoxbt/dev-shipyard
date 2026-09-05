import { create } from "zustand";

// Runtime AI configuration. Endpoints + model lists for each provider are
// hardcoded here; the user picks a provider, picks a model, pastes their API
// key, and saves. Choices persist to localStorage so they survive refresh /
// browser sessions until the user clears their cache. SSR-safe.

export type AiProvider = "openrouter" | "openai" | "anthropic" | "freemodel";

/**
 * One selectable model. `vendor` groups the dropdown (OpenRouter's catalogue
 * spans several vendors under a single key), and `note` is the short
 * "why pick this one" hint shown beside the name.
 */
export interface AiModel {
  id: string;
  label: string;
  vendor: string;
  note?: string;
}

export interface ProviderPreset {
  id: AiProvider;
  label: string;
  /** "anthropic" uses the native Messages API; others are OpenAI-compatible. */
  kind: "anthropic" | "openai";
  endpoint: string;
  models: AiModel[];
  keyPlaceholder: string;
  keyHint?: string;
  /** Shown under the provider picker in Settings. */
  blurb?: string;
}

/** Convenience for the single-vendor presets, whose vendor == the provider. */
const m = (vendor: string, id: string, label: string, note?: string): AiModel => ({
  id,
  label,
  vendor,
  note,
});

// Hardcoded provider presets. Endpoints are fixed; the user only supplies a key.
//
// OpenRouter is the default and the one most people should use: a single
// OpenRouter key reaches every model below, so you can switch between Claude,
// GPT, DeepSeek, Gemini, Grok and Qwen without managing five separate
// accounts. The other presets exist for anyone who'd rather talk to a vendor
// directly with that vendor's own key.
//
// Model ids and prices were read from OpenRouter's live catalogue
// (GET https://openrouter.ai/api/v1/models). Prices are USD per 1M tokens as
// input/output and are indicative only: OpenRouter is the source of truth.
export const AI_PROVIDERS: Record<AiProvider, ProviderPreset> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    blurb: "One key, every model below.",
    models: [
      // --- Anthropic ---
      m("Anthropic", "anthropic/claude-opus-5", "Claude Opus 5", "$5/$25 · flagship, 1M ctx"),
      m("Anthropic", "anthropic/claude-sonnet-5", "Claude Sonnet 5", "$2/$10 · fast + capable"),
      m("Anthropic", "anthropic/claude-fable-5", "Claude Fable 5", "$10/$50 · most capable"),
      m("Anthropic", "anthropic/claude-opus-4.8", "Claude Opus 4.8", "$5/$25 · previous flagship"),
      m("Anthropic", "anthropic/claude-haiku-4.5", "Claude Haiku 4.5", "$1/$5 · cheapest Claude"),
      // --- OpenAI ---
      m("OpenAI", "openai/gpt-5.6-sol", "GPT-5.6 Sol", "$2/$10 · general purpose"),
      m("OpenAI", "openai/gpt-5.6-terra", "GPT-5.6 Terra", "$2/$12 · reasoning-leaning"),
      m("OpenAI", "openai/gpt-5.6-luna", "GPT-5.6 Luna", "$0.20/$1.20 · cheapest GPT-5.6"),
      m("OpenAI", "openai/gpt-5.5", "GPT-5.5", "$5/$30 · previous flagship"),
      m("OpenAI", "openai/gpt-5.4-mini", "GPT-5.4 Mini", "$0.75/$4.50 · budget"),
      // --- DeepSeek ---
      m("DeepSeek", "deepseek/deepseek-v4-pro", "DeepSeek V4 Pro", "$0.87/$1.74 · strong value"),
      m(
        "DeepSeek",
        "deepseek/deepseek-v4-flash",
        "DeepSeek V4 Flash",
        "$0.08/$0.16 · cheapest here",
      ),
      // --- Everyone else ---
      m("Google", "google/gemini-3.7-flash", "Gemini 3.7 Flash", "$0.38/$1.88 · fast, 1M ctx"),
      m("xAI", "x-ai/grok-4.6", "Grok 4.6", "$2/$6 · 500K ctx"),
      m("Qwen", "qwen/qwen3.8-max", "Qwen3.8 Max", "$2/$6 · 1M ctx"),
    ],
    keyPlaceholder: "sk-or-v1-...",
    keyHint: "openrouter.ai/keys",
  },
  openai: {
    id: "openai",
    label: "OpenAI direct",
    kind: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    blurb: "Your own OpenAI key.",
    models: [
      m("OpenAI", "gpt-5.6-sol", "GPT-5.6 Sol"),
      m("OpenAI", "gpt-5.6-terra", "GPT-5.6 Terra"),
      m("OpenAI", "gpt-5.6-luna", "GPT-5.6 Luna", "cheapest"),
      m("OpenAI", "gpt-5.5", "GPT-5.5"),
      m("OpenAI", "gpt-5.4-mini", "GPT-5.4 Mini", "budget"),
    ],
    keyPlaceholder: "sk-...",
    keyHint: "platform.openai.com/api-keys",
  },
  anthropic: {
    id: "anthropic",
    label: "Claude direct",
    kind: "anthropic",
    endpoint: "https://api.anthropic.com",
    blurb: "Your own Anthropic key.",
    models: [
      m("Anthropic", "claude-opus-5", "Claude Opus 5", "flagship"),
      m("Anthropic", "claude-sonnet-5", "Claude Sonnet 5", "fast + capable"),
      m("Anthropic", "claude-fable-5", "Claude Fable 5", "most capable"),
      m("Anthropic", "claude-opus-4-8", "Claude Opus 4.8"),
      m("Anthropic", "claude-haiku-4-5", "Claude Haiku 4.5", "cheapest"),
    ],
    keyPlaceholder: "sk-ant-...",
    keyHint: "console.anthropic.com/settings/keys",
  },
  freemodel: {
    id: "freemodel",
    label: "FreeModel",
    // FreeModel's Claude surface (cc.freemodel.dev) is gated to the Claude Code
    // CLI and can't be called from a web app, so DevStation uses FreeModel's
    // OpenAI-compatible surface, which serves the gpt-5.x line.
    kind: "openai",
    endpoint: "https://api.freemodel.dev/v1/chat/completions",
    models: [
      m("FreeModel", "gpt-5.5", "GPT-5.5"),
      m("FreeModel", "gpt-5.4", "GPT-5.4"),
      m("FreeModel", "gpt-5.4-mini", "GPT-5.4 Mini"),
      m("FreeModel", "gpt-5.3-codex", "GPT-5.3 Codex"),
    ],
    keyPlaceholder: "fe_oa_... (FreeModel API key)",
    keyHint: "freemodel.dev",
  },
};

/** Model ids for a preset, in declaration order. */
export function modelIds(p: ProviderPreset): string[] {
  return p.models.map((x) => x.id);
}

/** Preset models grouped by vendor, preserving declaration order. */
export function modelsByVendor(p: ProviderPreset): Array<{ vendor: string; models: AiModel[] }> {
  const groups: Array<{ vendor: string; models: AiModel[] }> = [];
  for (const model of p.models) {
    const last = groups[groups.length - 1];
    if (last && last.vendor === model.vendor) last.models.push(model);
    else groups.push({ vendor: model.vendor, models: [model] });
  }
  return groups;
}

// Effective endpoint + API kind for the current settings. Kept as a helper so
// call sites stay uniform if a provider ever needs per-model routing.
export function resolveEndpoint(s: AiSettings = getAiSettings()): {
  endpoint: string;
  kind: "anthropic" | "openai";
} {
  const preset = AI_PROVIDERS[s.provider];
  return { endpoint: preset.endpoint, kind: preset.kind };
}

export const AI_PROVIDER_LIST = Object.values(AI_PROVIDERS);

export interface AiSettings {
  provider: AiProvider;
  /** Selected model id for the active provider. */
  model: string;
  /** Per-provider API keys (so switching providers keeps each key). */
  keys: Partial<Record<AiProvider, string>>;
  /** Route through the app's /api/ai server proxy (operator-controlled). */
  proxy: boolean;
}

const STORAGE_KEY = "devstation-ai-settings-v2";
const env = import.meta.env;

function defaults(): AiSettings {
  return {
    // OpenRouter is the default: one key reaches every model in its catalogue,
    // so the out-of-the-box path doesn't need a per-vendor account.
    provider: "openrouter",
    model: AI_PROVIDERS.openrouter.models[0].id,
    keys: {},
    // Default to the operator-provided server proxy when the deployment opts in
    // with VITE_AI_PROXY=true (set alongside the server key, e.g. an OpenRouter
    // key in the host env). Users can switch to their own key in Settings.
    proxy: (env.VITE_AI_PROXY as string | undefined) === "true",
  };
}

function load(): AiSettings {
  const base = defaults();
  if (typeof window === "undefined" || typeof localStorage === "undefined") return base;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // One-time migration from the old v1 settings shape (single key/model).
      return migrateV1() ?? base;
    }
    const saved = JSON.parse(raw) as Partial<AiSettings>;
    const provider =
      saved.provider && AI_PROVIDERS[saved.provider] ? saved.provider : base.provider;
    const preset = AI_PROVIDERS[provider];
    const model =
      saved.model && modelIds(preset).includes(saved.model) ? saved.model : preset.models[0].id;
    return { ...base, ...saved, provider, model, keys: saved.keys ?? {} };
  } catch {
    return base;
  }
}

// Best-effort import of the previous (v1) settings so users keep their key.
function migrateV1(): AiSettings | null {
  try {
    const raw = localStorage.getItem("devstation-ai-settings-v1");
    if (!raw) return null;
    const old = JSON.parse(raw) as {
      provider?: string;
      openaiApiKey?: string;
      anthropicApiKey?: string;
      openaiEndpoint?: string;
    };
    const base = defaults();
    const keys: AiSettings["keys"] = {};
    // Map an OpenRouter endpoint to the openrouter preset; else plain openai.
    if (old.openaiApiKey) {
      if (old.openaiEndpoint?.includes("openrouter")) keys.openrouter = old.openaiApiKey;
      else keys.openai = old.openaiApiKey;
    }
    if (old.anthropicApiKey) keys.anthropic = old.anthropicApiKey;
    const provider: AiProvider =
      old.provider === "anthropic"
        ? "anthropic"
        : old.openaiEndpoint?.includes("openrouter")
          ? "openrouter"
          : "openai";
    return { ...base, provider, model: AI_PROVIDERS[provider].models[0].id, keys };
  } catch {
    return null;
  }
}

function save(s: AiSettings) {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota errors */
  }
}

interface AiSettingsStore extends AiSettings {
  setProvider: (p: AiProvider) => void;
  setModel: (m: string) => void;
  setKey: (key: string) => void;
  setProxy: (on: boolean) => void;
  reset: () => void;
}

export const useAiSettings = create<AiSettingsStore>((set, get) => ({
  ...load(),
  // Switching provider snaps the model to that provider's first option unless
  // the current model is valid for it.
  setProvider: (p) => {
    const preset = AI_PROVIDERS[p];
    const model = modelIds(preset).includes(get().model) ? get().model : preset.models[0].id;
    const next = { ...get(), provider: p, model };
    save(next);
    set({ provider: p, model });
  },
  // Toggle between the operator-provided server proxy (default) and a personal
  // bring-your-own-key. Persisted so the choice survives refresh.
  setProxy: (on) => {
    const next = { ...get(), proxy: on };
    save(next);
    set({ proxy: on });
  },
  setModel: (m) => {
    const next = { ...get(), model: m };
    save(next);
    set({ model: m });
  },
  setKey: (key) => {
    const keys = { ...get().keys, [get().provider]: key };
    const next = { ...get(), keys };
    save(next);
    set({ keys });
  },
  reset: () => {
    const d = defaults();
    save(d);
    set(d);
  },
}));

// Non-reactive snapshot for the chat client (not a React component).
export function getAiSettings(): AiSettings {
  return useAiSettings.getState();
}

export function activeKey(s: AiSettings = getAiSettings()): string {
  return s.keys[s.provider] ?? "";
}

export function isAiConfigured(): boolean {
  const s = getAiSettings();
  if (s.proxy) return true; // server proxy holds the key
  return !!activeKey(s);
}
