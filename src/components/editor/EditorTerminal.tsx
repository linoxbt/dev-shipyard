import { useEffect, useRef } from "react";
import { Trash2, Minimize2 } from "lucide-react";
import type { TerminalLine } from "@/components/shared/TerminalOutput";
import { cn } from "@/lib/utils";

interface Props {
  lines: TerminalLine[];
  onClear: () => void;
  onCollapse: () => void;
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

export function EditorTerminal({ lines, onClear, onCollapse }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const autoScroll = useRef(true);

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
          <span className="text-meta">...</span>
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
    </div>
  );
}
