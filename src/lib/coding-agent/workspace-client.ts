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
