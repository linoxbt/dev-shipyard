// React view over the workspace store.
//
// The state itself lives in src/lib/workspace-store.ts so non-React callers
// (the AI agent writing generated app files) can reach it. This hook keeps the
// exact shape the editor already consumes, plus the derived values, so call
// sites did not have to change when it stopped being component state.

import { useEffect, useMemo } from "react";
import { useWorkspaceStore, buildTree, type TreeNode, type DirNode } from "@/lib/workspace-store";

export type { TreeNode, DirNode };

export function useWorkspace() {
  const hydrate = useWorkspaceStore((s) => s.hydrate);
  const activePath = useWorkspaceStore((s) => s.activePath);
  const files = useWorkspaceStore((s) => s.files);
  const folders = useWorkspaceStore((s) => s.folders);

  // Adopt the saved workspace after mount. Before this runs, server and client
  // both render the same default, so there is no hydration mismatch.
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // buildTree walks every file and sorts recursively; it used to run on every
  // render of a 1000-line editor route.
  const tree = useMemo(() => buildTree(files, folders), [files, folders]);
  const solFiles = useMemo(
    () =>
      Object.entries(files)
        .filter(([p]) => p.endsWith(".sol"))
        .map(([p, c]) => ({ path: p, content: c })),
    [files],
  );

  return {
    activePath,
    activeContent: files[activePath] ?? "",
    files,
    folders,
    tree,
    /** Solidity files only: what the compiler is given. */
    solFiles,
    openFile: useWorkspaceStore((s) => s.openFile),
    setContent: useWorkspaceStore((s) => s.setContent),
    addFile: useWorkspaceStore((s) => s.addFile),
    addFolder: useWorkspaceStore((s) => s.addFolder),
    renameFile: useWorkspaceStore((s) => s.renameFile),
    deleteFile: useWorkspaceStore((s) => s.deleteFile),
    importEntries: useWorkspaceStore((s) => s.importEntries),
    writeFiles: useWorkspaceStore((s) => s.writeFiles),
    resetWorkspace: useWorkspaceStore((s) => s.resetWorkspace),
  };
}
