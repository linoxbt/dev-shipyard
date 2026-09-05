// The editor's virtual filesystem.
//
// A zustand store rather than component state because two callers need it: the
// editor UI, and the AI agent, which writes generated app files from outside
// React (see useCodeAgent). A `useState` hook is unreachable from there.
//
// SSR-safe via an explicit hydrate(), matching ai-chat-store and
// active-chain: the store starts at the SAME default on the server and on the
// client's first render, and only adopts localStorage afterwards. Reading
// localStorage in the initialiser (what this did before) makes the first
// client render disagree with the server-rendered HTML.
//
// Nothing here restricts file extensions: the workspace holds Solidity,
// generated app files, or anything else. Only the compiler filters to `.sol`.

import { create } from "zustand";

const STORAGE_KEY = "devstation-workspace-v2";

interface FileNode {
  type: "file";
  path: string;
  content: string;
}

interface DirNode {
  type: "dir";
  path: string;
  children: (FileNode | DirNode)[];
}

export type TreeNode = FileNode | DirNode;
export type { DirNode };

const STARTER_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MyContract {

}
`;

export interface WorkspaceState {
  hydrated: boolean;
  activePath: string;
  files: Record<string, string>; // path -> content (flat)
  folders: string[]; // explicit folder paths, so empty folders persist

  hydrate: () => void;
  openFile: (path: string) => void;
  setContent: (path: string, content: string) => void;
  addFile: (path: string, content?: string) => void;
  addFolder: (path: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;
  deleteFile: (path: string) => void;
  importEntries: (entries: Array<{ path: string; content: string }>) => void;
  /** Write several files at once WITHOUT changing the active file. Used by the
   *  app generator, which emits a whole project and should not yank the user
   *  out of the file they are looking at. */
  writeFiles: (entries: Array<{ path: string; content: string }>) => void;
  resetWorkspace: () => void;
}

type Persisted = Pick<WorkspaceState, "activePath" | "files" | "folders">;

function emptyDefault(): Persisted {
  return {
    activePath: "contracts/MyContract.sol",
    files: { "contracts/MyContract.sol": STARTER_SOL },
    folders: ["contracts"],
  };
}

function readStored(): Persisted {
  if (typeof localStorage === "undefined") return emptyDefault();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Persisted>;
      if (parsed.files && Object.keys(parsed.files).length > 0) {
        return {
          activePath: parsed.activePath ?? "contracts/MyContract.sol",
          files: parsed.files,
          folders: parsed.folders ?? [],
        };
      }
    }
  } catch {
    /* corrupt: fall through to the default */
  }
  return emptyDefault();
}

function save(p: Persisted) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* quota: the in-memory workspace still works */
  }
}

export const parentOf = (path: string) =>
  path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

/** Default content for a brand-new file, by extension. */
function starterFor(path: string): string {
  if (path.endsWith(".sol")) return STARTER_SOL;
  return "";
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const commit = (next: Persisted) => {
    save(next);
    set(next);
  };

  return {
    hydrated: false,
    ...emptyDefault(),

    hydrate: () => {
      if (get().hydrated) return;
      set({ ...readStored(), hydrated: true });
    },

    openFile: (path) => {
      const s = get();
      const files =
        s.files[path] === undefined
          ? {
              ...s.files,
              [path]: path.endsWith(".sol")
                ? `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\n`
                : "",
            }
          : s.files;
      commit({ activePath: path, files, folders: s.folders });
    },

    setContent: (path, content) => {
      const s = get();
      commit({
        activePath: s.activePath,
        files: { ...s.files, [path]: content },
        folders: s.folders,
      });
    },

    addFile: (path, content) => {
      const s = get();
      if (s.files[path] !== undefined) {
        commit({ activePath: path, files: s.files, folders: s.folders });
        return;
      }
      commit({
        activePath: path,
        files: { ...s.files, [path]: content ?? starterFor(path) },
        folders: s.folders,
      });
    },

    addFolder: (path) => {
      const s = get();
      if (!path || s.folders.includes(path)) return;
      commit({ activePath: s.activePath, files: s.files, folders: [...s.folders, path] });
    },

    renameFile: (oldPath, newPath) => {
      if (!newPath || oldPath === newPath) return;
      const s = get();
      const remap = (k: string) =>
        k === oldPath
          ? newPath
          : k.startsWith(oldPath + "/")
            ? newPath + k.slice(oldPath.length)
            : k;
      const files: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.files)) files[remap(k)] = v;
      commit({ activePath: remap(s.activePath), files, folders: s.folders.map(remap) });
    },

    deleteFile: (path) => {
      const s = get();
      const under = (k: string) => k === path || k.startsWith(path + "/");
      const files: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.files)) if (!under(k)) files[k] = v;
      const folders = s.folders.filter((f) => !under(f));
      // Never leave the workspace with nothing in it.
      const filesFinal = Object.keys(files).length > 0 ? files : emptyDefault().files;
      const activePath = under(s.activePath) ? (Object.keys(filesFinal)[0] ?? "") : s.activePath;
      commit({ activePath, files: filesFinal, folders });
    },

    importEntries: (entries) => {
      if (entries.length === 0) return;
      const s = get();
      const { files, folders } = mergeEntries(s, entries);
      commit({ activePath: entries[0]?.path ?? s.activePath, files, folders });
    },

    writeFiles: (entries) => {
      if (entries.length === 0) return;
      const s = get();
      const { files, folders } = mergeEntries(s, entries);
      commit({ activePath: s.activePath, files, folders });
    },

    resetWorkspace: () => commit(emptyDefault()),
  };
});

function mergeEntries(
  s: Pick<WorkspaceState, "files" | "folders">,
  entries: Array<{ path: string; content: string }>,
) {
  const files = { ...s.files };
  const folders = new Set(s.folders);
  for (const e of entries) {
    files[e.path] = e.content;
    let dir = parentOf(e.path);
    while (dir) {
      folders.add(dir);
      dir = parentOf(dir);
    }
  }
  return { files, folders: [...folders] };
}

export function buildTree(files: Record<string, string>, folders: string[]): DirNode {
  const root: DirNode = { type: "dir", path: "", children: [] };

  const ensureDir = (dirPath: string): DirNode => {
    if (!dirPath) return root;
    let cur = root;
    let acc = "";
    for (const part of dirPath.split("/")) {
      acc = acc ? `${acc}/${part}` : part;
      let dir = cur.children.find((c) => c.type === "dir" && c.path === acc) as DirNode | undefined;
      if (!dir) {
        dir = { type: "dir", path: acc, children: [] };
        cur.children.push(dir);
      }
      cur = dir;
    }
    return cur;
  };

  for (const f of folders) ensureDir(f);
  for (const path of Object.keys(files).sort()) {
    ensureDir(parentOf(path)).children.push({ type: "file", path, content: files[path] });
  }

  const sortRec = (d: DirNode) => {
    d.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });
    d.children.forEach((c) => c.type === "dir" && sortRec(c));
  };
  sortRec(root);
  return root;
}
