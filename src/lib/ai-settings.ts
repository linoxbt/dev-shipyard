import { create } from "zustand";

// Runtime AI configuration. Endpoints + model lists for each provider are
// hardcoded here; the user picks a provider, picks a model, pastes their API
// key, and saves. Choices persist to localStorage so they survive refresh /
// browser sessions until the user clears their cache. SSR-safe.

export type AiProvider = "openai" | "anthropic" | "openrouter" | "freemodel";

export interface ProviderPreset {
  id: AiProvider;
  label: string;
  /** "anthropic" uses the native Messages API; others are OpenAI-compatible. */
  kind: "anthropic" | "openai";
  endpoint: string;
  models: string[];
  keyPlaceholder: string;
  keyHint?: string;
}

// Hardcoded provider presets. Endpoints are fixed; the user only supplies a key.
export const AI_PROVIDERS: Record<AiProvider, ProviderPreset> = {
  openai: {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    endpoint: "https://api.openai.com/v1/chat/completions",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "o4-mini"],
    keyPlaceholder: "sk-...",
    keyHint: "platform.openai.com/api-keys",
  },
  anthropic: {
    id: "anthropic",
    label: "Claude (Anthropic)",
    kind: "anthropic",
    endpoint: "https://api.anthropic.com",
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"],
    keyPlaceholder: "sk-ant-...",
    keyHint: "console.anthropic.com/settings/keys",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    models: [
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet",
      "google/gemini-2.0-flash-001",
      "meta-llama/llama-3.3-70b-instruct",
      "deepseek/deepseek-chat",
    ],
    keyPlaceholder: "sk-or-v1-...",
    keyHint: "openrouter.ai/keys",
  },
  freemodel: {
    id: "freemodel",
    label: "FreeModel",
    // FreeModel's Claude surface (cc.freemodel.dev) is gated to the Claude Code
    // CLI and can't be called from a web app, so DevStation uses FreeModel's
    // OpenAI-compatible surface, which serves the gpt-5.x line.
    kind: "openai",
    endpoint: "https://api.freemodel.dev/v1/chat/completions",
    models: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"],
    keyPlaceholder: "fe_oa_... (FreeModel API key)",
    keyHint: "freemodel.dev",
  },
};

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
    provider: "openai",
    model: AI_PROVIDERS.openai.models[0],
    keys: {},
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
      saved.model && preset.models.includes(saved.model) ? saved.model : preset.models[0];
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
    return { ...base, provider, model: AI_PROVIDERS[provider].models[0], keys };
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
  reset: () => void;
}

export const useAiSettings = create<AiSettingsStore>((set, get) => ({
  ...load(),
  // Switching provider snaps the model to that provider's first option unless
  // the current model is valid for it.
  setProvider: (p) => {
    const preset = AI_PROVIDERS[p];
    const model = preset.models.includes(get().model) ? get().model : preset.models[0];
    const next = { ...get(), provider: p, model };
    save(next);
    set({ provider: p, model });
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
