import { create } from "zustand";
import type { Template } from "@/lib/mock/templates";

// Community-submitted contract templates, persisted in the browser. SSR starts
// empty and hydrate() loads from localStorage on mount (no hydration mismatch).
// Only the submitting wallet may edit a template (enforced in the UI).

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
