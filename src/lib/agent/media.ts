import { randomBytes } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, extname, join } from "node:path";
import { isControlPath, looksLikeSecret, type Workspace } from "./workspace";

// Files the agent hands to the person in the chat: a video it rendered, a
// voice-over, an image, a PDF, a zip. The share_file tool keeps a copy under
// .devstation/media (a hard link when it can, so a large video costs no
// space), named by an id, so the chat can play or download it later even if
// the project's own copy is rebuilt or deleted. Nothing is published.

export const MEDIA_DIR = ".devstation/media";

export type MediaKind = "video" | "audio" | "image" | "pdf" | "file";

/** What the chat knows about a shared file. */
export interface SharedMedia {
  id: string;
  name: string;
  size: number;
  /** Its content type, as it is served. */
  type: string;
  kind: MediaKind;
  caption?: string;
}

/** The largest file the agent can share. */
export const MAX_MEDIA_BYTES = 1024 * 1024 * 1024;
/** Shared files a project keeps; the oldest go first. */
const KEEP = 40;

export const MEDIA_ID = /^media-[a-z0-9]{6,40}$/;

const TYPES: Record<string, [MediaKind, string]> = {
  ".mp4": ["video", "video/mp4"],
  ".m4v": ["video", "video/mp4"],
  ".webm": ["video", "video/webm"],
  ".mov": ["video", "video/quicktime"],
  ".ogv": ["video", "video/ogg"],
  ".mp3": ["audio", "audio/mpeg"],
  ".wav": ["audio", "audio/wav"],
  ".ogg": ["audio", "audio/ogg"],
  ".oga": ["audio", "audio/ogg"],
  ".opus": ["audio", "audio/ogg"],
  ".m4a": ["audio", "audio/mp4"],
  ".aac": ["audio", "audio/aac"],
  ".flac": ["audio", "audio/flac"],
  ".png": ["image", "image/png"],
  ".jpg": ["image", "image/jpeg"],
  ".jpeg": ["image", "image/jpeg"],
  ".gif": ["image", "image/gif"],
  ".webp": ["image", "image/webp"],
  ".avif": ["image", "image/avif"],
  ".svg": ["image", "image/svg+xml"],
  ".pdf": ["pdf", "application/pdf"],
  ".zip": ["file", "application/zip"],
  ".csv": ["file", "text/csv"],
  ".json": ["file", "application/json"],
  ".txt": ["file", "text/plain"],
  ".md": ["file", "text/markdown"],
};

/** What a file is, from its name. Anything unknown is a plain download. */
export function mediaType(name: string): { kind: MediaKind; type: string } {
  const hit = TYPES[extname(name).toLowerCase()];
  return hit ? { kind: hit[0], type: hit[1] } : { kind: "file", type: "application/octet-stream" };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

type Shared = { ok: true; media: SharedMedia; output: string } | { ok: false; output: string };

/** Share a file in the project with the person, in the chat. */
export function shareFile(workspace: Workspace, path: string, caption?: string): Shared {
  if (typeof path !== "string" || !path.trim()) return { ok: false, output: "No path was given." };
  if (looksLikeSecret(path) || isControlPath(path)) {
    return { ok: false, output: `${path} is not a file that can be shared.` };
  }
  const resolved = workspace.resolve(path);
  if (!resolved.ok) return { ok: false, output: resolved.reason };
  if (!existsSync(resolved.absolute)) return { ok: false, output: `There is no file at ${path}.` };
  const stat = statSync(resolved.absolute);
  if (!stat.isFile()) return { ok: false, output: `${path} is not a file.` };
  if (stat.size === 0) return { ok: false, output: `${path} is empty.` };
  if (stat.size > MAX_MEDIA_BYTES) {
    return {
      ok: false,
      output: `${path} is ${formatBytes(stat.size)}, over the ${formatBytes(MAX_MEDIA_BYTES)} a shared file can be. Make a smaller export.`,
    };
  }

  const name = basename(resolved.absolute).slice(0, 120);
  const { kind, type } = mediaType(name);
  const id = `media-${Date.now().toString(36)}${randomBytes(4).toString("hex")}`;
  const dir = join(workspace.root, MEDIA_DIR);
  mkdirSync(dir, { recursive: true });
  const stored = join(dir, id);
  try {
    linkSync(resolved.absolute, stored);
  } catch {
    copyFileSync(resolved.absolute, stored);
  }
  const media: SharedMedia = {
    id,
    name,
    size: stat.size,
    type,
    kind,
    ...(caption?.trim() ? { caption: caption.trim().slice(0, 300) } : {}),
  };
  writeFileSync(`${stored}.json`, JSON.stringify(media));
  prune(dir);
  return {
    ok: true,
    media,
    output: `Shared ${name} (${formatBytes(stat.size)}) in the chat. The person can ${
      kind === "video" || kind === "audio" ? "play" : "open"
    } it there and download it. It does not need to be published for them to see it.`,
  };
}

function prune(dir: string): void {
  const entries = readdirSync(dir)
    .filter((f) => MEDIA_ID.test(f))
    .sort();
  for (const old of entries.slice(0, Math.max(0, entries.length - KEEP))) {
    rmSync(join(dir, old), { force: true });
    rmSync(join(dir, `${old}.json`), { force: true });
  }
}

/** A shared file, to serve: where it is and what it is. */
export function sharedFile(root: string, id: string): { path: string; media: SharedMedia } | null {
  if (!MEDIA_ID.test(id)) return null;
  const path = join(root, MEDIA_DIR, id);
  try {
    const media = JSON.parse(readFileSync(`${path}.json`, "utf8")) as SharedMedia;
    const size = statSync(path).size;
    return { path, media: { ...media, size } };
  } catch {
    return null;
  }
}

/** A Range header's bytes within a file of `size`, or null when it asks for
 *  none of it. Only a single range is honoured. */
export function byteRange(
  header: string | undefined | null,
  size: number,
): { start: number; end: number } | null | "unsatisfiable" {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number;
  let end: number;
  if (!m[1]) {
    // The last N bytes.
    const n = Number(m[2]);
    if (n === 0) return "unsatisfiable";
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  }
  if (start >= size || end < start) return "unsatisfiable";
  return { start, end };
}
