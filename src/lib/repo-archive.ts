import { gunzipSync } from "node:zlib";

// Reading a repository the way GitHub hands it over.
//
// One request for a tarball beats walking the tree API and fetching a blob per
// file, both for latency and for rate limits. The catch is that `git archive`
// output is not the simple ustar the runner's own packer writes: long paths
// arrive as pax extended headers, older archives use GNU long-name records,
// and everything sits under a top-level `owner-repo-sha/` directory. A reader
// that ignores those silently truncates paths, which would land a file in the
// wrong place in a pull request. So all three are handled here.
//
// This produces a file map rather than a checkout on purpose. The agent's
// workspace never contains a git credential, which is what keeps pushing the
// person's action rather than the agent's: the change comes back as edited
// files, and the signed-in session commits them.

const BLOCK = 512;

export interface ArchiveEntry {
  path: string;
  content: Buffer;
}

function octal(field: Buffer): number {
  const text = field.toString("utf8").replace(/\0.*$/, "").trim();
  return text ? (parseInt(text, 8) ?? 0) : 0;
}

/** Pull the path out of a pax extended header record block. */
function paxPath(block: Buffer): string | null {
  // Records are "<length> <key>=<value>\n", length counting the whole record.
  const text = block.toString("utf8");
  const match = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text);
  return match ? match[1] : null;
}

export function readTar(buf: Buffer): ArchiveEntry[] {
  const out: ArchiveEntry[] = [];
  let offset = 0;
  // Set by a preceding pax or GNU long-name record, consumed by the next file.
  let pendingName: string | null = null;

  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    const rawName = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const type = String.fromCharCode(header[156]);
    if (!rawName && type !== "x" && type !== "g" && type !== "L") break; // end of archive

    const size = octal(header.subarray(124, 136));
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    offset += BLOCK;
    const body = buf.subarray(offset, offset + size);
    offset += Math.ceil(size / BLOCK) * BLOCK;

    if (type === "x") {
      // Applies to the next entry only.
      pendingName = paxPath(body);
      continue;
    }
    if (type === "g") continue; // global header: not about any one file
    if (type === "L") {
      pendingName = body.toString("utf8").replace(/\0.*$/, "");
      continue;
    }

    const path = pendingName ?? (prefix ? `${prefix}/${rawName}` : rawName);
    pendingName = null;

    // Regular files only. Directories, symlinks and hard links are not content
    // the agent can edit, and a symlink is a way out of the workspace.
    if (type === "0" || type === "\0") out.push({ path, content: Buffer.from(body) });
  }
  return out;
}

export function readTarGz(buf: Buffer): ArchiveEntry[] {
  // GitHub sends gzip; a caller that has already decompressed should still work.
  const gzipped = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
  return readTar(gzipped ? gunzipSync(buf) : buf);
}

/** Drop the `owner-repo-sha/` wrapper GitHub puts around everything. */
export function stripTopLevel(entries: ArchiveEntry[]): ArchiveEntry[] {
  const first = entries[0]?.path.split("/")[0];
  if (!first) return entries;
  if (!entries.every((e) => e.path.startsWith(`${first}/`))) return entries;
  return entries.map((e) => ({ ...e, content: e.content, path: e.path.slice(first.length + 1) }));
}

export interface RepoFiles {
  files: Record<string, string>;
  /** Paths that are in the repository but were not handed to the agent, with
   *  the reason. Reported rather than dropped: an agent that cannot see a file
   *  should not be told the repository does not contain it. */
  skipped: Array<{ path: string; why: string }>;
  bytes: number;
}

export interface ArchiveLimits {
  maxFiles?: number;
  maxBytes?: number;
  maxFileBytes?: number;
}

const DEFAULTS: Required<ArchiveLimits> = {
  maxFiles: 4000,
  maxBytes: 25 * 1024 * 1024,
  maxFileBytes: 1024 * 1024,
};

function isBinary(content: Buffer): boolean {
  const window = content.subarray(0, 8192);
  return window.includes(0);
}

/** Ignored wholesale: nothing here is source, and .git in particular would let
 *  a repository's own packed objects count against the size budget. */
const IGNORED = [/^\.git\//, /(^|\/)node_modules\//, /(^|\/)\.next\//, /(^|\/)dist\//];

export function filesFromArchive(
  entries: ArchiveEntry[],
  limits: ArchiveLimits = {},
): RepoFiles | { error: string } {
  const { maxFiles, maxBytes, maxFileBytes } = { ...DEFAULTS, ...limits };
  const files: Record<string, string> = {};
  const skipped: Array<{ path: string; why: string }> = [];
  let bytes = 0;
  let count = 0;

  for (const entry of stripTopLevel(entries)) {
    if (!entry.path || entry.path.endsWith("/")) continue;
    if (IGNORED.some((r) => r.test(entry.path))) continue;
    // A path that climbs out of the tree has no business in a workspace,
    // whatever produced the archive.
    if (entry.path.startsWith("/") || entry.path.split("/").includes("..")) {
      skipped.push({ path: entry.path, why: "the path leaves the repository" });
      continue;
    }

    if (entry.content.length > maxFileBytes) {
      skipped.push({ path: entry.path, why: `larger than ${maxFileBytes} bytes` });
      continue;
    }
    if (isBinary(entry.content)) {
      skipped.push({ path: entry.path, why: "binary" });
      continue;
    }

    count++;
    bytes += entry.content.length;
    if (count > maxFiles) {
      return {
        error: `This repository has more than ${maxFiles} text files, which is more than the agent can hold at once.`,
      };
    }
    if (bytes > maxBytes) {
      return {
        error: `This repository's text is larger than ${Math.round(maxBytes / 1024 / 1024)} MB, which is more than the agent can hold at once.`,
      };
    }
    files[entry.path] = entry.content.toString("utf8");
  }

  return { files, skipped, bytes };
}
