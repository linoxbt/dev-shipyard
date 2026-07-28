// Option 2 — remote Anchor/Rust build. Sends program source to an external
// Solana-Playground-style build service (VITE_SOLANA_BUILD_API) and returns the
// compiled .so + IDL for client-side deployment. There is no in-browser Rust
// compiler, so arbitrary-program builds require this service. It degrades
// gracefully: when unconfigured or unreachable, callers get a clear message and
// token/NFT/prebuilt-program deploys keep working.

export interface BuildResult {
  soBytes: Uint8Array;
  idl?: unknown;
  programName?: string;
}

/** Optional shared secret for a publicly-reachable build server. */
function authHeaders(): Record<string, string> {
  const token = import.meta.env.VITE_SOLANA_BUILD_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function endpoint(): string | null {
  const raw = import.meta.env.VITE_SOLANA_BUILD_API;
  return raw ? raw.replace(/\/$/, "") : null;
}

export function isRemoteBuildEnabled(): boolean {
  return endpoint() !== null;
}

export async function buildProgram(source: string, kind: "anchor" | "native"): Promise<BuildResult> {
  const api = endpoint();
  if (!api) {
    throw new Error(
      "Custom-program compilation isn't configured. Set VITE_SOLANA_BUILD_API to a build service, or deploy a token/NFT or a prebuilt program template instead.",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${api}/build`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ source, kind }),
    });
  } catch {
    throw new Error("The Anchor/Rust build service is unreachable right now. Try again later, or deploy a token/NFT / prebuilt program.");
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Build failed (${res.status}). ${detail.slice(0, 300)}`);
  }

  const data = (await res.json()) as { so?: string; idl?: unknown; name?: string; error?: string };
  if (data.error) throw new Error(`Build error: ${data.error}`);
  if (!data.so) throw new Error("Build service returned no program binary.");

  const soBytes = Uint8Array.from(atob(data.so), (c) => c.charCodeAt(0));
  return { soBytes, idl: data.idl, programName: data.name };
}
