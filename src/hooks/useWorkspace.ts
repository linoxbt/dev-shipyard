import { useCallback, useEffect, useState } from "react";

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

const STARTER_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MyContract {

}
`;

interface Workspace {
  activePath: string;
  files: Record<string, string>; // path -> content (flat)
  folders: string[]; // explicit folder paths (so empty folders persist)
}

function emptyDefault(): Workspace {
  return {
    activePath: "contracts/MyContract.sol",
    files: { "contracts/MyContract.sol": STARTER_SOL },
    folders: ["contracts"],
  };
}

function initialWorkspace(): Workspace {
  if (typeof localStorage === "undefined") return emptyDefault();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Workspace>;
      if (parsed.files && Object.keys(parsed.files).length > 0) {
        return {
          activePath: parsed.activePath ?? "contracts/MyContract.sol",
          files: parsed.files,
          folders: parsed.folders ?? [],
        };
      }
    }
  } catch {
    /* corrupt — reset */
  }
  return emptyDefault();
}

function saveLS(next: Workspace) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota errors */
  }
}

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

export function useWorkspace() {
  const [ws, setWs] = useState<Workspace>(initialWorkspace);

  // Rehydrate from localStorage on mount (SSR-safe).
  useEffect(() => {
    setWs(initialWorkspace());
  }, []);

  const openFile = useCallback((path: string) => {
    setWs((p) => {
      const next: Workspace = { ...p, activePath: path };
      if (next.files[path] === undefined) {
        next.files = {
          ...next.files,
          [path]: path.endsWith(".sol")
            ? `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\n`
            : "",
        };
      }
      saveLS(next);
      return next;
    });
  }, []);

  const setContent = useCallback((path: string, content: string) => {
    setWs((p) => {
      const next: Workspace = { ...p, files: { ...p.files, [path]: content } };
      saveLS(next);
      return next;
    });
  }, []);

  // Create (or open if it exists) a file at an exact path.
  const addFile = useCallback((path: string, content?: string) => {
    setWs((p) => {
      if (p.files[path] !== undefined) {
        const opened = { ...p, activePath: path };
        saveLS(opened);
        return opened;
      }
      const c = content ?? (path.endsWith(".sol") ? STARTER_SOL : "");
      const next: Workspace = { ...p, files: { ...p.files, [path]: c }, activePath: path };
      saveLS(next);
      return next;
    });
  }, []);

  // Create an empty folder.
  const addFolder = useCallback((path: string) => {
    setWs((p) => {
      if (!path || p.folders.includes(path)) return p;
      const next: Workspace = { ...p, folders: [...p.folders, path] };
      saveLS(next);
      return next;
    });
  }, []);

  // Rename/move a file OR folder (re-prefixes everything beneath a folder).
  const renameFile = useCallback((oldPath: string, newPath: string) => {
    if (!newPath || oldPath === newPath) return;
    setWs((p) => {
      const remap = (k: string) =>
        k === oldPath
          ? newPath
          : k.startsWith(oldPath + "/")
            ? newPath + k.slice(oldPath.length)
            : k;
      const files: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.files)) files[remap(k)] = v;
      const folders = p.folders.map(remap);
      const next: Workspace = { activePath: remap(p.activePath), files, folders };
      saveLS(next);
      return next;
    });
  }, []);

  // Delete a file OR folder (and everything beneath it).
  const deleteFile = useCallback((path: string) => {
    setWs((p) => {
      const under = (k: string) => k === path || k.startsWith(path + "/");
      const files: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.files)) if (!under(k)) files[k] = v;
      const folders = p.folders.filter((f) => !under(f));
      const filesFinal = Object.keys(files).length > 0 ? files : emptyDefault().files;
      let activePath = p.activePath;
      if (under(activePath)) activePath = Object.keys(filesFinal)[0] ?? "";
      const next: Workspace = { activePath, files: filesFinal, folders };
      saveLS(next);
      return next;
    });
  }, []);

  // Bulk import (file/folder upload). Entries are {path, content}; folders are
  // inferred from the paths.
  const importEntries = useCallback((entries: Array<{ path: string; content: string }>) => {
    if (entries.length === 0) return;
    setWs((p) => {
      const files = { ...p.files };
      const folders = new Set(p.folders);
      for (const e of entries) {
        files[e.path] = e.content;
        let dir = parentOf(e.path);
        while (dir) {
          folders.add(dir);
          dir = parentOf(dir);
        }
      }
      const next: Workspace = {
        activePath: entries[0]?.path ?? p.activePath,
        files,
        folders: [...folders],
      };
      saveLS(next);
      return next;
    });
  }, []);

  const resetWorkspace = useCallback(() => {
    const fresh = emptyDefault();
    setWs(fresh);
    saveLS(fresh);
    return fresh;
  }, []);

  const tree = buildTree(ws.files, ws.folders);
  const activeContent = ws.files[ws.activePath] ?? "";
  const solFiles = Object.entries(ws.files)
    .filter(([p]) => p.endsWith(".sol"))
    .map(([p, c]) => ({ path: p, content: c }));

  return {
    activePath: ws.activePath,
    activeContent,
    files: ws.files,
    folders: ws.folders,
    tree,
    solFiles,
    openFile,
    setContent,
    addFile,
    addFolder,
    renameFile,
    deleteFile,
    importEntries,
    resetWorkspace,
  };
}

function buildTree(files: Record<string, string>, folders: string[]): DirNode {
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

  // Directories first, then files; alphabetical within each.
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
