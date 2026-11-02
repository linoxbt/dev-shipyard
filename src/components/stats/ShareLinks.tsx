import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Link2, LoaderCircle, Plus } from "lucide-react";
import { toast } from "sonner";
import { fetchWithGrant } from "@/lib/agent-access/grant";
import { cn } from "@/lib/utils";
import { Table, when } from "./StatsDashboard";

// The admins' read-only links to the figures: make one (with a name saying
// who it is for), copy it, see when it was last opened, revoke it. Whoever
// has a link can view and export, nothing else (routes/api.stats.shared.ts).

interface Share {
  id: string;
  label: string;
  created_at: string;
  revoked_at: string | null;
  last_viewed_at: string | null;
  views: number;
  token: string | null;
}

const linkFor = (token: string) => `${window.location.origin}/stats/shared/${token}`;

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function ShareLinks() {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchWithGrant("/api/admin/stats?shares=1");
    const body = (await res.json().catch(() => ({}))) as { shares?: Share[] };
    setShares(res.ok ? (body.shares ?? []) : []);
  }, []);
  useEffect(() => void load(), [load]);

  const post = (payload: Record<string, unknown>) =>
    fetchWithGrant("/api/admin/stats", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

  const create = async () => {
    setBusy("new");
    const res = await post({ action: "create_share", label });
    const body = (await res.json().catch(() => ({}))) as { token?: string; message?: string };
    setBusy(null);
    if (!res.ok || !body.token)
      return void toast.error(body.message ?? "The link could not be made.");
    setLabel("");
    const ok = await copy(linkFor(body.token));
    toast.success(ok ? "Link made and copied." : "Link made. Copy it from the list.");
    void load();
  };

  const revoke = async (s: Share) => {
    setBusy(s.id);
    const res = await post({ action: "revoke_share", id: s.id });
    setBusy(null);
    if (!res.ok) return void toast.error("That link could not be revoked.");
    toast.success("Revoked. The link opens nothing now.");
    void load();
  };

  const copyLink = async (s: Share) => {
    if (!s.token) return;
    if (await copy(linkFor(s.token))) {
      setCopied(s.id);
      setTimeout(() => setCopied((c) => (c === s.id ? null : c)), 1500);
    } else toast.error("Copying is blocked here. Select the link instead.");
  };

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={80}
          placeholder="Who it is for (optional), e.g. Investors"
          className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-3 text-[13px] text-foreground outline-none placeholder:text-meta focus:border-primary/60"
        />
        <button
          type="submit"
          disabled={busy === "new"}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-primary px-3.5 text-[12.5px] font-medium text-primary-foreground transition hover:bg-primary-hover disabled:opacity-60"
        >
          {busy === "new" ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Make a link
        </button>
      </form>

      {shares === null ? (
        <p className="flex items-center gap-2 py-4 text-[12.5px] text-muted-foreground">
          <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> Loading links
        </p>
      ) : (
        <Table
          empty={shares.length === 0}
          head={[
            { label: "Link" },
            { label: "Made", right: true },
            { label: "Views", right: true },
            { label: "Last opened", right: true },
            { label: "", right: true },
          ]}
        >
          {shares.map((s) => {
            const live = !s.revoked_at;
            return (
              <tr key={s.id} className={cn(!live && "opacity-60")}>
                <td className="max-w-[260px]">
                  <span className="flex min-w-0 items-center gap-2">
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate text-foreground">{s.label || "Untitled link"}</span>
                    {!live && (
                      <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        Revoked
                      </span>
                    )}
                  </span>
                </td>
                <td className="whitespace-nowrap text-right text-muted-foreground">
                  {when(s.created_at)}
                </td>
                <td className="text-right tabular-nums">{s.views}</td>
                <td className="whitespace-nowrap text-right text-muted-foreground">
                  {s.last_viewed_at ? when(s.last_viewed_at) : "not yet"}
                </td>
                <td className="whitespace-nowrap text-right">
                  {live && (
                    <span className="inline-flex gap-1.5">
                      <button
                        onClick={() => void copyLink(s)}
                        disabled={!s.token}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-[12px] text-foreground transition hover:bg-surface-2 disabled:opacity-50"
                      >
                        {copied === s.id ? (
                          <Check className="h-3 w-3 text-success" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                        {copied === s.id ? "Copied" : "Copy"}
                      </button>
                      <button
                        onClick={() => void revoke(s)}
                        disabled={busy === s.id}
                        className="rounded-lg border border-border px-2.5 py-1 text-[12px] text-muted-foreground transition hover:border-danger/50 hover:text-danger disabled:opacity-60"
                      >
                        Revoke
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
