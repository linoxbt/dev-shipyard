import { create } from "zustand";
import type { ChatMessage } from "@/lib/ai";

// Persistent, multi-session chat history for the AI assistant. Survives reload
// and is shared across the editor panel and the standalone "Code with AI" page.
//
// SSR-safe via an explicit hydrate(): the store starts empty (matching the
// server-rendered HTML) and loads from localStorage in a mount effect, so the
// first client render matches SSR and there's no hydration mismatch.

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  updatedAt: number;
}

const STORAGE_KEY = "devstation-ai-chats-v1";
const MAX_SESSIONS = 30;
const NEW_TITLE = "New chat";

function hasWindow() {
  return typeof window !== "undefined" && typeof localStorage !== "undefined";
}

function uid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function freshSession(): ChatSession {
  return { id: uid(), title: NEW_TITLE, messages: [], updatedAt: Date.now() };
}

function load(): { sessions: ChatSession[]; activeId: string | null } {
  if (!hasWindow()) return { sessions: [], activeId: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { sessions: [], activeId: null };
    const parsed = JSON.parse(raw) as { sessions?: ChatSession[]; activeId?: string | null };
    return { sessions: parsed.sessions ?? [], activeId: parsed.activeId ?? null };
  } catch {
    return { sessions: [], activeId: null };
  }
}

function persist(sessions: ChatSession[], activeId: string | null) {
  if (!hasWindow()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ sessions, activeId }));
  } catch {
    /* ignore quota errors */
  }
}

interface ChatStore {
  hydrated: boolean;
  sessions: ChatSession[];
  activeId: string | null;
  hydrate: () => void;
  newSession: () => string;
  setActive: (id: string) => void;
  deleteSession: (id: string) => void;
  // Update one session's messages by id (not "active") so an in-flight stream
  // keeps writing to its own session even if the user switches away.
  setSessionMessages: (id: string, updater: (m: ChatMessage[]) => ChatMessage[]) => void;
}

export const useAiChatStore = create<ChatStore>((set, get) => ({
  hydrated: false,
  sessions: [],
  activeId: null,

  hydrate: () => {
    if (get().hydrated) return;
    const { sessions, activeId } = load();
    let next = sessions;
    let active = activeId;
    if (!next.length) {
      const s = freshSession();
      next = [s];
      active = s.id;
    } else if (!active || !next.some((s) => s.id === active)) {
      active = next[0].id;
    }
    persist(next, active);
    set({ sessions: next, activeId: active, hydrated: true });
  },

  newSession: () => {
    const s = freshSession();
    const sessions = [s, ...get().sessions].slice(0, MAX_SESSIONS);
    persist(sessions, s.id);
    set({ sessions, activeId: s.id });
    return s.id;
  },

  setActive: (id) => {
    if (!get().sessions.some((s) => s.id === id)) return;
    persist(get().sessions, id);
    set({ activeId: id });
  },

  deleteSession: (id) => {
    let remaining = get().sessions.filter((s) => s.id !== id);
    let active = get().activeId;
    if (active === id) active = remaining[0]?.id ?? null;
    if (!remaining.length) {
      const s = freshSession();
      remaining = [s];
      active = s.id;
    }
    persist(remaining, active);
    set({ sessions: remaining, activeId: active });
  },

  setSessionMessages: (id, updater) => {
    const sessions = get().sessions.map((sess) => {
      if (sess.id !== id) return sess;
      const messages = updater(sess.messages);
      let title = sess.title;
      if (title === NEW_TITLE) {
        const firstUser = messages.find((m) => m.role === "user");
        if (firstUser) {
          const t = firstUser.content.replace(/\s+/g, " ").trim().slice(0, 48);
          if (t) title = t;
        }
      }
      return { ...sess, messages, title, updatedAt: Date.now() };
    });
    persist(sessions, get().activeId);
    set({ sessions });
  },
}));
