import { create } from "zustand";
import type { Template } from "@/lib/data/templates";

// A developer's own contract templates, persisted in this browser.
//
// NOT a marketplace, and the UI must not imply otherwise. Nothing here is
// shared with anyone: a template saved on one machine is invisible on another
// and to every other user. The wallet recorded against a template is an author
// label, not an access control: the data lives in the user's own localStorage,
// where they can edit it freely, so the ownership check in the UI is a
// convenience and nothing more.
//
// Making this genuinely shared needs somewhere shared to put it: an onchain
// template registry (the pattern ProjectRegistry already uses) or a backend.
// Both are real work and a deployment decision, not a relabelling.
//
// SSR starts empty and hydrate() loads from localStorage on mount, so there is
// no hydration mismatch.

const STORAGE_KEY = "devstation-user-templates-v1";

function hasWindow() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function load(): Template[] {
  if (!hasWindow()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Template[]) : [];
  } catch {
    return [];
  }
}

function persist(list: Template[]) {
  if (!hasWindow()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* ignore quota errors */
  }
}

interface UserTemplatesStore {
  hydrated: boolean;
  templates: Template[];
  hydrate: () => void;
  add: (t: Template) => void;
  update: (id: string, patch: Partial<Template>) => void;
  remove: (id: string) => void;
}

export const useUserTemplates = create<UserTemplatesStore>((set, get) => ({
  hydrated: false,
  templates: [],
  hydrate: () => {
    if (get().hydrated) return;
    set({ templates: load(), hydrated: true });
  },
  add: (t) => {
    const next = [t, ...get().templates.filter((x) => x.id !== t.id)];
    persist(next);
    set({ templates: next });
  },
  update: (id, patch) => {
    const next = get().templates.map((t) => (t.id === id ? { ...t, ...patch } : t));
    persist(next);
    set({ templates: next });
  },
  remove: (id) => {
    const next = get().templates.filter((t) => t.id !== id);
    persist(next);
    set({ templates: next });
  },
}));

// Non-reactive lookup for loaders/route components.
export function getUserTemplate(id: string): Template | undefined {
  return useUserTemplates.getState().templates.find((t) => t.id === id);
}
