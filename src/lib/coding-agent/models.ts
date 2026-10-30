// The models the Coding Agent can run on, as offered in its model picker.
//
// One list for the page, the API (which refuses anything not on it) and the
// runner (which turns a choice into a provider). A model runs through the
// runner's Anthropic key when it has a native Anthropic name and that key is
// set, through Fortytwo when it is one of Fortytwo's, and through OpenRouter
// otherwise. "Auto" is no choice at all: the runner's own default.

export type ModelFamily = "anthropic" | "openai" | "google" | "qwen";

export interface AgentModel {
  id: string;
  label: string;
  family: ModelFamily;
  /** Listed under "More models". */
  more?: boolean;
  /** The model's name on Anthropic's own API, when it has one. */
  anthropic?: string;
  /** The model's name on OpenRouter. */
  openrouter?: string;
  /** The model's name on Fortytwo (docs.fortytwo.network), which serves it
   *  with the runner's FORTYTWO_API_KEY. */
  fortytwo?: string;
}

export const AGENT_MODELS: readonly AgentModel[] = [
  {
    id: "opus-5.5",
    label: "Opus 5.5",
    family: "anthropic",
    anthropic: "claude-opus-5-5",
    openrouter: "anthropic/claude-opus-5.5",
  },
  {
    id: "sonnet-5.5",
    label: "Sonnet 5.5",
    family: "anthropic",
    anthropic: "claude-sonnet-5-5",
    openrouter: "anthropic/claude-sonnet-5.5",
  },
  { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", family: "openai", openrouter: "openai/gpt-6.1-sol" },
  {
    id: "qwen-3.8-27b",
    label: "Qwen 3.8 27B",
    family: "qwen",
    fortytwo: "qwen/qwen3.8-27b",
  },
  {
    id: "gemini-4-argon",
    label: "Gemini 4 Argon",
    family: "google",
    openrouter: "google/gemini-4-argon",
  },
  {
    id: "gpt-6.1-terra",
    label: "GPT-6.1 Terra",
    family: "openai",
    more: true,
    openrouter: "openai/gpt-6.1-terra",
  },
  {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    family: "openai",
    more: true,
    openrouter: "openai/gpt-5.6-terra",
  },
  {
    id: "gpt-6-astra",
    label: "GPT 6 Astra",
    family: "openai",
    more: true,
    openrouter: "openai/gpt-6-astra",
  },
  {
    id: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    family: "google",
    more: true,
    openrouter: "google/gemini-3.8-flash",
  },
  {
    id: "fable-5.1",
    label: "Fable 5.1",
    family: "anthropic",
    more: true,
    anthropic: "claude-fable-5-1",
    openrouter: "anthropic/claude-fable-5.1",
  },
  {
    id: "haiku-5.5",
    label: "Haiku 5.5",
    family: "anthropic",
    more: true,
    anthropic: "claude-haiku-5-5",
    openrouter: "anthropic/claude-haiku-5.5",
  },
];

export const AUTO_MODEL = "auto";
export type ModelChoice = typeof AUTO_MODEL | (typeof AGENT_MODELS)[number]["id"];

export const MODEL_IDS: readonly string[] = AGENT_MODELS.map((m) => m.id);

export function findModel(id: string | null | undefined): AgentModel | null {
  return AGENT_MODELS.find((m) => m.id === id) ?? null;
}

export function modelLabel(id: string | null | undefined): string {
  return findModel(id)?.label ?? "Auto";
}

/** How the agent works on a message. */
export type AgentMode = "build" | "plan";

export const MODES: readonly { id: AgentMode; label: string; blurb: string }[] = [
  { id: "build", label: "Build", blurb: "Start building immediately" },
  { id: "plan", label: "Plan", blurb: "Create a plan before building" },
];
