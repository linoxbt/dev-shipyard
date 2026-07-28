// Reusable file explorer for the code editors — renders a CodeWorkspace tree
// with new-file / new-folder / rename / delete actions and file selection.
// Used by the Solana (Rust) and Stacks (Clarity) editors.

import { useState } from "react";
import { Folder, FolderOpen, FileCode2, FilePlus, FolderPlus, Pencil, Trash2, ChevronRight, ChevronDown } from "lucide-react";
import type { CodeWorkspace, WsTreeNode } from "@/hooks/useCodeWorkspace";
import { cn } from "@/lib/utils";

const base = (p: string) => (p.includes("/") ? p.slice(p.lastIndexOf("/") + 1) : p);

export function FileExplorer({ ws, className }: { ws: CodeWorkspace; className?: string }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set(ws.folders));

  const promptNew = (isDir: boolean) => {
    const path = window.prompt(isDir ? "New folder path (e.g. src/utils)" : "New file path (e.g. src/lib.rs)");
    if (!path) return;
    const clean = path.trim().replace(/^\/+|\/+$/g, "");
    if (!clean) return;
    if (isDir) {
      ws.addFolder(clean);
      setExpanded((s) => new Set(s).add(clean));
    } else {
      ws.addFile(clean);
    }
  };

  const rename = (path: string) => {
    const next = window.prompt("Rename to:", path);
    if (next && next.trim()) ws.renameFile(path, next.trim().replace(/^\/+|\/+$/g, ""));
  };
  const remove = (path: string, isDir: boolean) => {
    if (window.confirm(`Delete ${isDir ? "folder" : "file"} "${base(path)}"${isDir ? " and its contents" : ""}?`)) {
      ws.deleteFile(path);
    }
  };
  const toggle = (path: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      n.has(path) ? n.delete(path) : n.add(path);
      return n;
    });

  const renderNode = (node: WsTreeNode, depth: number) => {
    const isActive = node.type === "file" && node.path === ws.activePath;
    const isOpen = node.type === "dir" && expanded.has(node.path);
    return (
      <div key={node.path}>
        <div
          className={cn(
            "group flex items-center gap-1 px-1 py-0.5 font-mono text-[11px]",
            isActive ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-surface-2",
          )}
          style={{ paddingLeft: 6 + depth * 12 }}
        >
          <button
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
            onClick={() => (node.type === "dir" ? toggle(node.path) : ws.openFile(node.path))}
          >
            {node.type === "dir" ? (
              <>
                {isOpen ? <ChevronDown className="h-3 w-3 shrink-0 text-meta" /> : <ChevronRight className="h-3 w-3 shrink-0 text-meta" />}
                {isOpen ? <FolderOpen className="h-3 w-3 shrink-0 text-meta" /> : <Folder className="h-3 w-3 shrink-0 text-meta" />}
              </>
            ) : (
              <FileCode2 className="ml-3 h-3 w-3 shrink-0 text-meta" />
            )}
            <span className="truncate">{base(node.path)}</span>
          </button>
          <button onClick={() => rename(node.path)} className="hidden text-meta hover:text-foreground group-hover:block" title="Rename">
            <Pencil className="h-3 w-3" />
          </button>
          <button onClick={() => remove(node.path, node.type === "dir")} className="hidden text-meta hover:text-danger group-hover:block" title="Delete">
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
        {node.type === "dir" && isOpen && node.children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex items-center justify-between border-b border-border px-2 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Files</span>
        <div className="flex gap-0.5">
          <button onClick={() => promptNew(false)} title="New file" className="rounded p-1 text-meta hover:text-foreground">
            <FilePlus className="h-3 w-3" />
          </button>
          <button onClick={() => promptNew(true)} title="New folder" className="rounded p-1 text-meta hover:text-foreground">
            <FolderPlus className="h-3 w-3" />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {ws.tree.type === "dir" && ws.tree.children.map((c) => renderNode(c, 0))}
      </div>
    </div>
  );
}
