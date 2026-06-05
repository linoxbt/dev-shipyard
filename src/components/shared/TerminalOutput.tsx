import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface TerminalLine {
  text: string;
  status?: "info" | "pending" | "success" | "error";
}

interface Props {
  lines: TerminalLine[];
  speedMs?: number;
  className?: string;
  onDone?: () => void;
}

export function TerminalOutput({ lines, speedMs = 450, className, onDone }: Props) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= lines.length) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => setShown((n) => n + 1), speedMs);
    return () => clearTimeout(t);
  }, [shown, lines.length, speedMs, onDone]);

  return (
    <div
      className={cn(
        "rounded border border-border bg-background p-4 font-mono text-xs leading-relaxed",
        className,
      )}
    >
      {lines.slice(0, shown).map((line, i) => (
        <div key={i} className={colorFor(line.status)}>
          {line.text}
        </div>
      ))}
      {shown < lines.length && (
        <div className="text-warning">
          {lines[shown].text.replace(/✓|✗/, "...")} <span className="terminal-cursor" />
        </div>
      )}
      {shown >= lines.length && <span className="terminal-cursor" />}
    </div>
  );
}

function colorFor(s?: TerminalLine["status"]) {
  switch (s) {
    case "success": return "text-success";
    case "error": return "text-danger";
    case "pending": return "text-warning";
    default: return "text-muted-foreground";
  }
}
