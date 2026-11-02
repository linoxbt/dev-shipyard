// Named App Builder projects, and the memory that goes with them.
//
// Before this there was one unnamed workspace held in React state: starting a
// second app silently replaced the first, and a page refresh lost everything.
// You could not go back to something you built yesterday because there was no
// yesterday.
//
// A project carries its FILES and its CONVERSATION together, and that pairing
// is the point. Reopening one restores the code and the whole exchange that
// produced it, so the agent still knows what you asked for and why, without
// it, a reopened project is one where the agent has amnesia about everything
// except the code, which is precisely the failure this is meant to fix.
//
// Stored in localStorage, like the rest of DevStation's state. No database.

import { create } from "zustand";
import { z } from "zod";
import type { ChatMessage } from "@/lib/ai";
import type { AgentQuestion } from "@/lib/coding-agent/steps";

const STORAGE_KEY = "devstation-apps-v1";

/** A rendered chat turn. Mirrors the builder's own Turn, kept here so stored
 *  data has a real shape rather than `unknown[]`. */
export interface ProjectTurn {
  role: "user" | "assistant";
  text: string;
  changed?: string[];
  failed?: boolean;
  /** The tool steps of an agent turn, titles only, so the conversation can
   *  still say what was done after the workspace has moved on. */
  steps?: { tool?: string; title: string; target?: string; failed?: boolean; shot?: string }[];
  /** Sent in Plan mode, or the plan that came back. */
  plan?: boolean;
  /** Thumbnails of pictures attached to a message (small JPEG data URLs). */
  images?: string[];
  /** The decision an agent turn ended on, offered as choices to tap. */
  question?: AgentQuestion;
  /** The person hid that question (they answer in their own words, or not). */
  questionDismissed?: boolean;
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
   *  Without it the preview is blank until you prompt again, and a Vite
   *  project cannot be previewed from source at all. */
  dist?: Record<string, string> | null;
  /** Where this app is published, so reopening it shows the live URL instead
   *  of making you publish again to find out. */
  liveUrl?: string | null;
  /** Wallet that built this app. Recorded at creation: the builder is
   *  wallet-gated, so there is always one, and never overwritten, so the
   *  credit survives switching accounts in the same browser. */
  owner?: string | null;
  /** GitHub repository this app has been pushed to, if any. */
  repo?: { owner: string; name: string; url: string; pushedAt: number } | null;
  /** Contract the app was wired to, if any. */
  attached?: ProjectAttachment | null;
  /** The Coding Agent workspace on the runner that holds this project. */
  workspaceId?: string | null;
  /** How many of that workspace's turns this project has already recorded. */
  workspaceTurns?: number;
  /** Where the project started, and the repository it belongs to, if any. */
  source?: { kind: "blank" | "files" | "github"; repo?: string; ref?: string } | null;
  /** True once another wallet builds on this project's workspace. */
  shared?: boolean;
  /** "builder" when this browser joined somebody else's workspace. */
  role?: "owner" | "builder";
  builders?: Record<string, string>;
}

// Everything below is read back from localStorage, which is user-editable and
// carries data written by older versions of this code. Parsing it as trusted
// input meant a corrupt entry rendered straight into JSX: `t.changed.map(...)`
// on a non-array throws and white-screens the route. Anything that does not
// match is dropped rather than crashing the page.
const turnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  changed: z.array(z.string()).optional(),
  failed: z.boolean().optional(),
  steps: z
    .array(
      z.object({
        tool: z.string().max(60).optional(),
        // Up to 1200 for the agent's narration (tool "narration").
        title: z.string().max(1200),
        target: z.string().max(300).optional(),
        failed: z.boolean().optional(),
        // A screenshot the step took, as a small JPEG data URL.
        shot: z.string().max(150_000).optional(),
      }),
    )
    .max(100)
    .optional(),
  plan: z.boolean().optional(),
  images: z.array(z.string().max(120_000)).max(4).optional(),
  question: z
    .object({
      question: z.string().max(600),
      header: z.string().max(40).optional(),
      options: z
        .array(z.object({ label: z.string().max(80), description: z.string().max(300).optional() }))
        .min(2)
        .max(4),
      multiSelect: z.boolean().optional(),
    })
    .optional(),
  questionDismissed: z.boolean().optional(),
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
  owner: z.string().max(320).nullable().optional(),
  repo: z
    .object({
      owner: z.string().max(120),
      name: z.string().max(120),
      url: z.string().max(400),
      pushedAt: z.number(),
    })
    .nullable()
    .optional(),
  attached: attachmentSchema.nullable().optional(),
  workspaceId: z.string().max(80).nullable().optional(),
  workspaceTurns: z.number().optional(),
  source: z
    .object({
      kind: z.enum(["blank", "files", "github"]),
      repo: z.string().max(200).optional(),
      ref: z.string().max(200).optional(),
    })
    .nullable()
    .optional(),
  shared: z.boolean().optional(),
  role: z.enum(["owner", "builder"]).optional(),
  /** Emails of builders added from this browser, by account id, so the
   *  Share sheet can name them (the runner only knows the ids). */
  builders: z.record(z.string().max(100), z.string().max(320)).optional(),
});

