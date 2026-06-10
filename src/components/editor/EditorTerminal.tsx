import { useEffect, useRef, useState } from "react";
import { Trash2, Minimize2, ChevronRight } from "lucide-react";
import type { TerminalLine } from "@/components/shared/TerminalOutput";
import { cn } from "@/lib/utils";

interface Props {
  lines: TerminalLine[];
  onClear: () => void;
  onCollapse: () => void;
  /** Run a typed command (e.g. "compile", "help"). Optional: when omitted, the
   *  terminal is read-only output. */
  onCommand?: (command: string) => void;
}

const TAG_COLORS: Record<string, string> = {
  DevStation: "text-amber-400",
  Compiler: "text-teal-400",
  Error: "text-red-400",
  Warning: "text-yellow-300",
  Deploy: "text-green-400",
  Verify: "text-cyan-400",
  Network: "text-blue-400",
  Hint: "text-purple-400",
  Inspector: "text-purple-400",
};

function colorize(text: string): string {
  // Wrap tag prefixes with colored spans
  let s = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  // [TagName]
  s = s.replace(/^(\[[^\]]+\])/, (match) => {
    for (const [tag, cls] of Object.entries(TAG_COLORS)) {
      if (match.includes(tag)) return `<span class="${cls}">${match}</span>`;
    }
    return `<span class="text-muted-foreground">${match}</span>`;
  });
  // Timestamps [HH:MM:SS]
  s = s.replace(/^<span[^>]*>\[[^\]]+\]<\/span>/, (m) => m);
  s = s.replace(/(\[\d{2}:\d{2}:\d{2}\])/g, '<span class="opacity-40">$1</span>');
  // ✓ and ✗
  s = s.replace(/✓/g, '<span class="text-green-400">✓</span>');
  s = s.replace(/✗/g, '<span class="text-red-400">✗</span>');
  return s;
}

export function EditorTerminal({ lines, onClear, onCollapse, onCommand }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);
  const [cmd, setCmd] = useState("");
  const history = useRef<string[]>([]);
  const histPos = useRef(-1);

  useEffect(() => {
    if (autoScroll.current && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight;
    }
  }, [lines]);

  const handleScroll = () => {
    if (!ref.current) return;
    const el = ref.current;
    autoScroll.current = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  };

  const submit = () => {
    const c = cmd.trim();
    if (!c) return;
    history.current.push(c);
    histPos.current = history.current.length;
    setCmd("");
    onCommand?.(c);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.current.length === 0) return;
      histPos.current = Math.max(0, histPos.current - 1);
      setCmd(history.current[histPos.current] ?? "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (history.current.length === 0) return;
      histPos.current = Math.min(history.current.length, histPos.current + 1);
      setCmd(history.current[histPos.current] ?? "");
    }
  };

  return (
    <div className="flex h-full flex-col border-t border-border bg-[#0a0e13]">
      {/* Header */}
      <div className="flex h-[28px] shrink-0 items-center justify-between border-b border-border px-3">
        <span className="font-mono text-[10px] uppercase tracking-wider text-amber-500">
          TERMINAL
        </span>
        <div className="flex gap-1">
          <button
            onClick={onClear}
            title="Clear"
            className="rounded p-1 text-meta hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            onClick={onCollapse}
            title="Collapse"
            className="rounded p-1 text-meta hover:text-foreground"
          >
            <Minimize2 className="h-3 w-3" />
          </button>
        </div>
      </div>
      {/* Body */}
      <div
        ref={ref}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-2 font-mono text-[11px] leading-relaxed"
      >
        {lines.length === 0 ? (
          <span className="text-meta">Type `help` for available commands.</span>
        ) : (
          lines.map((line, i) => (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap break-all",
                line.status === "error" && "text-red-400",
                line.status === "warning" && "text-yellow-300",
              )}
              dangerouslySetInnerHTML={{ __html: colorize(line.text) }}
            />
          ))
        )}
      </div>
      {/* Command prompt */}
      {onCommand && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-1.5">
          <ChevronRight className="h-3.5 w-3.5 text-amber-500" />
          <input
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
            placeholder="compile · deploy · solc <ver> · ls · cat <file> · clear · help"
            className="flex-1 bg-transparent font-mono text-[11px] text-foreground placeholder:text-meta/60 focus:outline-none"
          />
        </div>
      )}
    </div>
  );
}
