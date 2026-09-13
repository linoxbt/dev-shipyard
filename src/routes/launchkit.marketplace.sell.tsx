import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FilePlus2,
  Loader2,
  Trash2,
  Upload,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState, KIND_STYLE, MarketNav } from "@/components/marketplace/ui";
import { useMarketplace } from "@/hooks/useMarketplace";
import { useProjects } from "@/lib/appgen/projects";
import { useUserTemplates } from "@/lib/user-templates";
import { compile } from "@/lib/compiler";
import { bundleBytes, bundleProblem, type Bundle } from "@/lib/marketplace/bundle";
import {
  KINDS,
  formatPrice,
  listingId,
  parsePrice,
  splitSale,
  type Currency,
  type ListingKind,
  type PricingModel,
} from "@/lib/marketplace/listing";

export const Route = createFileRoute("/launchkit/marketplace/sell")({
  head: () => ({ meta: [{ title: "Sell: DevStation Marketplace" }] }),
  component: SellPage,
});

const STARTER_SOL = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MyContract {
    string public greeting;

    constructor(string memory greeting_) {
        greeting = greeting_;
    }
}
`;

const STARTER_SKILL = `---
name: my-skill
description: One line on what this skill does
---

# My skill

Step-by-step instructions for the agent.
`;

const STEPS = ["What", "Files", "Details", "Price"] as const;

const field =
  "w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none";
const labelCls = "mb-1 block font-mono text-[11px] uppercase tracking-wider text-meta";

function SellPage() {
  const navigate = useNavigate();
  const market = useMarketplace();
  const projects = useProjects();
  const drafts = useUserTemplates();
  useEffect(() => {
    projects.hydrate();
    drafts.hydrate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ListingKind>("template");
  const [files, setFiles] = useState<Bundle>({});
  const [solidity, setSolidity] = useState(STARTER_SOL);
  const [skill, setSkill] = useState(STARTER_SKILL);
  const [compiling, setCompiling] = useState(false);
  const [compileErrors, setCompileErrors] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [readme, setReadme] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [demoUrl, setDemoUrl] = useState("");
  const [currency, setCurrency] = useState<Currency>("QUSDC");
  const [model, setModel] = useState<PricingModel>("one-time");
  const [priceInput, setPriceInput] = useState("5");
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!market.qusdcAvailable) setCurrency("QIE");
  }, [market.qusdcAvailable]);
  useEffect(() => {
    if (kind !== "template") setModel("one-time");
  }, [kind]);

  const price = parsePrice(priceInput, currency);
  const problem = bundleProblem(files);
  const paths = useMemo(() => Object.keys(files).sort(), [files]);

  const compileTemplate = async () => {
    setCompiling(true);
    setCompileErrors([]);
    try {
      const result = await compile({
        sources: { "Template.sol": solidity },
        version: "0.8.20",
        mainFile: "Template.sol",
      });
      if (result.status === "error") {
        setCompileErrors(result.errors.map((e) => e.formattedMessage));
        return;
      }
      const deployable = Object.entries(result.contracts).filter(([, c]) => c.bytecode.length > 2);
      if (deployable.length === 0) {
        setCompileErrors(["No deployable contract found in the source."]);
        return;
      }
      const [contractName, contract] = deployable[deployable.length - 1];
      setFiles({
        [`${contractName}.sol`]: solidity,
        [`${contractName}.abi.json`]: JSON.stringify(contract.abi, null, 2),
      });
      if (!name) setName(contractName);
      toast.success(`Compiled ${contractName}`);
    } catch (e) {
      setCompileErrors([e instanceof Error ? e.message : "Compilation failed."]);
    } finally {
      setCompiling(false);
    }
  };

  const addUploads = async (list: FileList | null) => {
    if (!list) return;
    const next: Bundle = { ...files };
    for (const file of Array.from(list)) {
      const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      next[path] = await file.text();
    }
    setFiles(next);
  };

  const canContinue = [
    true,
    kind === "skill" ? skill.trim().length > 0 : !problem,
    name.trim().length > 0 && description.trim().length > 0,
    price !== null,
  ][step];

  const next = () => {
    if (step === 1 && kind === "skill") setFiles({ "SKILL.md": skill });
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const publish = async () => {
    const bundle = kind === "skill" ? { "SKILL.md": skill } : files;
    if (price === null) return toast.error(`Enter a price in ${currency}.`);
    setPublishing(true);
    try {
      const { id } = await market.publish({
        kind,
        currency,
        model,
        price,
        name: name.trim(),
        description: description.trim(),
        metadata: {
          category: category.trim() || undefined,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 8),
          readme: readme.trim() || undefined,
          files: Object.keys(bundle).sort().slice(0, 60),
          demoUrl: /^https?:\/\//i.test(demoUrl.trim()) ? demoUrl.trim() : undefined,
        },
        files: bundle,
      });
      toast.success("Your listing is live");
      void market.refetchSummaries();
      void navigate({
        to: "/launchkit/marketplace/$listingId",
        params: { listingId: listingId("market", id) },
      });
    } catch (e) {
      toast.error(
        (e instanceof Error ? e.message : "Publishing failed.").split("\n")[0].slice(0, 220),
      );
    } finally {
      setPublishing(false);
    }
  };

  const header = (
    <>
      <PageHeader
        breadcrumb={["DevStation", "Marketplace", "Sell"]}
        title="Sell on the marketplace"
        subtitle="List what you have built. Buyers pay in QIE or QUSDC, you keep 95%, and tips are all yours."
      />
      <MarketNav active="sell" />
    </>
  );

  if (!market.address) {
    return (
      <div>
        {header}
        <div className="px-5 py-6 sm:px-8 lg:px-12">
          <EmptyState
            icon={Wallet}
            title="Connect a wallet to sell"
            body="Listings, sales and earnings are recorded against the wallet that publishes them."
          />
        </div>
      </div>
    );
  }
  if (!market.configured) {
    return (
      <div>
        {header}
        <div className="px-5 py-6 sm:px-8 lg:px-12">
          <EmptyState
            icon={Wallet}
            title="Switch to QIE Mainnet"
            body="The marketplace contract lives on QIE Mainnet. Switch networks in the sidebar to list there."
          />
        </div>
      </div>
    );
  }

  const { creator, fee } = splitSale(price ?? 0n);

  return (
    <div>
      {header}
      <div className="mx-auto max-w-4xl px-5 py-6 sm:px-8">
        {/* Stepper */}
        <ol className="mb-6 grid grid-cols-4 gap-2">
          {STEPS.map((label, index) => (
            <li key={label}>
              <button
                onClick={() => index < step && setStep(index)}
                className={cn(
                  "flex w-full items-center gap-2 rounded border px-2 py-2 font-mono text-[11px] transition",
                  index === step
                    ? "border-primary bg-primary/10 text-primary"
                    : index < step
                      ? "border-success/40 text-success"
                      : "border-border text-meta",
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-current text-[10px]">
                  {index < step ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <span className="truncate">{label}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="rounded-lg border border-border bg-surface p-5">
          {step === 0 && (
            <div className="grid gap-3 sm:grid-cols-2">
              {KINDS.map((k) => {
                const style = KIND_STYLE[k.kind];
                const Icon = style.icon;
                return (
                  <button
                    key={k.kind}
                    onClick={() => {
                      setKind(k.kind);
                      setFiles({});
                    }}
                    className={cn(
                      "flex items-start gap-3 rounded-lg border p-4 text-left transition",
                      kind === k.kind
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <span className={cn("rounded border p-2", style.ring)}>
                      <Icon className={cn("h-5 w-5", style.tone)} />
                    </span>
                    <span>
                      <span className="block font-mono text-sm font-bold text-foreground">
                        {k.singular}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">{k.blurb}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {step === 1 && kind === "template" && (
            <div className="space-y-3">
              {drafts.templates.length > 0 && (
                <div>
                  <label className={labelCls}>Start from a template you saved</label>
                  <select
                    onChange={(e) => {
                      const draft = drafts.templates.find((t) => t.id === e.target.value);
                      if (!draft) return;
                      setSolidity(draft.solidity);
                      setDescription((d) => d || draft.description);
                      setReadme((r) => r || draft.longDescription);
                      setTags((t) => t || draft.tags.join(", "));
                    }}
                    defaultValue=""
                    className={field}
                  >
                    <option value="" disabled>
                      Choose a saved draft…
                    </option>
                    {drafts.templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <label className={labelCls}>Solidity</label>
              <textarea
                value={solidity}
                onChange={(e) => {
                  setSolidity(e.target.value);
                  setFiles({});
                }}
                spellCheck={false}
                rows={18}
                className={`${field} bg-[#0d1117] leading-relaxed`}
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => void compileTemplate()}
                  disabled={compiling}
                  className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 font-mono text-xs text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {compiling && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Compile to check
                  it
                </button>
                {paths.length > 0 && (
                  <span className="inline-flex items-center gap-1 font-mono text-[11px] text-success">
                    <Check className="h-3 w-3" /> {paths.join(", ")}
                  </span>
                )}
              </div>
              {compileErrors.length > 0 && (
                <div className="space-y-1 rounded border border-danger/40 bg-danger/10 p-3 font-mono text-[10px] text-danger">
                  {compileErrors.map((error, i) => (
                    <p key={i} className="whitespace-pre-wrap break-words">
                      {error}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 1 && kind === "app" && (
            <div className="space-y-3">
              {projects.projects.length === 0 ? (
                <EmptyState
                  icon={FilePlus2}
                  title="No apps to sell yet"
                  body="Build one with the Coding Agent, then come back and list it."
                  action={
                    <Link
                      to="/launchkit/coding-agent"
                      className="rounded bg-primary px-3 py-1.5 font-mono text-xs font-bold text-primary-foreground"
                    >
                      Open the Coding Agent
                    </Link>
                  }
                />
              ) : (
                <>
                  <label className={labelCls}>Choose an app you built</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {projects.projects.map((project) => {
                      const count = Object.keys(project.files).length;
                      const picked = paths.length > 0 && name === project.name;
                      return (
                        <button
                          key={project.id}
                          onClick={() => {
                            setFiles(project.files);
                            setName(project.name);
                            if (project.liveUrl) setDemoUrl(project.liveUrl);
                          }}
                          className={cn(
                            "rounded-lg border p-3 text-left transition",
                            picked
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/40",
                          )}
                        >
                          <span className="block truncate font-mono text-sm font-bold text-foreground">
                            {project.name}
                          </span>
                          <span className="mt-1 block font-mono text-[11px] text-meta">
                            {count} files{project.liveUrl ? " · published" : ""}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
              <FileSummary files={files} problem={paths.length ? problem : null} />
            </div>
          )}

          {step === 1 && kind === "skill" && (
            <div className="space-y-2">
              <label className={labelCls}>SKILL.md</label>
              <textarea
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
                spellCheck={false}
                rows={18}
                className={`${field} leading-relaxed`}
              />
              <p className="font-mono text-[10px] text-meta">
                Works with the Coding Agent and the DevStation CLI, and with Claude Code skills.
              </p>
            </div>
          )}

          {step === 1 && kind === "ui-kit" && (
            <div className="space-y-3">
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background px-4 py-10 text-center transition hover:border-primary">
                <Upload className="h-6 w-6 text-meta" />
                <span className="font-mono text-xs text-foreground">Add component files</span>
                <span className="font-mono text-[10px] text-meta">
                  .tsx, .ts, .css, .json, .md. Text files only.
                </span>
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => void addUploads(e.target.files)}
                />
              </label>
              <FileSummary
                files={files}
                problem={paths.length ? problem : null}
                onRemove={(path) => {
                  const nextFiles = { ...files };
                  delete nextFiles[path];
                  setFiles(nextFiles);
                }}
              />
            </div>
          )}

          {step === 2 && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={labelCls}>Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, 80))}
                  className={field}
                  placeholder="Staking vault with rewards"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>One-line description</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value.slice(0, 200))}
                  className={field}
                  placeholder="What it does, in a sentence"
                />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Details shown before purchase</label>
                <textarea
                  value={readme}
                  onChange={(e) => setReadme(e.target.value.slice(0, 2500))}
                  rows={6}
                  className={`${field} resize-y`}
                  placeholder="Features, how to use it, what is included."
                />
              </div>
              <div>
                <label className={labelCls}>Category</label>
                <input
                  value={category}
                  onChange={(e) => setCategory(e.target.value.slice(0, 40))}
                  className={field}
                  placeholder="DeFi, NFT, Dashboard…"
                />
              </div>
              <div>
                <label className={labelCls}>Tags (comma separated)</label>
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className={field}
                  placeholder="staking, rewards"
                />
              </div>
              {(kind === "app" || kind === "ui-kit") && (
                <div className="sm:col-span-2">
                  <label className={labelCls}>Live demo link (optional)</label>
                  <input
                    value={demoUrl}
                    onChange={(e) => setDemoUrl(e.target.value)}
                    className={field}
                    placeholder="https://your-app.devstation.online"
                  />
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div>
                <label className={labelCls}>Currency</label>
                <div className="grid grid-cols-2 gap-2">
                  {(["QUSDC", "QIE"] as const).map((c) => (
                    <button
                      key={c}
                      disabled={c === "QUSDC" && !market.qusdcAvailable}
                      onClick={() => setCurrency(c)}
                      className={cn(
                        "rounded-lg border p-3 text-left transition disabled:opacity-40",
                        currency === c
                          ? "border-primary bg-primary/5"
                          : "border-border hover:border-primary/40",
                      )}
                    >
                      <span className="block font-mono text-sm font-bold text-foreground">{c}</span>
                      <span className="mt-1 block text-[11px] text-muted-foreground">
                        {c === "QUSDC" ? "A dollar price that stays put." : "QIE's native coin."}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {kind === "template" && (
                <div>
                  <label className={labelCls}>How buyers pay</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ["one-time", "Once", "Buy it, keep it, deploy as often as you like."],
                        ["per-deploy", "Per deploy", "Paid again every time someone deploys it."],
                      ] as const
                    ).map(([key, title, body]) => (
                      <button
                        key={key}
                        onClick={() => setModel(key)}
                        className={cn(
                          "rounded-lg border p-3 text-left transition",
                          model === key
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40",
                        )}
                      >
                        <span className="block font-mono text-sm font-bold text-foreground">
                          {title}
                        </span>
                        <span className="mt-1 block text-[11px] text-muted-foreground">{body}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <label className={labelCls}>Price</label>
                <div className="flex items-center rounded border border-border bg-background focus-within:border-primary">
                  <input
                    value={priceInput}
                    onChange={(e) => setPriceInput(e.target.value)}
                    inputMode="decimal"
                    className="w-full bg-transparent px-3 py-2.5 font-mono text-lg text-foreground focus:outline-none"
                  />
                  <span className="px-3 font-mono text-xs text-meta">{currency}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
                  {price === null ? (
                    <span className="text-danger">Enter a price, or 0 for free.</span>
                  ) : price === 0n ? (
                    <span className="text-success">
                      Free for everyone. Buyers can still tip you.
                    </span>
                  ) : (
                    <>
                      <span className="text-muted-foreground">
                        Buyer pays{" "}
                        <span className="text-foreground">{formatPrice(price, currency)}</span>
                      </span>
                      <span className="text-muted-foreground">
                        You receive{" "}
                        <span className="text-success">{formatPrice(creator, currency)}</span>
                      </span>
                      <span className="text-meta">Platform fee {formatPrice(fee, currency)}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="rounded border border-border bg-background p-3 font-mono text-[11px] text-muted-foreground">
                Publishing records the listing on QIE Mainnet (one transaction), then uploads{" "}
                {Object.keys(kind === "skill" ? { "SKILL.md": skill } : files).length} file(s),{" "}
                {Math.ceil(bundleBytes(kind === "skill" ? { "SKILL.md": skill } : files) / 1024)}{" "}
                KB, which unlock for buyers. You may be asked to sign once so DevStation knows the
                upload is yours.
              </div>
            </div>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <button
            onClick={() => setStep((s) => Math.max(s - 1, 0))}
            disabled={step === 0}
            className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button
              onClick={next}
              disabled={!canContinue}
              className="inline-flex items-center gap-1.5 rounded bg-primary px-4 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            >
              Continue <ArrowRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={() => void publish()}
              disabled={!canContinue || publishing}
              className="inline-flex items-center gap-1.5 rounded bg-primary px-4 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            >
              {publishing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Check className="h-3.5 w-3.5" />
              )}
              {publishing ? "Publishing…" : "Publish listing"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FileSummary({
  files,
  problem,
  onRemove,
}: {
  files: Bundle;
  problem: string | null;
  onRemove?: (path: string) => void;
}) {
  const paths = Object.keys(files).sort();
  if (paths.length === 0) return null;
  return (
    <div className="rounded border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-meta">
        <span>{paths.length} files</span>
        <span>{Math.ceil(bundleBytes(files) / 1024)} KB</span>
      </div>
      <ul className="max-h-48 overflow-auto p-2">
        {paths.map((path) => (
          <li
            key={path}
            className="flex items-center justify-between gap-2 py-0.5 font-mono text-[11px] text-muted-foreground"
          >
            <span className="truncate">{path}</span>
            {onRemove && (
              <button
                onClick={() => onRemove(path)}
                className="text-meta hover:text-danger"
                aria-label={`Remove ${path}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {problem && (
        <p className="border-t border-border px-3 py-1.5 font-mono text-[10px] text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}
