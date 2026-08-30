// Named App Builder projects, and the memory that goes with them.
//
// Before this there was one unnamed workspace held in React state: starting a
// second app silently replaced the first, and a page refresh lost everything.
// You could not go back to something you built yesterday because there was no
// yesterday.
//
// A project carries its FILES and its CONVERSATION together, and that pairing
// is the point. Reopening one restores the code and the whole exchange that
// produced it, so the agent still knows what you asked for and why — without
// it, a reopened project is one where the agent has amnesia about everything
// except the code, which is precisely the failure this is meant to fix.
//
// Stored in localStorage, like the rest of DevStation's state. No database.

import { create } from "zustand";
import { z } from "zod";
import type { ChatMessage } from "@/lib/ai";

const STORAGE_KEY = "devstation-apps-v1";
/** Projects retained. Each carries files and a transcript, and localStorage is
 *  a handful of megabytes, so this is generous rather than tight. */
const MAX_PROJECTS = 40;

/** A rendered chat turn. Mirrors the builder's own Turn, kept here so stored
 *  data has a real shape rather than `unknown[]`. */
export interface ProjectTurn {
  role: "user" | "assistant";
  text: string;
  changed?: string[];
  failed?: boolean;
}

/** The contract an app is wired to, if any. */
export interface ProjectAttachment {
  address: string;
  chainId: number;
  name?: string | null;
  abi: unknown[];
}

export interface AppProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  files: Record<string, string>;
  history: ChatMessage[];
  /** Chat turns as rendered, so reopening shows the conversation as it looked
   *  rather than replaying raw model output. */
  turns: ProjectTurn[];
  /** The build output, so reopening a project shows the app immediately.
   *  Without it the preview is blank until you prompt again — and a Vite
   *  project cannot be previewed from source at all. */
  dist?: Record<string, string> | null;
  /** Where this app is published, so reopening it shows the live URL instead
   *  of making you publish again to find out. */
  liveUrl?: string | null;
  /** Contract the app was wired to, if any. */
  attached?: ProjectAttachment | null;
}

// Everything below is read back from localStorage, which is user-editable and
// carries data written by older versions of this code. Parsing it as trusted
// input meant a corrupt entry rendered straight into JSX — `t.changed.map(...)`
// on a non-array throws and white-screens the route. Anything that does not
// match is dropped rather than crashing the page.
const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  changed: z.array(z.string()).optional(),
  failed: z.boolean().optional(),
});

const messageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

const attachmentSchema = z.object({
  address: z.string(),
  chainId: z.number(),
  name: z.string().nullable().optional(),
  abi: z.array(z.unknown()),
});

const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  files: z.record(z.string(), z.string()).default({}),
  history: z.array(messageSchema).default([]),
  turns: z.array(turnSchema).default([]),
  dist: z.record(z.string(), z.string()).nullable().optional(),
  liveUrl: z.string().max(300).nullable().optional(),
  attached: attachmentSchema.nullable().optional(),
});

interface ProjectsState {
  projects: AppProject[];
  activeId: string | null;
  hydrated: boolean;
  /** Read localStorage. Called from an effect, never during render, so the
   *  server and the first client render agree. */
  hydrate: () => void;
  create: (name?: string) => string;
  open: (id: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  /** Persist the working state of the active project. */
  save: (patch: Partial<Omit<AppProject, "id" | "createdAt">>) => void;
  active: () => AppProject | null;
}

function newId(): string {
  return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** A readable default so an unnamed project is still findable in a list. */
export function defaultName(existing: AppProject[]): string {
  const used = new Set(existing.map((p) => p.name));
  for (let i = 1; ; i++) {
    const name = i === 1 ? "Untitled app" : `Untitled app ${i}`;
    if (!used.has(name)) return name;
  }
}

/** A project name from the first thing you asked for. "Build a tip jar with a
 *  QIE amount input" becomes "Tip jar with a QIE amount input" — far easier to
 *  find later than "Untitled app 3". */
export function nameFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(please\s+)?(build|create|make|design|generate)\s+(me\s+)?(an?|the)?\s*/i, "");
  const firstSentence = cleaned.split(/[.!?\n]/)[0].trim();
  const name = (firstSentence || cleaned).slice(0, 60).trim();
  if (!name) return "";
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** Trim and bound a name without silently discarding it. */
export function cleanName(raw: string, fallback = "Untitled app"): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 60);
  return name || fallback;
}

