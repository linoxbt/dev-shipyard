import { createContext, useContext, useEffect, useState } from "react";

// Screenshots the agent took, for the chat: while the turn runs a step only
// knows the screenshot's name, so the picture is fetched from the workspace
// (whose id ShotSource provides); a saved turn already holds it as a data URL.

export const ShotSource = createContext<string | null>(null);

const cache = new Map<string, Promise<string | null>>();

function fetchShot(workspaceId: string, name: string): Promise<string | null> {
  const key = `${workspaceId}:${name}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = fetch(
      `/api/workspace?id=${encodeURIComponent(workspaceId)}&shot=${encodeURIComponent(name)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { data?: string } | null) => (b?.data ? `data:image/jpeg;base64,${b.data}` : null))
      .catch(() => null);
    cache.set(key, hit);
    // A miss is retried next time (the file may not have been written yet).
    void hit.then((v) => v === null && cache.delete(key));
  }
  return hit;
}

/** The picture for a screenshot, from its data URL or by its name. */
export function useShot(shot: string | undefined): string | null {
  const workspaceId = useContext(ShotSource);
  const [src, setSrc] = useState<string | null>(shot?.startsWith("data:") ? shot : null);
  useEffect(() => {
    if (!shot) return setSrc(null);
    if (shot.startsWith("data:")) return setSrc(shot);
    if (!workspaceId) return;
    let alive = true;
    void fetchShot(workspaceId, shot).then((v) => alive && setSrc(v));
    return () => {
      alive = false;
    };
  }, [shot, workspaceId]);
  return src;
}
