import { Copy, Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

interface Props {
  code: string;
  language?: string;
  showLineNumbers?: boolean;
  className?: string;
  maxHeight?: string;
}

export function CodeBlock({
  code,
  language = "solidity",
  showLineNumbers = true,
  className,
  maxHeight,
}: Props) {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded border border-border bg-background",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-meta">{language}</span>
        <button
          onClick={() => {
            navigator.clipboard.writeText(code);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex items-center gap-1 font-mono text-[10px] text-meta transition hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <pre
        className="overflow-auto p-3 font-mono text-xs leading-relaxed text-foreground"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <code>
          {lines.map((line, i) => (
            <div key={i} className="flex">
              {showLineNumbers && (
                <span className="mr-4 inline-block w-8 select-none text-right text-meta">
                  {i + 1}
                </span>
              )}
              <span dangerouslySetInnerHTML={{ __html: highlightLine(line, language) }} />
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

function highlightLine(line: string, lang: string): string {
  let s = escapeHtml(line);
  if (lang === "solidity") {
    s = s.replace(
      /\b(pragma|solidity|contract|import|function|external|internal|public|private|view|pure|payable|returns|return|memory|storage|calldata|constructor|require|emit|address|uint256|uint|bool|string|bytes|mapping|struct|enum|event|modifier|new|if|else|for|while|true|false|this|super|using|is|override|virtual|abstract)\b/g,
      '<span style="color:var(--color-primary)">$1</span>',
    );
    s = s.replace(/(\/\/[^\n]*)/g, '<span style="color:var(--color-code-comment)">$1</span>');
    s = s.replace(/("[^"]*")/g, '<span style="color:var(--color-code-string)">$1</span>');
    s = s.replace(/\b(\d+)\b/g, '<span style="color:var(--color-code-number)">$1</span>');
  } else if (lang === "json") {
    s = s.replace(/("[^"]+")(\s*:)/g, '<span style="color:var(--color-code)">$1</span>$2');
    s = s.replace(/:\s*("[^"]*")/g, ': <span style="color:var(--color-code-string)">$1</span>');
    s = s.replace(/\b(true|false|null)\b/g, '<span style="color:var(--color-primary)">$1</span>');
    s = s.replace(/\b(-?\d+\.?\d*)\b/g, '<span style="color:var(--color-code-number)">$1</span>');
  } else if (lang === "env") {
    s = s.replace(
      /^([A-Z_][A-Z0-9_]*)(=)/g,
      '<span style="color:var(--color-primary)">$1</span>$2',
    );
    s = s.replace(/=(.+)$/g, '=<span style="color:var(--color-code-string)">$1</span>');
    s = s.replace(/(#[^\n]*)/g, '<span style="color:var(--color-code-comment)">$1</span>');
  }
  return s || "&nbsp;";
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
