// Monaco language id for a workspace file.
//
// The editor holds more than Solidity now — generated app files (html, js,
// css, json) live in the same workspace. Monaco's CDN bundle already ships
// language services for all of these, so mapping by extension needs no extra
// grammar registration and no new dependency. Only "sol" is ours, registered
// as a Monarch tokenizer in SolidityEditor.
//
// Kept out of the component module so it can be imported without pulling in
// the editor (and so Fast Refresh keeps working there).

const LANGUAGE_BY_EXT: Record<string, string> = {
  sol: "sol",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  html: "html",
  htm: "html",
  css: "css",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  txt: "plaintext",
};

/** Falls back to plaintext so an unknown extension still opens in the editor
 *  rather than being unviewable. */
export function languageForPath(path: string): string {
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return LANGUAGE_BY_EXT[ext] ?? "plaintext";
}
