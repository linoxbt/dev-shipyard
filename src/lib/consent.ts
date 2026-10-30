import { create } from "zustand";

// Cookie and storage consent.
//
// DevStation stores two kinds of things in the browser:
//
// - Essential: what the product cannot work without. The session cookie that
//   says you are signed in, the GitHub sign-in cookies while you connect, the
//   Supabase session, your projects (they live in this browser), and this
//   consent choice itself. Always on.
// - Preferences: things that only remember how you like it. The light or
//   dark theme, the model and mode you last picked, the chat's width, which
//   updates you have seen. On only if you accept them.
//
// There are no analytics, advertising or tracking cookies, from DevStation or
// anyone else. The policy page (routes/cookies.tsx) lists every item.

export const CONSENT_KEY = "devstation-consent";
const VERSION = 1;

/** Preference keys, cleared when preferences are refused. */
export const PREFERENCE_KEYS = [
  "devstation-theme",
  "devstation-agent-news-seen",
  "devstation-agent-model",
  "devstation-agent-mode",
  "devstation-sidebar-collapsed",
];
/** Prefixes of preference keys written by libraries (the split layout). */
const PREFERENCE_PREFIXES = ["react-resizable-panels:", "devstation-app-builder"];

export interface Consent {
  v: number;
  preferences: boolean;
  decidedAt: number;
}

function read(): Consent | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw) as Consent;
    return c?.v === VERSION && typeof c.preferences === "boolean" ? c : null;
  } catch {
    return null;
  }
}

/** Whether preference storage may be used. False until someone accepts. */
export function preferencesAllowed(): boolean {
  return read()?.preferences === true;
}

/** Read a preference; null when there is none or it may not be stored. */
export function getPreference(key: string): string | null {
  if (!preferencesAllowed()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Store a preference, only with consent. Without it the choice lasts for
 *  this visit, held in memory by whoever asked. */
export function setPreference(key: string, value: string): void {
  if (!preferencesAllowed()) return;
  try {
    localStorage.setItem(key, value);
  } catch {
    /* full or blocked: the choice just is not remembered */
  }
}

function clearPreferences() {
  try {
    for (const key of PREFERENCE_KEYS) localStorage.removeItem(key);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i) ?? "";
      if (PREFERENCE_PREFIXES.some((p) => key.startsWith(p))) localStorage.removeItem(key);
    }
  } catch {
    /* nothing to clear */
  }
}

interface ConsentState {
  /** null: not decided yet, so the banner shows. */
  consent: Consent | null;
  loaded: boolean;
  /** The preferences manager is open. */
  managing: boolean;
  load: () => void;
  decide: (preferences: boolean) => void;
  manage: (open: boolean) => void;
}

export const useConsent = create<ConsentState>((set) => ({
  consent: null,
  loaded: false,
  managing: false,
  load: () => set({ consent: read(), loaded: true }),
  decide: (preferences) => {
    const consent: Consent = { v: VERSION, preferences, decidedAt: Date.now() };
    try {
      localStorage.setItem(CONSENT_KEY, JSON.stringify(consent));
    } catch {
      /* the banner will ask again next visit */
    }
    if (!preferences) clearPreferences();
    set({ consent, managing: false });
  },
  manage: (open) => set({ managing: open }),
}));
