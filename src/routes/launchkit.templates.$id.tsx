import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Rocket, ChevronDown, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { getTemplate, categoryColor } from "@/lib/mock/templates";

export const Route = createFileRoute("/launchkit/templates/$id")({
  loader: ({ params }) => {
    const tpl = getTemplate(params.id);
    if (!tpl) throw notFound();
    return { tpl };
  },
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.tpl ? `${loaderData.tpl.name} — DevStation` : "Template — DevStation" },
      { name: "description", content: loaderData?.tpl?.description ?? "Contract template" },
    ],
  }),
  component: TemplateDetail,
});

function TemplateDetail() {
  const { tpl } = Route.useLoaderData();
  const [abiOpen, setAbiOpen] = useState(false);
  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Templates", tpl.name]}
        title={tpl.name}
        subtitle={tpl.description}
        action={
          <div className="flex items-center gap-2">
            <Link
              to="/launchkit/templates"
              className="flex items-center gap-1 rounded border border-border px-2.5 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              <ArrowLeft className="h-3 w-3" /> Back
            </Link>
            <Link
              to="/launchkit/deploy"
              search={{ template: tpl.id }}
              className="flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
            >
              <Rocket className="h-3 w-3" /> Deploy This Template
            </Link>
          </div>
        }
      />
      <div className="grid gap-6 p-6 lg:grid-cols-5">
        <aside className="space-y-4 lg:col-span-2">
          <div className="rounded border border-border bg-surface p-4">
            <div className="mb-3 flex items-center gap-2">
              <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${categoryColor(tpl.category)}`}>
                {tpl.category}
              </span>
              {tpl.verified && (
                <span className="font-mono text-[10px] text-success">✓ VERIFIED</span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">{tpl.longDescription}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 font-mono text-xs">
              <Meta label="Author" value={tpl.author} />
              <Meta label="Version" value={tpl.version} />
              <Meta label="Deploys" value={tpl.deployCount.toString()} />
              <Meta label="Args" value={tpl.args.length.toString()} />
              <Meta label="Est. Gas" value={tpl.estimatedGas.toLocaleString()} />
              <Meta label="License" value="MIT" />
            </dl>
            <div className="mt-4 flex flex-wrap gap-1">
              {tpl.tags.map((t) => (
                <span key={t} className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                  {t}
                </span>
              ))}
            </div>
          </div>

          <div className="rounded border border-border bg-surface">
            <button
              onClick={() => setAbiOpen((v) => !v)}
              className="flex w-full items-center justify-between px-4 py-3 font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground"
            >
              ABI Preview
              {abiOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            {abiOpen && (
              <div className="border-t border-border p-3">
                <CodeBlock code={JSON.stringify(JSON.parse(tpl.abi), null, 2)} language="json" maxHeight="320px" />
              </div>
            )}
          </div>
        </aside>

        <div className="lg:col-span-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="rounded-t border border-b-0 border-border bg-surface px-3 py-1 font-mono text-[11px] text-foreground">
              {tpl.name}.sol
            </span>
          </div>
          <CodeBlock code={tpl.solidity} language="solidity" maxHeight="560px" />
        </div>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-meta">{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}
