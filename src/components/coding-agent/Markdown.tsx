import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { parseMarkdown, type Inline } from "@/lib/coding-agent/markdown";
import { cn } from "@/lib/utils";

/** The agent's reply, rendered from parsed data: no HTML is ever injected. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={cn("space-y-2.5 text-[13.5px] leading-6 text-foreground", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return (
              <p
                key={i}
                className={cn(
                  "font-semibold text-foreground",
                  b.level === 1 ? "text-base" : "text-[14px]",
                )}
              >
                <Inlines nodes={b.inline} />
              </p>
            );
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag
                key={i}
                className={cn(
                  "space-y-1 pl-5 marker:text-meta",
                  b.ordered ? "list-decimal" : "list-disc",
                )}
              >
                {b.items.map((item, j) => (
                  <li key={j} className="pl-0.5">
                    <Inlines nodes={item} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "code":
            return <CodeBlock key={i} lang={b.lang} text={b.text} />;
          case "quote":
            return (
              <p key={i} className="border-l-2 border-border pl-3 text-muted-foreground">
                <Inlines nodes={b.inline} />
              </p>
            );
          default:
            return (
              <p key={i} className="break-words">
                <Inlines nodes={b.inline} />
              </p>
            );
        }
      })}
    </div>
  );
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((n, i) => {
        switch (n.kind) {
          case "code":
            return (
              <code
                key={i}
                className="rounded bg-surface-2 px-1 py-px font-mono text-[12px] text-code"
              >
                {n.text}
              </code>
            );
          case "bold":
            return (
              <strong key={i} className="font-semibold">
                <Inlines nodes={n.children} />
              </strong>
            );
          case "italic":
            return (
              <em key={i}>
                <Inlines nodes={n.children} />
              </em>
            );
          case "link":
            return (
              <a
                key={i}
                href={n.href}
                target="_blank"
                rel="noreferrer noopener"
                className="text-primary underline-offset-2 hover:underline"
              >
                <Inlines nodes={n.children} />
              </a>
            );
          default:
            return <span key={i}>{n.text}</span>;
        }
      })}
    </>
  );
}

export function CodeBlock({ lang, text }: { lang?: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-1">
        <span className="font-mono text-[10px] text-meta">{lang || "text"}</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="inline-flex items-center gap-1 font-mono text-[10px] text-meta hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto p-3 font-mono text-[12px] leading-5 text-foreground">
        {text}
      </pre>
    </div>
  );
}
