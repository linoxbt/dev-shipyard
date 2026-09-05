// Minimal tar reader/writer.
//
// Docker cp speaks tar on stdin/stdout, which is how files reach a job and how
// build output comes back, without ever mounting a host path into a container
// running model-written code. Only the ustar basics are needed here, so this is
// ~100 lines rather than a dependency.

const BLOCK = 512;

function pad(value: string, len: number): Buffer {
  const b = Buffer.alloc(len);
  b.write(value.slice(0, len - 1), "utf8");
  return b;
}

function octal(value: number, len: number): Buffer {
  return pad(value.toString(8).padStart(len - 1, "0"), len);
}

/** Build a tar archive from path -> contents. */
export function packTar(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  for (const [path, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8");
    const header = Buffer.alloc(BLOCK);
    pad(path, 100).copy(header, 0);
    octal(0o644, 8).copy(header, 100); // mode
    octal(1000, 8).copy(header, 108); // uid
    octal(1000, 8).copy(header, 116); // gid
    octal(data.length, 12).copy(header, 124);
    octal(Math.floor(Date.now() / 1000), 12).copy(header, 136);
    header.write("0", 156); // type: regular file
    header.write("ustar\0", 257);
    header.write("00", 263);
    // Checksum is computed with the checksum field itself read as spaces.
    header.fill(" ", 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    pad(sum.toString(8).padStart(6, "0") + "\0 ", 8).copy(header, 148);

    parts.push(header, data);
    const remainder = data.length % BLOCK;
    if (remainder !== 0) parts.push(Buffer.alloc(BLOCK - remainder));
  }
  parts.push(Buffer.alloc(BLOCK * 2)); // end-of-archive
  return Buffer.concat(parts);
}

export interface TarEntry {
  path: string;
  content: Buffer;
}

/** Read a tar archive. Ignores anything that is not a regular file. */
export function unpackTar(buf: Buffer): TarEntry[] {
  const out: TarEntry[] = [];
  let offset = 0;
  while (offset + BLOCK <= buf.length) {
    const header = buf.subarray(offset, offset + BLOCK);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    if (!name) break; // end-of-archive
    const sizeField = header.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim();
    const size = parseInt(sizeField, 8) || 0;
    const type = String.fromCharCode(header[156]);
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    offset += BLOCK;
    if (type === "0" || type === "\0") {
      out.push({
        path: prefix ? `${prefix}/${name}` : name,
        content: buf.subarray(offset, offset + size),
      });
    }
    offset += Math.ceil(size / BLOCK) * BLOCK;
  }
  return out;
}
