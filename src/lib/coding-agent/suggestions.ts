// The agent ends a working turn with up to three next steps under a line
// that says "Suggestions:" (lib/agent/system-prompt.ts). The chat shows them
// as buttons instead of text.

const HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?suggestions(?:\*\*|__)?\s*:?\s*(?:\*\*|__)?\s*$/i;
const ITEM = /^\s*(?:[-*•]|\d+[.)])\s+/;

export function splitSuggestions(text: string): { body: string; suggestions: string[] } {
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!HEADING.test(lines[i])) continue;
    const after = lines.slice(i + 1).filter((l) => l.trim());
    if (after.length === 0 || !after.every((l) => ITEM.test(l))) break;
    const suggestions = after
      .map((l) =>
        l
          .replace(ITEM, "")
          .replace(/\*\*|__/g, "")
          .trim(),
      )
      .filter((l) => l.length > 0 && l.length <= 200)
      .slice(0, 3);
    return { body: lines.slice(0, i).join("\n").trimEnd(), suggestions };
  }
  return { body: text, suggestions: [] };
}