function read(): { projects: AppProject[]; activeId: string | null } {
  if (typeof localStorage === "undefined") return { projects: [], activeId: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { projects: [], activeId: null };
    const parsed = JSON.parse(raw) as { projects?: unknown; activeId?: unknown };
    // Validate per project and keep the good ones. One corrupt entry loses
    // that project, not every project.
    const projects: AppProject[] = [];
    if (Array.isArray(parsed.projects)) {
      for (const candidate of parsed.projects) {
        const result = projectSchema.safeParse(candidate);
        if (result.success) projects.push(result.data as AppProject);
      }
    }
    const activeId = typeof parsed.activeId === "string" ? parsed.activeId : null;
    return {
      projects,
      // Never point at a project that did not survive validation.
      activeId: projects.some((p) => p.id === activeId) ? activeId : null,
    };
  } catch {
    return { projects: [], activeId: null };
  }
}

/** Told when a save fails, so the UI can say so instead of quietly losing work. */
let onWriteError: ((message: string) => void) | null = null;
export function onProjectsWriteError(fn: ((message: string) => void) | null) {
  onWriteError = fn;
}

function write(projects: AppProject[], activeId: string | null): boolean {
  if (typeof localStorage === "undefined") return false;
  const attempt = (list: AppProject[]) =>
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: list, activeId }));
  try {
    attempt(projects);
    return true;
  } catch {
    // Out of quota. Rather than silently dropping the write — which loses work
    // with no signal at all — shed the oldest projects' build output (much the
    // largest part of a project) and retry, then tell the caller if even that
    // was not enough.
    // Keep the newest project's preview and shed the rest. Mapped back into
    // the original order afterwards, so a storage retry never silently
    // reshuffles the list the user is looking at.
    const newestId = [...projects].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id;
    const trimmed = projects.map((p) => (p.id === newestId ? p : { ...p, dist: null }));
    try {
      attempt(trimmed);
      onWriteError?.(
        "Storage was full — older previews were cleared to make room. They rebuild on the next prompt.",
      );
      return true;
    } catch {
      onWriteError?.(
        "Storage is full, so this could not be saved. Delete an app in My Apps to free space.",
      );
      return false;
    }
  }
}

export const useProjects = create<ProjectsState>((set, get) => ({
  // Deterministic on the server AND on the first client render, so hydration
  // matches. The real data arrives in hydrate().
  projects: [],
  activeId: null,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;
    const { projects, activeId } = read();
    set({ projects, activeId, hydrated: true });
  },

  create: (name) => {
    const id = newId();
    const now = Date.now();
    const projects = get().projects;
    const project: AppProject = {
      id,
      name: cleanName(name ?? "", defaultName(projects)),
      createdAt: now,
      updatedAt: now,
      files: {},
      history: [],
      turns: [],
    };
    const next = [project, ...projects].slice(0, MAX_PROJECTS);
    set({ projects: next, activeId: id });
    write(next, id);
    return id;
  },

  open: (id) => {
    if (!get().projects.some((p) => p.id === id)) return;
    set({ activeId: id });
    write(get().projects, id);
  },

  rename: (id, name) => {
    const next = get().projects.map((p) =>
      p.id === id ? { ...p, name: cleanName(name, p.name), updatedAt: Date.now() } : p,
    );
    set({ projects: next });
    write(next, get().activeId);
  },

  remove: (id) => {
    const next = get().projects.filter((p) => p.id !== id);
    const activeId = get().activeId === id ? (next[0]?.id ?? null) : get().activeId;
    set({ projects: next, activeId });
    write(next, activeId);
  },

  save: (patch) => {
    const { activeId, projects } = get();
    if (!activeId) return;
    const next = projects.map((p) =>
      p.id === activeId ? { ...p, ...patch, updatedAt: Date.now() } : p,
    );
    set({ projects: next });
    write(next, activeId);
  },

  active: () => {
    const { activeId, projects } = get();
    return projects.find((p) => p.id === activeId) ?? null;
  },
}));

/** Files that are the app itself, for a "N files" count that means something. */
export function fileCount(project: AppProject): number {
  return Object.keys(project.files).length;
}
