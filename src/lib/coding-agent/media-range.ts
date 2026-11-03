// The byte ranges a shared file travels in. A function's answer is capped at
// about 4.5 MB, so no answer carries more than MEDIA_CHUNK bytes; players ask
// for the rest by themselves, and downloads are joined in the browser.

export const MEDIA_CHUNK = 4 * 1024 * 1024;

/**
 * The range to ask the project's machine for, given the browser's Range
 * header: the same start, at most MEDIA_CHUNK bytes. No header asks for the
 * start of the file. Null for a header that cannot be served this way (a
 * suffix range, or several ranges).
 */
export function mediaRange(header: string | null | undefined): string | null {
  if (!header) return `bytes=0-${MEDIA_CHUNK - 1}`;
  const m = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const start = Number(m[1]);
  const last = start + MEDIA_CHUNK - 1;
  const end = m[2] ? Math.min(Number(m[2]), last) : last;
  if (end < start) return null;
  return `bytes=${start}-${end}`;
}

/** The ranges a download of `size` bytes is fetched in. */
export function downloadRanges(size: number): string[] {
  const out: string[] = [];
  for (let start = 0; start < size; start += MEDIA_CHUNK) {
    out.push(`bytes=${start}-${Math.min(size, start + MEDIA_CHUNK) - 1}`);
  }
  return out;
}
