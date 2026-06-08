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

const wrap = (color: string, text: string) => `<span style="color:${color}">${text}</span>`;

const SOL_KEYWORDS =
  "pragma|solidity|contract|import|function|external|internal|public|private|view|pure|payable|returns|return|memory|storage|calldata|constructor|require|emit|address|uint256|uint|bool|string|bytes|mapping|struct|enum|event|modifier|new|if|else|for|while|true|false|this|super|using|is|override|virtual|abstract";

// Single-pass tokenizers. Crucially the highlighting runs in ONE regex pass over
// the (already HTML-escaped) text via a replace callback, so the <span> markup
// we insert is never re-scanned by a later rule (which previously produced
// `<span style=<span ...>` garbage in the output).
function highlightLine(line: string, lang: string): string {
  const s = escapeHtml(line);

  if (lang === "solidity") {
    const re = new RegExp(`(//[^\\n]*)|("[^"]*")|\\b(${SOL_KEYWORDS})\\b|\\b(\\d+)\\b`, "g");
    return (
      s.replace(re, (_m, comment, str, kw, num) => {
        if (comment) return wrap("var(--color-code-comment)", comment);
        if (str) return wrap("var(--color-code-string)", str);
        if (kw) return wrap("var(--color-primary)", kw);
        return wrap("var(--color-code-number)", num);
      }) || "&nbsp;"
    );
  }

  if (lang === "json") {
    const re = /("[^"]*")(\s*:)?|\b(true|false|null)\b|(-?\d+\.?\d*)/g;
    return (
      s.replace(re, (_m, str, colon, lit, num) => {
        if (str !== undefined)
          return colon
            ? wrap("var(--color-code)", str) + colon
            : wrap("var(--color-code-string)", str);
        if (lit) return wrap("var(--color-primary)", lit);
        return wrap("var(--color-code-number)", num);
      }) || "&nbsp;"
    );
  }

  if (lang === "env") {
    if (/^\s*#/.test(s)) return wrap("var(--color-code-comment)", s) || "&nbsp;";
    const m = s.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) {
      return (
        wrap("var(--color-primary)", m[1]) + "=" + wrap("var(--color-code-string)", m[2]) ||
        "&nbsp;"
      );
    }
  }

  return s || "&nbsp;";
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
