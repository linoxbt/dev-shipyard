// Extract the primary contract name from Solidity source, used to name files
// when opening AI-generated code in the Contract Editor.
export function contractNameOf(source: string): string | null {
  // Prefer a `contract X` declaration; fall back to interface/library/abstract.
  const m =
    source.match(/\bcontract\s+([A-Za-z_]\w*)/) ||
    source.match(/\babstract\s+contract\s+([A-Za-z_]\w*)/) ||
    source.match(/\b(?:interface|library)\s+([A-Za-z_]\w*)/);
  return m ? m[1] : null;
}