interface ProjectsState {
  projects: AppProject[];
  activeId: string | null;
  hydrated: boolean;
  /** Read localStorage. Called from an effect, never during render, so the
   *  server and the first client render agree. */
  hydrate: () => void;
  create: (name?: string, owner?: string | null) => string;
  open: (id: string) => void;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  /** Persist the working state of the active project. */
  save: (patch: Partial<Omit<AppProject, "id" | "createdAt">>) => void;
  /** Persist a patch to ANY project by id.
   *
   *  The app detail page edits a project that is not necessarily the one open
   *  in the builder. Calling open(id) first would work, but it would silently
   *  switch the builder's active project as a side effect of viewing a page. */
  update: (id: string, patch: Partial<Omit<AppProject, "id" | "createdAt">>) => void;
  active: () => AppProject | null;
  /** Take versions saved from another device: replaces each by id (or adds
   *  it) as it is, without touching its updatedAt, and drops the ids in
   *  `gone`. The open project is left open unless it was deleted. */
  mergeRemote: (incoming: AppProject[], gone?: string[]) => void;
  /** Copy a project into a new one and open it: same files, preview and
   *  conversation, but its own workspace, address and repository, so nothing
   *  done to the remix touches the original. Returns the new id. */
  remix: (id: string, owner?: string | null) => string | null;
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
 *  QIE amount input" becomes "Tip jar with a QIE amount input": far easier to
 *  find later than "Untitled app 3". */
export function nameFromPrompt(prompt: string): string {
  // The first line of a pasted brief, not every line run together.
  const firstLine = prompt.trim().split(/\n/)[0] ?? "";
  const cleaned = firstLine
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

/** A project read from anywhere outside this browser's own storage, checked
 *  the same way: valid as it is, repaired, or null. */
export function parseProject(candidate: unknown): AppProject | null {
  const result = projectSchema.safeParse(candidate);
  return result.success ? (result.data as AppProject) : repairProject(candidate);
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
        else {
          // One bad field never costs the whole project: keep what is valid.
          const repaired = repairProject(candidate);
          if (repaired) projects.push(repaired);
        }
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

/**
 * A stored project that failed validation, made valid by dropping only what
 * is wrong: an oversized screenshot or picture, a malformed question, a turn
 * that cannot be read, an optional field out of range. Null only when even
 * its id, name and files cannot be read.
 */
export function repairProject(candidate: unknown): AppProject | null {
  if (!candidate || typeof candidate !== "object") return null;
  const raw = { ...(candidate as Record<string, unknown>) };
  const turns = Array.isArray(raw.turns) ? raw.turns : [];
  raw.turns = turns
    .map((turn) => {
      const ok = turnSchema.safeParse(turn);
      if (ok.success) return ok.data;
      if (!turn || typeof turn !== "object") return null;
      const t = { ...(turn as Record<string, unknown>) };
      delete t.images;
      delete t.question;
      if (Array.isArray(t.steps)) {
        t.steps = t.steps.slice(-100).map((step) => {
          if (!step || typeof step !== "object") return step;
          const { shot: _shot, ...rest } = step as Record<string, unknown>;
          return rest;
        });
      }
      const again = turnSchema.safeParse(t);
      if (again.success) return again.data;
      delete t.steps;
      const last = turnSchema.safeParse(t);
      return last.success ? last.data : null;
    })
    .filter(Boolean);
  for (const key of [
    "owner",
    "builders",
    "repo",
    "attached",
    "source",
    "liveUrl",
    "dist",
    "history",
    "role",
    "shared",
  ]) {
    const probe = projectSchema.safeParse(raw);
    if (probe.success) return probe.data as AppProject;
    const bad = probe.error.issues.some((issue) => issue.path[0] === key);
    if (bad) delete raw[key];
  }
  const final = projectSchema.safeParse(raw);
  return final.success ? (final.data as AppProject) : null;
}

/** Told when a project is deleted here, so the deletion can reach the
 *  account's other devices (project-sync.ts). */
const removedListeners = new Set<(id: string) => void>();
export function onProjectRemoved(fn: (id: string) => void): () => void {
  removedListeners.add(fn);
  return () => removedListeners.delete(fn);
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
    // Out of quota. Rather than silently dropping the write, which loses work
    // with no signal at all: shed the oldest projects' build output (much the
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
        "Storage was full: older previews were cleared to make room. They rebuild on the next prompt.",
      );
      return true;
    } catch {
      // Then the screenshots kept in older conversations: the chat still
      // says what was done, without the pictures.
      const lighter = trimmed.map((p) => ({
        ...p,
        turns: p.turns.map((t, i) =>
          p.id === newestId && i >= p.turns.length - 6
            ? t
            : {
                ...t,
                ...(t.steps ? { steps: t.steps.map(({ shot: _s, ...rest }) => rest) } : {}),
                images: undefined,
              },
        ),
      }));
      try {
        attempt(lighter);
        onWriteError?.("Storage was full: older screenshots were cleared to make room.");
        return true;
      } catch {
        onWriteError?.(
          "Storage is full, so this could not be saved. Delete a project you no longer need (its ··· menu on the home screen) to free space.",
        );
        return false;
      }
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

  create: (name, owner) => {
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
      // Recorded once, at creation. Never rewritten from the currently
      // connected wallet: switching accounts in the same browser must not
      // reassign authorship of work somebody else did.
      owner: owner ?? null,
    };
    const next = [project, ...projects];
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
    for (const fn of removedListeners) fn(id);
    const next = get().projects.filter((p) => p.id !== id);
    // Deleting the open project goes home, never into some other project.
    const activeId = get().activeId === id ? null : get().activeId;
    set({ projects: next, activeId });
    write(next, activeId);
  },

  save: (patch) => {
    const { activeId } = get();
    if (!activeId) return;
    get().update(activeId, patch);
  },

  update: (id, patch) => {
    const { activeId, projects } = get();
    if (!projects.some((p) => p.id === id)) return;
    const next = projects.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p));
    set({ projects: next });
    // activeId is passed through untouched: persisting a patch to some other
    // project must not change which one is open.
    write(next, activeId);
  },

  mergeRemote: (incoming, gone = []) => {
    if (!incoming.length && !gone.length) return;
    const byId = new Map(incoming.map((p) => [p.id, p]));
    const drop = new Set(gone);
    const kept = get()
      .projects.filter((p) => !drop.has(p.id))
      .map((p) => byId.get(p.id) ?? p);
    const known = new Set(kept.map((p) => p.id));
    const added = incoming.filter((p) => !known.has(p.id) && !drop.has(p.id));
    const next = [...added, ...kept].sort((a, b) => b.updatedAt - a.updatedAt);
    const activeId = drop.has(get().activeId ?? "") ? null : get().activeId;
    set({ projects: next, activeId });
    write(next, activeId);
  },

  remix: (id, owner) => {
    const projects = get().projects;
    const from = projects.find((p) => p.id === id);
    if (!from) return null;
    const now = Date.now();
    const hasFiles = Object.keys(from.files).length > 0;
    const project: AppProject = {
      id: newId(),
      name: cleanName(`${from.name} remix`, defaultName(projects)),
      createdAt: now,
      updatedAt: now,
      files: { ...from.files },
      history: [...from.history],
      turns: [...from.turns],
      dist: from.dist ?? null,
      owner: owner ?? null,
      attached: from.attached ?? null,
      source: hasFiles
        ? { kind: "files", repo: from.source?.repo, ref: from.source?.ref }
        : (from.source ?? { kind: "blank" }),
    };
    const next = [project, ...projects];
    set({ projects: next, activeId: project.id });
    write(next, project.id);
    return project.id;
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
