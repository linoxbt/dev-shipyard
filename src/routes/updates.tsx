import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { PageShell } from "@/components/coding-agent/PageShell";
import { UpdatesBody } from "@/components/coding-agent/sheets";
import { useAuth } from "@/hooks/useAuth";
import { useProjects } from "@/lib/appgen/projects";

// Updates, as a page: the latest work on your projects, and what is new on
// DevStation.

export const Route = createFileRoute("/updates")({
  head: () => ({
    meta: [{ title: "Updates · DevStation" }, { name: "robots", content: "noindex" }],
  }),
  component: UpdatesPage,
});

function UpdatesPage() {
  const projects = useProjects((s) => s.projects);
  useEffect(() => {
    useAuth.getState().init();
    void useProjects.getState().hydrate();
  }, []);
  return (
    <PageShell title="Updates" description="The latest work on your projects, and what is new.">
      <UpdatesBody
        projects={projects}
        onOpen={(id) => window.location.assign(`/?project=${encodeURIComponent(id)}`)}
      />
    </PageShell>
  );
}
