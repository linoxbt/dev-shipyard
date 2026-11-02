import { fetchWithGrant } from "@/lib/agent-access/grant";

// The browser's side of /api/workspace, shared by the Coding Agent page and
// its dialogs.

export async function postWorkspace(body: unknown): Promise<{
  ok: boolean;
  status: number;
  data: Record<string, unknown>;
}> {
  const res = await fetchWithGrant("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, status: 0, data: { message: "Could not reach DevStation." } };
  const data = ((await res.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { ok: res.ok && data.ok !== false, status: res.status, data };
}

/** Read a workspace (or its files, preview or a screenshot with `extra`),
 *  renewing the session once if it has lapsed. Null when unreachable. */
export async function getWorkspace(id: string, extra = ""): Promise<Response | null> {
  return fetchWithGrant(
    `/api/workspace?id=${encodeURIComponent(id)}${extra ? `&${extra}` : ""}`,
  ).catch(() => null);
}

export function slugOf(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "my-app"
  );
}
