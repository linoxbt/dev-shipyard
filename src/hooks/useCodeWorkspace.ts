// Generic virtual-file-system workspace for the non-EVM editors (Solana/Rust,
// Stacks/Clarity). A parameterized sibling of useWorkspace (the EVM/Solidity
// one) — same CRUD (add/edit/rename/delete files + folders, persisted to
// localStorage), but the storage key + starter file + new-file content are
// injected so each editor keeps its own workspace.

import { useCallback, useEffect, useState } from "react";

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
export type WsTreeNode = FileNode | DirNode;

export interface WorkspaceConfig {
  storageKey: string;
  starterPath: string;
  starterContent: string;
  /** Default content for a newly-created file at `path`. */
  newFileContent?: (path: string) => string;
}

interface Workspace {
  activePath: string;
  files: Record<string, string>;
  folders: string[];
}

const parentOf = (path: string) => (path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

export function useCodeWorkspace(config: WorkspaceConfig) {
  const emptyDefault = useCallback(
    (): Workspace => ({
      activePath: config.starterPath,
      files: { [config.starterPath]: config.starterContent },
      folders: [parentOf(config.starterPath)].filter(Boolean),
    }),
    [config.starterPath, config.starterContent],
  );

  const initial = useCallback((): Workspace => {
    if (typeof localStorage === "undefined") return emptyDefault();
    try {
      const raw = localStorage.getItem(config.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Workspace>;
        if (parsed.files && Object.keys(parsed.files).length > 0) {
          return {
            activePath: parsed.activePath ?? config.starterPath,
            files: parsed.files,
            folders: parsed.folders ?? [],
          };
        }
      }
    } catch {
      /* corrupt — reset */
    }
    return emptyDefault();
  }, [config.storageKey, config.starterPath, emptyDefault]);

  const [ws, setWs] = useState<Workspace>(initial);

  useEffect(() => {
    setWs(initial());
  }, [initial]);

  const save = useCallback(
    (next: Workspace) => {
      try {
        localStorage.setItem(config.storageKey, JSON.stringify(next));
      } catch {
        /* quota */
      }
    },
    [config.storageKey],
  );

  const newContent = useCallback((path: string) => config.newFileContent?.(path) ?? "", [config]);

  const openFile = useCallback(
    (path: string) => {
      setWs((p) => {
        const next: Workspace = { ...p, activePath: path };
        if (next.files[path] === undefined) next.files = { ...next.files, [path]: newContent(path) };
        save(next);
        return next;
      });
    },
    [save, newContent],
  );

  const setActiveContent = useCallback(
    (content: string) => {
      setWs((p) => {
        const next: Workspace = { ...p, files: { ...p.files, [p.activePath]: content } };
        save(next);
        return next;
      });
    },
    [save],
  );

  const addFile = useCallback(
    (path: string, content?: string) => {
      setWs((p) => {
        if (p.files[path] !== undefined) {
          const opened = { ...p, activePath: path };
          save(opened);
          return opened;
        }
        const next: Workspace = {
          ...p,
          files: { ...p.files, [path]: content ?? newContent(path) },
          activePath: path,
        };
        save(next);
        return next;
      });
    },
    [save, newContent],
  );

  const addFolder = useCallback(
    (path: string) => {
      setWs((p) => {
        if (!path || p.folders.includes(path)) return p;
        const next: Workspace = { ...p, folders: [...p.folders, path] };
        save(next);
        return next;
      });
    },
    [save],
  );

  const renameFile = useCallback(
    (oldPath: string, newPath: string) => {
      if (!newPath || oldPath === newPath) return;
      setWs((p) => {
        const remap = (k: string) =>
          k === oldPath ? newPath : k.startsWith(oldPath + "/") ? newPath + k.slice(oldPath.length) : k;
        const files: Record<string, string> = {};
        for (const [k, v] of Object.entries(p.files)) files[remap(k)] = v;
        const next: Workspace = { activePath: remap(p.activePath), files, folders: p.folders.map(remap) };
        save(next);
        return next;
      });
    },
    [save],
  );

  const deleteFile = useCallback(
    (path: string) => {
      setWs((p) => {
        const under = (k: string) => k === path || k.startsWith(path + "/");
        const files: Record<string, string> = {};
        for (const [k, v] of Object.entries(p.files)) if (!under(k)) files[k] = v;
        const folders = p.folders.filter((f) => !under(f));
        const filesFinal = Object.keys(files).length > 0 ? files : emptyDefault().files;
        let activePath = p.activePath;
        if (under(activePath)) activePath = Object.keys(filesFinal)[0] ?? "";
        const next: Workspace = { activePath, files: filesFinal, folders };
        save(next);
        return next;
      });
    },
    [save, emptyDefault],
  );

  return {
    activePath: ws.activePath,
    activeContent: ws.files[ws.activePath] ?? "",
    files: ws.files,
    folders: ws.folders,
    tree: buildTree(ws.files, ws.folders),
    openFile,
    setActiveContent,
    addFile,
    addFolder,
    renameFile,
    deleteFile,
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
  const sortRec = (d: DirNode) => {
    d.children.sort((a, b) => (a.type !== b.type ? (a.type === "dir" ? -1 : 1) : a.path.localeCompare(b.path)));
    d.children.forEach((c) => c.type === "dir" && sortRec(c));
  };
  sortRec(root);
  return root;
}

export type CodeWorkspace = ReturnType<typeof useCodeWorkspace>;
