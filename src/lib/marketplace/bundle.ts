// A listing's files, and the one hash that identifies them.
//
// The marketplace contract stores `contentHash`; DevStation's server stores
// the files and refuses an upload whose hash does not match the chain. The
// hash therefore has to come out identical in the browser that publishes, the
// server that checks, and the buyer who verifies what they downloaded. It is
// computed over a canonical form: files sorted by path, as JSON, as UTF-8,
// then SHA-256. Key order in an object is not canonical, so it is never
// hashed directly.
//
// Web Crypto only, no Node imports: this file runs in the browser, in Bun and
// on the runner.

export type Bundle = Record<string, string>;

/** The same ceilings as a published app, so anything that can be built and
 *  published can also be sold. */
export const MAX_BUNDLE_FILES = 200;
export const MAX_BUNDLE_BYTES = 10 * 1024 * 1024;
const MAX_PATH_LENGTH = 200;

export function canonicalBundle(files: Bundle): string {
  const paths = Object.keys(files).sort();
  return JSON.stringify(paths.map((path) => [path, files[path]]));
}

export async function bundleHash(files: Bundle): Promise<`0x${string}`> {
  const bytes = new TextEncoder().encode(canonicalBundle(files));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `0x${Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function bundleBytes(files: Bundle): number {
  let total = 0;
  const encoder = new TextEncoder();
  for (const [path, content] of Object.entries(files)) {
    total += encoder.encode(path).length + encoder.encode(content).length;
  }
  return total;
}

/** Why these files cannot be listed, or null when they can.
 *
 *  Paths are checked here as well as on the server because a buyer's browser
 *  writes them into an App Builder project: a path like `../x` must never get
 *  that far. */
export function bundleProblem(files: unknown): string | null {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    return "Files must be a map of path to text.";
  }
  const entries = Object.entries(files as Record<string, unknown>);
  if (entries.length === 0) return "Add at least one file.";
  if (entries.length > MAX_BUNDLE_FILES) {
    return `At most ${MAX_BUNDLE_FILES} files per listing.`;
  }
  for (const [path, content] of entries) {
    if (typeof content !== "string") return `${path} is not text.`;
    if (
      !path ||
      path.length > MAX_PATH_LENGTH ||
      path.startsWith("/") ||
      path.includes("\\") ||
      path.includes("\0") ||
      path.split("/").some((part) => part === ".." || part === "." || part === "")
    ) {
      return `"${path}" is not a safe relative file path.`;
    }
  }
  if (bundleBytes(files as Bundle) > MAX_BUNDLE_BYTES) {
    return "Listings are limited to 10 MB of files.";
  }
  return null;
}
