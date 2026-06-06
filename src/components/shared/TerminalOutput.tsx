import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

export interface TerminalLine {
  text: string;
  status?: "info" | "pending" | "success" | "error" | "warning";
}

interface Props {
  lines: TerminalLine[];
  speedMs?: number;
  className?: string;
  onDone?: () => void;
  /** Render all lines immediately (for real, already-streaming output) rather
   *  than animating them like a typewriter. */
  instant?: boolean;
}

export function TerminalOutput({ lines, speedMs = 450, className, onDone, instant }: Props) {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (instant) return;
    if (shown >= lines.length) {
      onDone?.();
      return;
    }
    const t = setTimeout(() => setShown((n) => n + 1), speedMs);
    return () => clearTimeout(t);
  }, [shown, lines.length, speedMs, onDone, instant]);

  const visible = instant ? lines.length : shown;

  return (
    <div
      className={cn(
        "rounded border border-border bg-background p-4 font-mono text-xs leading-relaxed",
        className,
      )}
    >
      {lines.slice(0, visible).map((line, i) => (
        <div key={i} className={colorFor(line.status)}>
          {line.text}
        </div>
      ))}
      {!instant && shown < lines.length && (
        <div className="text-warning">
          {lines[shown].text.replace(/✓|✗/, "...")} <span className="terminal-cursor" />
        </div>
      )}
      {(instant || shown >= lines.length) && <span className="terminal-cursor" />}
    </div>
  );
}

function colorFor(s?: TerminalLine["status"]) {
  switch (s) {
    case "success":
      return "text-success";
    case "error":
      return "text-danger";
    case "pending":
      return "text-warning";
    default:
      return "text-muted-foreground";
  }
}
