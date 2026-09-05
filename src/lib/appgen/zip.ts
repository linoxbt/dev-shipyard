// A minimal ZIP writer for downloading a generated app.
//
// Stored (uncompressed) entries only. That is a deliberate trade: a generated
// app is a handful of small text files, so compression would save little, and
// a dependency-free ~70 lines is easier to audit than pulling a compression
// library into the bundle for one button. Every unzip tool reads stored
// entries: it is the original, universally supported ZIP mode.

const encoder = new TextEncoder();

// CRC-32, table built once on first use.
let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[i] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

interface Entry {
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc: number;
  offset: number;
}

function u16(v: number): number[] {
  return [v & 0xff, (v >> 8) & 0xff];
}
function u32(v: number): number[] {
  return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
}

/** Build a ZIP archive from path → text content. */
export function createZip(files: Record<string, string>): Uint8Array {
  const entries: Entry[] = [];
  const chunks: number[] = [];
  const push = (arr: number[] | Uint8Array) => {
    for (let i = 0; i < arr.length; i++) chunks.push(arr[i]);
  };

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);
    const offset = chunks.length;
    // Local file header. Version 2.0, no flags, method 0 (stored), no date.
    push(u32(0x04034b50));
    push(u16(20));
    push(u16(0));
    push(u16(0));
    push(u16(0)); // time
    push(u16(0)); // date
    push(u32(crc));
    push(u32(data.length));
    push(u32(data.length));
    push(u16(nameBytes.length));
    push(u16(0));
    push(nameBytes);
    push(data);
    entries.push({ nameBytes, data, crc, offset });
  }

  const centralStart = chunks.length;
  for (const e of entries) {
    push(u32(0x02014b50));
    push(u16(20)); // version made by
    push(u16(20)); // version needed
    push(u16(0));
    push(u16(0)); // method: stored
    push(u16(0));
    push(u16(0));
    push(u32(e.crc));
    push(u32(e.data.length));
    push(u32(e.data.length));
    push(u16(e.nameBytes.length));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u16(0));
    push(u32(0));
    push(u32(e.offset));
    push(e.nameBytes);
  }
  const centralSize = chunks.length - centralStart;

  // End of central directory.
  push(u32(0x06054b50));
  push(u16(0));
  push(u16(0));
  push(u16(entries.length));
  push(u16(entries.length));
  push(u32(centralSize));
  push(u32(centralStart));
  push(u16(0));

  return new Uint8Array(chunks);
}

/** Build the archive and hand it to the browser as a download. */
export async function downloadZip(files: Record<string, string>, filename: string): Promise<void> {
  const zip = createZip(files);
  const blob = new Blob([zip as unknown as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    // Safari ignores a click on a link that is not in the document.
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
