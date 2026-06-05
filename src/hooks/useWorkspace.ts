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

type TreeNode = FileNode | DirNode;

const STARTER_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MyContract {

}
`;

interface Workspace {
  activePath: string;
  files: Record<string, string>; // path -> content (flat)
}

function initialWorkspace(): Workspace {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Workspace>;
      if (parsed.files && Object.keys(parsed.files).length > 0) {
        return { activePath: parsed.activePath ?? "contracts/MyContract.sol", files: parsed.files };
      }
    }
  } catch {
    /* corrupt — reset */
  }
  return {
    activePath: "contracts/MyContract.sol",
    files: { "contracts/MyContract.sol": STARTER_SOL },
  };
}

export function useWorkspace() {
  const [ws, setWs] = useState<Workspace>(initialWorkspace);

  const persist = useCallback((next: Workspace) => {
    setWs(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  // Rehydrate from localStorage on mount (SSR-safe)
  useEffect(() => {
    setWs(initialWorkspace());
  }, []);

  const openFile = useCallback((path: string) => {
    setWs((p) => {
      const next = { ...p, activePath: path };
      // ensure file exists
      if (!next.files[path]) {
        next.files[path] =
          typeof path === "string" && path.endsWith(".sol")
            ? `// SPDX-License-Identifier: MIT\npragma solidity ^0.8.20;\n\n`
            : "";
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const setContent = useCallback((path: string, content: string) => {
    setWs((p) => ({
      ...p,
      files: { ...p.files, [path]: content },
    }));
    // auto-save to localStorage on every edit (debounced would be better,
    // but for an IDE it's fine)
    try {
      const prev = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Workspace>;
      const next = { ...prev, files: { ...prev.files, [path]: content }, activePath: path };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const createFile = useCallback(
    (parentPath: string) => {
      let name = "Untitled.sol";
      let full = parentPath ? `${parentPath}/${name}` : name;
      let n = 1;
      while (ws.files[full]) {
        name = `Untitled${n}.sol`;
        full = parentPath ? `${parentPath}/${name}` : name;
        n++;
      }
      const next = { ...ws, files: { ...ws.files, [full]: "" }, activePath: full };
      persist(next);
    },
    [ws, persist],
  );

  const deleteFile = useCallback((path: string) => {
    setWs((p) => {
      const files = { ...p.files };
      delete files[path];
      const next: Workspace = {
        activePath:
          p.activePath === path
            ? (Object.keys(files)[0] ?? "contracts/MyContract.sol")
            : p.activePath,
        files: Object.keys(files).length > 0 ? files : initialWorkspace().files,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const renameFile = useCallback((oldPath: string, newPath: string) => {
    if (oldPath === newPath) return;
    setWs((p) => {
      const files: Record<string, string> = {};
      for (const [k, v] of Object.entries(p.files)) {
        files[k === oldPath ? newPath : k] = v;
      }
      const next: Workspace = {
        activePath: p.activePath === oldPath ? newPath : p.activePath,
        files,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const resetWorkspace = useCallback(() => {
    const ws = initialWorkspace();
    setWs(ws);
    // reset to defaults
    localStorage.removeItem(STORAGE_KEY);
    return ws;
  }, []);

  // Build tree from flat files
  const tree = buildTree(ws.files);
  const activeContent = ws.files[ws.activePath] ?? "";
  const solFiles = Object.entries(ws.files)
    .filter(([p]) => p.endsWith(".sol"))
    .map(([p, c]) => ({ path: p, content: c }));

  return {
    activePath: ws.activePath,
    activeContent,
    files: ws.files,
    tree,
    solFiles,
    openFile,
    setContent,
    createFile,
    deleteFile,
    renameFile,
    resetWorkspace,
  };
}

function buildTree(files: Record<string, string>): DirNode {
  const root: DirNode = { type: "dir", path: "", children: [] };

  for (const path of Object.keys(files).sort()) {
    const parts = path.split("/");
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      if (isFile) {
        current.children.push({ type: "file", path, content: files[path] });
      } else {
        let dir = current.children.find(
          (c) => c.type === "dir" && c.path === `${current.path ? current.path + "/" : ""}${name}`,
        ) as DirNode | undefined;
        if (!dir) {
          dir = {
            type: "dir",
            path: `${current.path ? current.path + "/" : ""}${name}`,
            children: [],
          };
          current.children.push(dir);
        }
        current = dir;
      }
    }
  }
  return root;
}
