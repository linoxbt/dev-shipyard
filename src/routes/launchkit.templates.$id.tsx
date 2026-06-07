import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Rocket, ChevronDown, ChevronRight, Code2, Pencil } from "lucide-react";
import { useAccount } from "wagmi";
import { PageHeader } from "@/components/shared/PageHeader";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { getTemplate, categoryColor, type Template } from "@/lib/mock/templates";
import { useUserTemplates } from "@/lib/user-templates";
import { useEditorIntake } from "@/lib/editor-intake";

export const Route = createFileRoute("/launchkit/templates/$id")({
  // Built-ins resolve here (SSR). Community templates live in localStorage and
  // are resolved client-side, so we don't 404 in the loader.
  loader: ({ params }) => ({ tpl: getTemplate(params.id) ?? null, id: params.id }),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.tpl ? `${loaderData.tpl.name} — DevStation` : "Template — DevStation" },
      { name: "description", content: loaderData?.tpl?.description ?? "Contract template" },
    ],
  }),
  component: TemplateDetail,
});

function TemplateDetail() {
  const { tpl: builtin, id } = Route.useLoaderData();
  const [abiOpen, setAbiOpen] = useState(false);
  const navigate = useNavigate();
  const setPending = useEditorIntake((s) => s.setPending);
  const { address } = useAccount();

  const userTemplates = useUserTemplates((s) => s.templates);
  const hydrated = useUserTemplates((s) => s.hydrated);
  const hydrate = useUserTemplates((s) => s.hydrate);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const tpl: Template | null = useMemo(
    () => builtin ?? userTemplates.find((t) => t.id === id) ?? null,
    [builtin, userTemplates, id],
  );

  if (!tpl) {
    // Built-in miss + store hydrated and still nothing → genuinely not found.
    return (
      <div>
        <PageHeader breadcrumb={["DevStation", "LaunchKit", "Templates"]} title="Template" />
        <div className="p-6">
          <div className="rounded border border-border bg-surface p-10 text-center font-mono text-xs text-meta">
            {hydrated ? (
              <>
                Template not found.
                <Link to="/launchkit/templates" className="ml-2 text-primary hover:underline">
                  Back to gallery →
                </Link>
              </>
            ) : (
              "Loading…"
            )}
          </div>
        </div>
      </div>
    );
  }

  const canEdit = !!tpl.submitter && tpl.submitter === address;

  const openInEditor = () => {
    setPending(`${tpl.name}.sol`, tpl.solidity);
    navigate({ to: "/launchkit/editor" });
  };

  let parsedAbi = "[]";
  try {
    parsedAbi = JSON.stringify(JSON.parse(tpl.abi), null, 2);
  } catch {
    parsedAbi = tpl.abi || "[]";
  }

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Templates", tpl.name]}
        title={tpl.name}
        subtitle={tpl.description}
        action={
          <div className="flex items-center gap-2">
            {canEdit && (
              <Link
                to="/launchkit/templates/submit"
                search={{ edit: tpl.id }}
                className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
              >
                <Pencil className="h-3 w-3" /> Edit
              </Link>
            )}
            <button
              onClick={openInEditor}
              className="flex items-center gap-1.5 rounded border border-border px-2.5 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              <Code2 className="h-3 w-3" /> Open in Editor
            </button>
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
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${categoryColor(tpl.category)}`}
              >
                {tpl.category}
              </span>
              {tpl.verified ? (
                <span className="font-mono text-[10px] text-success">✓ VERIFIED</span>
              ) : tpl.submitter ? (
                <span className="font-mono text-[10px] text-info">COMMUNITY</span>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">{tpl.longDescription}</p>
            <dl className="mt-4 grid grid-cols-2 gap-3 font-mono text-xs">
              <Meta label="Author" value={shortAuthor(tpl.author)} />
              <Meta label="Version" value={tpl.version} />
              <Meta label="Deploys" value={tpl.deployCount.toString()} />
              <Meta label="Args" value={tpl.args.length.toString()} />
              <Meta label="Est. Gas" value={tpl.estimatedGas.toLocaleString()} />
              <Meta label="License" value="MIT" />
            </dl>
            <div className="mt-4 flex flex-wrap gap-1">
              {tpl.tags.map((t: string) => (
                <span
                  key={t}
                  className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
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
                <CodeBlock code={parsedAbi} language="json" maxHeight="320px" />
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

function shortAuthor(a: string): string {
  return /^0x[a-fA-F0-9]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wider text-meta">{label}</dt>
      <dd className="truncate text-foreground">{value}</dd>
    </div>
  );
}
