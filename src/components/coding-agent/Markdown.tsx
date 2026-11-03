import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { parseMarkdown, type Inline } from "@/lib/coding-agent/markdown";
import { cn } from "@/lib/utils";

/** The agent's reply, rendered from parsed data: no HTML is ever injected. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const blocks = useMemo(() => parseMarkdown(text), [text]);
  return (
    <div className={cn("space-y-[0.85em] text-[13px] leading-6 text-foreground", className)}>
      {blocks.map((b, i) => {
        switch (b.kind) {
          case "heading":
            return (
              <p
                key={i}
                className={cn(
                  "pt-[0.35em] font-semibold leading-snug text-foreground",
                  b.level === 1 ? "text-[1.2em]" : b.level === 2 ? "text-[1.1em]" : "text-[1em]",
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
                  "space-y-[0.4em] pl-[1.4em] marker:text-meta",
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
          case "table":
            return (
              <div key={i} className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-left text-[0.9em] leading-snug">
                  <thead className="bg-surface-2/60">
                    <tr>
                      {b.head.map((c, j) => (
                        <th key={j} className="px-3 py-2 font-semibold text-foreground">
                          <Inlines nodes={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border border-t border-border">
                    {b.rows.map((row, r) => (
                      <tr key={r}>
                        {b.head.map((_, j) => (
                          <td key={j} className="px-3 py-2 align-top text-foreground/90">
                            {row[j] ? <Inlines nodes={row[j]} /> : null}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
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
                className="rounded-md bg-surface-2 px-[0.35em] py-[0.1em] font-mono text-[0.85em] text-code"
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
        <span className="font-mono text-[10.5px] text-meta">{lang || "text"}</span>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          }}
          className="inline-flex items-center gap-1 font-mono text-[10.5px] text-meta hover:text-foreground"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="max-h-80 overflow-auto p-3 font-mono text-[12.5px] leading-5 text-foreground">
        {text}
      </pre>
    </div>
  );
}
