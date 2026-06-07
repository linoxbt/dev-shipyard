import { createFileRoute } from "@tanstack/react-router";
import { BookOpen, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ComingSoon } from "@/components/shared/ComingSoon";

export const Route = createFileRoute("/docs")({
  head: () => ({ meta: [{ title: "Docs — DevStation" }] }),
  component: DocsPage,
});

function DocsPage() {
  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Docs"]}
        title="Documentation"
        subtitle="Guides for LaunchKit, Routebook, and the QIE network."
      />
      <div className="p-6">
        <ComingSoon
          icon={BookOpen}
          title="Docs are coming soon"
          note="In-app guides for deploying contracts, decoding transactions, and using the AI assistant are on the way. For now, see the official QIE documentation."
        >
          <a
            href="https://docs.qie.digital"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded border border-primary px-3 py-1.5 font-mono text-xs text-primary hover:bg-primary/10"
          >
            Official QIE Docs <ExternalLink className="h-3 w-3" />
          </a>
        </ComingSoon>
      </div>
    </div>
  );
}
