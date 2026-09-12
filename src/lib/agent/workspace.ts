import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// The only thing allowed to touch a real filesystem, and the boundary that
// says where "the project" ends.
//
// The check resolves symlinks on BOTH sides before comparing. Comparing a
// resolved root against an unresolved target is the usual mistake: a symlink
// inside the workspace pointing at /etc passes a string-prefix test and fails
// this one. Rejecting "../" is not a boundary, it is a spelling rule.
//
// Two refusals live here rather than in the individual tools, because a guard
// each tool has to remember is a guard that one of them will forget.

/** Files whose contents must never reach a model. Refused, not redacted: a
 *  redacted secret still tells the model the file exists and what shape it is,
 *  and a partial redaction that misses one line is worse than a clean no. */
const SECRET_PATTERNS: RegExp[] = [
  /(^|\/)\.env($|\.|-)/i,
  /\.pem$/i,
  /\.key$/i,
  /(^|\/)id_rsa/i,
  /(^|\/)id_ed25519/i,
  /(^|\/)\.npmrc$/i,
  /(^|\/)credentials(\.json)?$/i,
  /(^|\/)\.git-credentials$/i,
];

/** How much of a file to sniff for a null byte. The standard heuristic, and
 *  cheap: a text file will not have one in its first few KB. */
const SNIFF_BYTES = 8192;

export type Resolved = { ok: true; absolute: string } | { ok: false; reason: string };
export type ReadResult = { ok: true; content: string } | { ok: false; reason: string };

export function looksLikeSecret(relativePath: string): boolean {
  const normalised = relativePath.replace(/\\/g, "/");
  return SECRET_PATTERNS.some((re) => re.test(normalised));
}

/** True when a buffer is not text this agent should be handing to a model. */
export function looksBinary(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, SNIFF_BYTES);
  for (let i = 0; i < end; i++) if (buffer[i] === 0) return true;
  return false;
}

/**
 * Resolve a path that may not exist yet.
 *
 * `realpath` throws on a missing file, but a write to a new file still has to
 * be bounds-checked. So this walks up to the nearest ancestor that does exist,
 * resolves THAT, and re-appends the rest, which keeps the symlink resolution
 * honest for the part of the path that is real.
 */
function realpathAllowingMissing(target: string): string {
  let current = resolve(target);
  const trailing: string[] = [];
  for (;;) {
    if (existsSync(current)) return join(realpathSync(current), ...trailing.reverse());
    const parent = dirname(current);
    // Reached the filesystem root without finding anything that exists.
    if (parent === current) return resolve(target);
    trailing.push(current.slice(parent.length + 1));
    current = parent;
  }
}

export class Workspace {
  /** The canonical root. Resolved once, so every comparison is against a path
   *  that has already had its own symlinks followed. */
  readonly root: string;

  constructor(root: string) {
    this.root = realpathSync(resolve(root));
  }

  /** Turn a caller-supplied path into an absolute one inside the workspace, or
   *  say why it cannot be. */
  resolve(relativePath: string): Resolved {
    if (!relativePath || typeof relativePath !== "string") {
      return { ok: false, reason: "No path was given." };
    }
    if (isAbsolute(relativePath)) {
      return { ok: false, reason: `Absolute paths are not allowed: ${relativePath}` };
    }
    const absolute = realpathAllowingMissing(join(this.root, relativePath));
    if (absolute !== this.root && !absolute.startsWith(this.root + sep)) {
      return {
        ok: false,
        reason: `${relativePath} resolves outside the workspace and was refused.`,
      };
    }
    return { ok: true, absolute };
  }

  /** The path as the model should see it: relative, forward slashes. */
  relative(absolute: string): string {
    return relative(this.root, absolute).split(sep).join("/");
  }

  read(relativePath: string): ReadResult {
    if (looksLikeSecret(relativePath)) {
      // Said out loud on purpose. A silent empty result makes the model retry
      // the same read a different way; a reason makes it stop.
      return {
        ok: false,
        reason: `${relativePath} looks like a credentials file, so it was not read. Ask the user for anything you need from it.`,
      };
    }
    const resolved = this.resolve(relativePath);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    if (!existsSync(resolved.absolute)) {
      return { ok: false, reason: `There is no file at ${relativePath}.` };
    }
    if (statSync(resolved.absolute).isDirectory()) {
      return { ok: false, reason: `${relativePath} is a directory, not a file.` };
    }
    const buffer = readFileSync(resolved.absolute);
    if (looksBinary(buffer)) {
      // Decoding this as UTF-8 would hand the model mangled bytes that look
      // like file contents, which is worse than refusing.
      return {
        ok: false,
        reason: `${relativePath} is a binary file (${buffer.length} bytes), not readable as text.`,
      };
    }
    return { ok: true, content: buffer.toString("utf8") };
  }

  write(relativePath: string, content: string): { ok: true } | { ok: false; reason: string } {
    if (looksLikeSecret(relativePath)) {
      return {
        ok: false,
        reason: `${relativePath} looks like a credentials file and was not written.`,
      };
    }
    const resolved = this.resolve(relativePath);
    if (!resolved.ok) return { ok: false, reason: resolved.reason };
    if (existsSync(resolved.absolute)) {
      if (statSync(resolved.absolute).isDirectory()) {
        return { ok: false, reason: `${relativePath} is a directory.` };
      }
      if (looksBinary(readFileSync(resolved.absolute))) {
        return { ok: false, reason: `${relativePath} is a binary file and was not overwritten.` };
      }
    }
    mkdirSync(dirname(resolved.absolute), { recursive: true });
    writeFileSync(resolved.absolute, content, "utf8");
    return { ok: true };
  }

  exists(relativePath: string): boolean {
    const resolved = this.resolve(relativePath);
    return resolved.ok && existsSync(resolved.absolute);
  }

  /** Every text file in the workspace, relative and sorted. Skips the places
   *  that are never the project: dependency trees, build output, git internals. */
  /** `limit` stops the walk once that many files are found, so a caller that
   *  can only use a screenful is not made to wait for half a million. */
  list(subdir = ".", limit = Number.POSITIVE_INFINITY): string[] {
    // The root itself is a legitimate target, and resolve() rejects an empty
    // path, so it is handled here rather than by loosening that guard.
    const base =
      subdir === "." || subdir === ""
        ? { ok: true as const, absolute: this.root }
        : this.resolve(subdir);
    if (!base.ok || !existsSync(base.absolute)) return [];
    const resolved = base;
    const skip = new Set(["node_modules", ".git", "dist", ".next", ".output", "build", ".venv"]);
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= limit) return;
        if (entry.name.startsWith(".") && skip.has(entry.name)) continue;
        if (skip.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) out.push(this.relative(full));
      }
    };
    walk(resolved.absolute);
    return out.sort();
  }
}
