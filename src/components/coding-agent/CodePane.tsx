import { useEffect, useMemo, useState } from "react";
import Editor from "@monaco-editor/react";
import { Check, ChevronRight, Copy, FileCode2, Folder, FolderOpen, Search } from "lucide-react";
import { languageForPath } from "@/lib/editor-language";
import { ancestorsOf, buildFileTree, type TreeNode } from "@/lib/coding-agent/steps";
import { cn } from "@/lib/utils";

// Code view: the project's files as a tree, and the open file in a read-only
// Monaco with syntax colouring. Files the last turn changed carry a dot, and a
// filter narrows the tree to them, so "what did it just do" is one click.

export function CodePane({
  files,
  changed,
  openFile,
  onOpenFile,
}: {
  files: Record<string, string>;
  changed: string[];
  openFile: string | null;
  onOpenFile: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const changedSet = useMemo(() => new Set(changed), [changed]);

  const paths = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.keys(files).filter(
      (p) => (!q || p.toLowerCase().includes(q)) && (!onlyChanged || changedSet.has(p)),
    );
  }, [files, query, onlyChanged, changedSet]);
  const tree = useMemo(() => buildFileTree(paths), [paths]);
  // Searching or filtering shows every match, without clicking folders open.
  const forceOpen = !!query.trim() || onlyChanged || paths.length <= 40;

  // Opening a file (from a chip in the chat, say) reveals it in the tree.
  useEffect(() => {
    if (!openFile) return;
    setExpanded((prev) => {
      const next = new Set(prev);
      ancestorsOf(openFile).forEach((a) => next.add(a));
      return next;
    });
  }, [openFile]);

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const total = Object.keys(files).length;
  return (
    <div className="flex h-full min-h-0">
      <div className="flex w-60 shrink-0 flex-col border-r border-border bg-surface max-sm:w-40">
        <div className="space-y-1.5 border-b border-border p-2">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
            <Search className="h-3 w-3 shrink-0 text-meta" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a file"
              className="min-w-0 flex-1 bg-transparent text-[12px] text-foreground placeholder:text-meta focus:outline-none"
            />
          </div>
          {changed.length > 0 && (
            <button
              onClick={() => setOnlyChanged((v) => !v)}
              className={cn(
                "flex w-full items-center gap-1.5 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] transition",
                onlyChanged ? "bg-success/10 text-success" : "text-meta hover:text-foreground",
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-success" />
              {onlyChanged ? "Showing" : "Show"} {changed.length} changed
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {total === 0 ? (
            <p className="p-2 text-[12px] text-meta">No files yet.</p>
          ) : paths.length === 0 ? (
            <p className="p-2 text-[12px] text-meta">Nothing matches.</p>
          ) : (
            <Tree
              nodes={tree}
              depth={0}
              expanded={expanded}
              forceOpen={forceOpen}
              toggle={toggle}
              openFile={openFile}
              onOpenFile={onOpenFile}
              changed={changedSet}
            />
          )}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {openFile && files[openFile] !== undefined ? (
          <>
            <FileHeader path={openFile} text={files[openFile]} changed={changedSet.has(openFile)} />
            <div className="min-h-0 flex-1">
              <CodeViewer path={openFile} value={files[openFile]} />
            </div>
          </>
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center">
            <div>
              <FileCode2 className="mx-auto h-6 w-6 text-meta" />
              <p className="mt-2 text-[13px] text-muted-foreground">
                {total ? "Pick a file to read it." : "The agent's files show up here."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Tree({
  nodes,
  depth,
  expanded,
  forceOpen,
  toggle,
  openFile,
  onOpenFile,
  changed,
}: {
  nodes: TreeNode[];
  depth: number;
  expanded: Set<string>;
  forceOpen: boolean;
  toggle: (path: string) => void;
  openFile: string | null;
  onOpenFile: (path: string) => void;
  changed: Set<string>;
}) {
  return (
    <ul>
      {nodes.map((n) => {
        const pad = { paddingLeft: `${depth * 12 + 6}px` };
        if (n.children) {
          const open = forceOpen || expanded.has(n.path);
          const Icon = open ? FolderOpen : Folder;
          return (
            <li key={n.path}>
              <button
                onClick={() => toggle(n.path)}
                style={pad}
                className="flex w-full items-center gap-1 rounded py-[3px] pr-1.5 text-left text-[12.5px] text-muted-foreground hover:bg-surface-2"
              >
                <ChevronRight
                  className={cn("h-3 w-3 shrink-0 text-meta transition", open && "rotate-90")}
                />
                <Icon className="h-3.5 w-3.5 shrink-0 text-info/80" />
                <span className="truncate">{n.name}</span>
              </button>
              {open && (
                <Tree
                  nodes={n.children}
                  depth={depth + 1}
                  expanded={expanded}
                  forceOpen={forceOpen}
                  toggle={toggle}
                  openFile={openFile}
                  onOpenFile={onOpenFile}
                  changed={changed}
                />
              )}
            </li>
          );
        }
        const active = openFile === n.path;
        return (
          <li key={n.path}>
            <button
              onClick={() => onOpenFile(n.path)}
              title={n.path}
              style={{ paddingLeft: `${depth * 12 + 22}px` }}
              className={cn(
                "flex w-full items-center gap-1.5 rounded py-[3px] pr-1.5 text-left text-[12.5px]",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )}
            >
              <FileCode2 className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1 truncate">{n.name}</span>
              {changed.has(n.path) && (
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" title="Changed" />
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function FileHeader({ path, text, changed }: { path: string; text: string; changed: boolean }) {
  const [copied, setCopied] = useState(false);
  const parts = path.split("/");
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-1.5">
      <p className="flex min-w-0 flex-1 items-center gap-1 truncate font-mono text-[11.5px]">
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && <ChevronRight className="h-3 w-3 text-meta" />}
            <span className={i === parts.length - 1 ? "text-foreground" : "text-meta"}>{p}</span>
          </span>
        ))}
        {changed && (
          <span className="ml-2 rounded-full bg-success/10 px-1.5 py-px text-[10px] text-success">
            changed
          </span>
        )}
      </p>
      <span className="hidden font-mono text-[10px] text-meta sm:inline">
        {text.split("\n").length} lines
      </span>
      <button
        onClick={() => {
          void navigator.clipboard?.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 font-mono text-[10.5px] text-meta hover:bg-surface-2 hover:text-foreground"
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/** Read-only Monaco, loaded from DevStation's own bundle (monaco-setup.ts).
 *  Plain text with line numbers until it is ready, or if it cannot load. */
function CodeViewer({ path, value }: { path: string; value: string }) {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [light, setLight] = useState(false);
  useEffect(() => {
    let live = true;
    setLight(document.documentElement.classList.contains("light"));
    import("@/components/editor/monaco-setup")
      .then((m) => m.ensureLocalMonaco())
      .then(() => live && setReady(true))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  if (!ready || failed) {
    const lines = value.split("\n");
    return (
      <div className="h-full overflow-auto bg-background py-2 font-mono text-[12px] leading-5">
        {lines.map((l, i) => (
          <div key={i} className="flex">
            <span className="w-12 shrink-0 select-none pr-3 text-right text-meta">{i + 1}</span>
            <span className="whitespace-pre text-foreground">{l}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <Editor
      height="100%"
      path={`view/${path}`}
      language={languageForPath(path)}
      value={value}
      theme={light ? "vs" : "vs-dark"}
      beforeMount={quietTypeScript}
      options={{
        readOnly: true,
        domReadOnly: true,
        fontSize: 12.5,
        fontFamily: "'JetBrains Mono', 'Courier New', monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        wordWrap: "off",
        automaticLayout: true,
        padding: { top: 10 },
        renderLineHighlight: "none",
        stickyScroll: { enabled: true },
      }}
    />
  );
}

type TsDefaults = { setDiagnosticsOptions?: (o: Record<string, boolean>) => void };

/** A file shown on its own cannot see its imports, so TypeScript's semantic
 *  checks would underline every one of them. A viewer is not where errors are
 *  reported (the agent's own lint step is), so only syntax errors are kept.
 *  Monaco moved these defaults between versions; both places are tried. */
function quietTypeScript(monaco: unknown) {
  const m = monaco as {
    typescript?: { typescriptDefaults?: TsDefaults; javascriptDefaults?: TsDefaults };
    languages?: {
      typescript?: { typescriptDefaults?: TsDefaults; javascriptDefaults?: TsDefaults };
    };
  };
  const ts = m.typescript ?? m.languages?.typescript;
  for (const d of [ts?.typescriptDefaults, ts?.javascriptDefaults]) {
    d?.setDiagnosticsOptions?.({ noSemanticValidation: true, noSyntaxValidation: false });
  }
}
