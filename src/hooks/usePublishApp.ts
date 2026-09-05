import { useCallback, useState } from "react";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useProjects, type AppProject } from "@/lib/appgen/projects";

// Publishing an app to a live URL.
//
// Extracted from the App Builder so the detail page can publish the same way
// rather than growing a second copy that drifts. Both callers hand it a
// project; nothing here reads the builder's active-project state.

export interface PublishResult {
  ok: boolean;
  url?: string;
  message?: string;
}

export function usePublishApp() {
  const { address: wallet } = useAccount();
  const [publishing, setPublishing] = useState(false);

  const publish = useCallback(
    async (project: AppProject): Promise<PublishResult> => {
      if (!wallet) {
        const message = "Connect a wallet: publishing is rate limited per wallet.";
        toast.error(message);
        return { ok: false, message };
      }
      // Publish what actually RUNS. For a Vite project that is the built
      // output, not the source: publishing src/app.js would put a page on the
      // internet that cannot load.
      const source = project.dist ?? project.files;
      if (!source || Object.keys(source).length === 0) {
        const message = "There is nothing to publish yet.";
        toast.error(message);
        return { ok: false, message };
      }

      setPublishing(true);
      try {
        const payload: Record<string, string> = {};
        for (const [path, content] of Object.entries(source)) {
          payload[path.replace(/^app\//, "")] = content;
        }

        // Prefer a DevStation subdomain: free, instant, and named after the
        // project. Netlify stays as the fallback for when the runner hosting
        // these is unreachable.
        const own = await fetch("/api/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: project.name || "app", files: payload, owner: wallet }),
        }).catch(() => null);

        if (own) {
          const body = (await own.json().catch(() => null)) as {
            ok?: boolean;
            url?: string;
            message?: string;
          } | null;
          if (body?.ok && body.url) {
            useProjects.getState().update(project.id, { liveUrl: body.url });
            toast.success("Published");
            return { ok: true, url: body.url };
          }
          // A name clash or an invalid name is the user's to resolve, not
          // something to silently work around by publishing somewhere else
          // under a different name.
          if (body?.message && own.status === 400) {
            toast.error(body.message);
            return { ok: false, message: body.message };
          }
        }

        const res = await fetch("/api/apps-deploy", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ files: payload, requesterAddress: wallet }),
        });
        const json = (await res.json()) as { ok: boolean; url?: string; message?: string };
        if (!json.ok) {
          toast.error(json.message ?? "Publish failed");
          return { ok: false, message: json.message };
        }
        if (json.url) useProjects.getState().update(project.id, { liveUrl: json.url });
        toast.success("Published");
        return { ok: true, url: json.url };
      } catch (e) {
        const message = e instanceof Error ? e.message : "Publish failed";
        toast.error(message);
        return { ok: false, message };
      } finally {
        setPublishing(false);
      }
    },
    [wallet],
  );

  /** Take a published app down. The subdomain becomes available again. */
  const unpublish = useCallback(
    async (project: AppProject): Promise<boolean> => {
      if (!wallet || !project.liveUrl) return false;
      const slug = project.liveUrl.replace(/^https?:\/\//, "").split(".")[0];
      const res = await fetch("/api/publish", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, owner: wallet }),
      }).catch(() => null);
      const ok = !!res && res.ok;
      if (ok) {
        useProjects.getState().update(project.id, { liveUrl: null });
        toast.success("Unpublished");
      } else {
        toast.error("Could not unpublish that app.");
      }
      return ok;
    },
    [wallet],
  );

  return { publish, unpublish, publishing };
}
