// The small part of Markdown the agent's replies use: paragraphs, headings,
// bullet and numbered lists, fenced code, inline code, bold, italics and
// links. Parsed into plain data and rendered as React elements (never as
// HTML), because the reply is model output that may have read hostile input.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] };

export type Block =
  | { kind: "paragraph"; inline: Inline[] }
  | { kind: "heading"; level: 1 | 2 | 3; inline: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "quote"; inline: Inline[] };

/** Only web links: a `javascript:` or `data:` href would run in DevStation. */
export function safeHref(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

const INLINE =
  /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\([^)\s]+\))|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])|(\*[^*\n]+\*|_[^_\n]+_)/;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const m = INLINE.exec(rest);
    if (!m) {
      out.push({ kind: "text", text: rest });
      break;
    }
    if (m.index > 0) out.push({ kind: "text", text: rest.slice(0, m.index) });
    const token = m[0];
    if (m[1]) out.push({ kind: "code", text: token.slice(1, -1) });
    else if (m[2]) out.push({ kind: "bold", children: parseInline(token.slice(2, -2)) });
    else if (m[3]) {
      const close = token.indexOf("](");
      const label = token.slice(1, close);
      const href = safeHref(token.slice(close + 2, -1));
      out.push(
        href ? { kind: "link", href, children: parseInline(label) } : { kind: "text", text: label },
      );
    } else if (m[4]) {
      const href = safeHref(token);
      out.push(
        href
          ? { kind: "link", href, children: [{ kind: "text", text: token }] }
          : { kind: "text", text: token },
      );
    } else if (m[5]) {
      // A lone underscore inside snake_case is not emphasis.
      const before = rest[m.index - 1];
      if (token.startsWith("_") && before && /\w/.test(before)) {
        out.push({ kind: "text", text: token });
      } else {
        out.push({ kind: "italic", children: parseInline(token.slice(1, -1)) });
      }
    }
    rest = rest.slice(m.index + token.length);
  }
  // Merge neighbouring text so the renderer emits fewer nodes.
  return out.reduce<Inline[]>((acc, node) => {
    const last = acc[acc.length - 1];
    if (node.kind === "text" && last?.kind === "text") last.text += node.text;
    else acc.push(node);
    return acc;
  }, []);
}

const BULLET = /^\s*[-*+]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "paragraph", inline: parseInline(para.join(" ")) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*```\s*([\w+-]*)/.exec(line);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) body.push(lines[i++]);
      blocks.push({ kind: "code", lang: fence[1] ?? "", text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        inline: parseInline(heading[2]),
      });
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      flush();
      blocks.push({ kind: "quote", inline: parseInline(quote[1]) });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    if (bullet || numbered) {
      flush();
      const ordered = !!numbered;
      const items: Inline[][] = [];
      const re = ordered ? NUMBERED : BULLET;
      while (i < lines.length) {
        const item = re.exec(lines[i]);
        if (item) items.push(parseInline(item[1]));
        else if (lines[i].trim() && /^\s{2,}/.test(lines[i]) && items.length) {
          // A wrapped item continues on an indented line.
          items[items.length - 1].push({ kind: "text", text: ` ${lines[i].trim()}` });
        } else break;
        i++;
      }
      i--;
      blocks.push({ kind: "list", ordered, items });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}
