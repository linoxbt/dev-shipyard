import { create } from "zustand";

// Runtime AI configuration: which provider to use and the per-provider
// endpoint/key/model. Seeded from public env vars so a deployment can ship a
// default, then overridable in the UI and persisted to localStorage so the
// choice survives a refresh. SSR-safe — every storage access guards `window`.

export type AiProvider = "anthropic" | "openai";

export interface AiSettings {
  provider: AiProvider;
  // When true, route requests through this app's server proxy (/api/ai) so the
  // key stays server-side. Operator-controlled via VITE_AI_PROXY — not a user
  // toggle, since it requires matching server-only env.
  proxy: boolean;
  // Anthropic (native Messages API)
  anthropicEndpoint: string;
  anthropicApiKey: string;
  anthropicModel: string;
  // OpenAI-compatible (/chat/completions)
  openaiEndpoint: string;
  openaiApiKey: string;
  openaiModel: string;
}

const STORAGE_KEY = "devstation-ai-settings-v1";

const env = import.meta.env;

// Env defaults. VITE_AI_* are the original OpenAI-compatible vars (kept for
// back-compat); VITE_ANTHROPIC_* configure the Claude path.
function envDefaults(): AiSettings {
  const hasAnthropic = !!(env.VITE_ANTHROPIC_API_KEY as string | undefined);
  const hasOpenAI = !!(env.VITE_AI_API_KEY as string | undefined);
  const provider =
    (env.VITE_AI_PROVIDER as AiProvider | undefined) ??
    // Prefer whichever is configured; tie-break to Anthropic.
    (hasAnthropic ? "anthropic" : hasOpenAI ? "openai" : "anthropic");

  return {
    provider,
    proxy: (env.VITE_AI_PROXY as string | undefined) === "true",
    anthropicEndpoint:
      (env.VITE_ANTHROPIC_ENDPOINT as string | undefined) || "https://api.anthropic.com",
    anthropicApiKey: (env.VITE_ANTHROPIC_API_KEY as string | undefined) || "",
    anthropicModel: (env.VITE_ANTHROPIC_MODEL as string | undefined) || "claude-opus-4-8",
    openaiEndpoint: (env.VITE_AI_ENDPOINT as string | undefined) || "",
    openaiApiKey: (env.VITE_AI_API_KEY as string | undefined) || "",
    openaiModel: (env.VITE_AI_MODEL as string | undefined) || "gpt-4o-mini",
  };
}

function load(): AiSettings {
  const defaults = envDefaults();
  if (typeof window === "undefined" || typeof localStorage === "undefined") return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    // Merge so newly-added fields fall back to env defaults.
    return { ...defaults, ...(JSON.parse(raw) as Partial<AiSettings>) };
  } catch {
    return defaults;
  }
}

function save(s: AiSettings) {
  if (typeof window === "undefined" || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* ignore quota/serialization errors */
  }
}

interface AiSettingsStore extends AiSettings {
  update: (patch: Partial<AiSettings>) => void;
  reset: () => void;
}

export const useAiSettings = create<AiSettingsStore>((set, get) => ({
  ...load(),
  update: (patch) => {
    const next = { ...get(), ...patch };
    save(next);
    set(patch);
  },
  reset: () => {
    const defaults = envDefaults();
    save(defaults);
    set(defaults);
  },
}));

// Non-reactive snapshot for the chat client (which isn't a React component).
export function getAiSettings(): AiSettings {
  return useAiSettings.getState();
}

export function isAiConfigured(): boolean {
  const s = getAiSettings();
  // The server proxy holds the key; the client doesn't need one.
  if (s.proxy) return true;
  return s.provider === "anthropic" ? !!s.anthropicApiKey : !!s.openaiEndpoint && !!s.openaiApiKey;
}
