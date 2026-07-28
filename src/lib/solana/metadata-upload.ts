// Upload an NFT/token image + Metaplex metadata JSON to the DevStation build
// server (VITE_SOLANA_BUILD_API /upload). Returns a short metadata URL usable as
// the on-chain `uri` (Metaplex caps uri at 200 chars, so a hosted URL is
// required — a data: URI won't fit).

function endpoint(): string | null {
  const raw = import.meta.env.VITE_SOLANA_BUILD_API;
  return raw ? raw.replace(/\/$/, "") : null;
}

export function metadataUploadEnabled(): boolean {
  return endpoint() !== null;
}

export interface UploadMetadataParams {
  name: string;
  symbol: string;
  description?: string;
  imageFile?: File | null;
  /** Fallback image URL when no file is uploaded. */
  imageUrl?: string;
  attributes?: Array<{ trait_type: string; value: string }>;
}

export async function uploadTokenMetadata(
  p: UploadMetadataParams,
): Promise<{ metadataUrl: string; imageUrl: string | null }> {
  const api = endpoint();
  if (!api) {
    throw new Error("No upload backend configured. Set VITE_SOLANA_BUILD_API, or paste a metadata URL.");
  }
  const fd = new FormData();
  fd.append("name", p.name);
  fd.append("symbol", p.symbol);
  fd.append("description", p.description ?? "");
  if (p.attributes) fd.append("attributes", JSON.stringify(p.attributes));
  if (p.imageFile) fd.append("image", p.imageFile);
  else if (p.imageUrl) fd.append("image", p.imageUrl);

  let res: Response;
  try {
    const token = import.meta.env.VITE_SOLANA_BUILD_TOKEN;
    res = await fetch(`${api}/upload`, {
      method: "POST",
      body: fd,
      headers: token ? { authorization: `Bearer ${token}` } : undefined,
    });
  } catch {
    throw new Error("Upload backend unreachable. Check VITE_SOLANA_BUILD_API.");
  }
  if (!res.ok) throw new Error(`Metadata upload failed (${res.status}).`);
  const d = (await res.json()) as { metadataUrl?: string; imageUrl?: string };
  if (!d.metadataUrl) throw new Error("Upload returned no metadata URL.");
  return { metadataUrl: d.metadataUrl, imageUrl: d.imageUrl ?? null };
}
