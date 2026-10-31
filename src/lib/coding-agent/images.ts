// Pictures the person attaches to a message: resized in the browser before
// they go anywhere, so a phone photo becomes a few hundred kilobytes, and
// turned into JPEG, which every model DevStation offers can read.

export interface Attachment {
  /** Sent to the agent: at most 1280 px on the long side. */
  full: string;
  /** Kept with the conversation in this browser: at most 240 px. */
  thumb: string;
}

export const MAX_ATTACHMENTS = 4;

async function draw(file: Blob, longSide: number, quality: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot read that picture.");
  // JPEG has no transparency: put a white page behind it.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export async function prepareImage(file: Blob): Promise<Attachment> {
  if (!file.type.startsWith("image/")) throw new Error("Only pictures can be attached.");
  if (file.size > 20 * 1024 * 1024) throw new Error("That picture is over 20 MB.");
  const [full, thumb] = await Promise.all([draw(file, 1280, 0.85), draw(file, 240, 0.7)]);
  return { full, thumb };
}

/** Image files from a paste or a drop. */
export function imagesFrom(items: DataTransferItemList | FileList | null): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items as ArrayLike<DataTransferItem | File>)) {
    const file = item instanceof File ? item : item.kind === "file" ? item.getAsFile() : null;
    if (file && file.type.startsWith("image/")) files.push(file);
  }
  return files;
}
