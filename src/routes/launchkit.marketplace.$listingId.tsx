import { useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import {
  AppWindow,
  BadgeCheck,
  Check,
  Code2,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Gift,
  Loader2,
  Lock,
  Rocket,
  Share2,
  ShoppingBag,
  Store,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { EmptyState, KindBadge, PriceTag } from "@/components/marketplace/ui";
import { getTemplate, templateLabel } from "@/lib/data/templates";
import { applyTerminology } from "@/lib/terminology";
import { shortAddr } from "@/lib/explorer/format";
import { useNetworkPref } from "@/lib/active-chain";
import { useEditorIntake } from "@/lib/editor-intake";
import { useProjects } from "@/lib/appgen/projects";
import { useMarketplace, type MarketListing } from "@/hooks/useMarketplace";
import { useTemplateRegistry } from "@/hooks/useTemplateRegistry";
import { useTemplateDeploys } from "@/hooks/useTemplateDeploys";
import type { Bundle } from "@/lib/marketplace/bundle";
import {
  formatAmount,
  formatPrice,
  parseListingId,
  parsePrice,
  splitSale,
} from "@/lib/marketplace/listing";

export const Route = createFileRoute("/launchkit/marketplace/$listingId")({
  head: () => ({ meta: [{ title: "Listing: DevStation Marketplace" }] }),
  component: ListingPage,
});

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.split("/").pop() || filename;
  a.click();
  URL.revokeObjectURL(url);
}

function languageOf(path: string) {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "sol") return "solidity";
  if (ext === "md") return "markdown";
  if (["ts", "tsx", "js", "jsx", "json", "css", "html"].includes(ext)) return ext;
  return "text";
}

function ListingPage() {
  const { listingId } = Route.useParams();
  const parsed = parseListingId(listingId);

  if (!parsed) {
    return (
      <Shell title="Listing">
        <EmptyState
          icon={Store}
          title="No such listing"
          body="That link does not point at anything in the marketplace."
          action={<BackLink />}
        />
      </Shell>
    );
  }
  if (parsed.source === "builtin") return <BuiltinListing slug={parsed.key} />;
  if (parsed.source === "legacy") return <LegacyListing id={parsed.key} />;
  return <MarketListingPage id={parsed.key} />;
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Marketplace", title]}
        title={title}
        subtitle={subtitle}
      />
      <div className="px-5 py-6 sm:px-8 lg:px-12">{children}</div>
    </div>
  );
}

function BackLink() {
  return (
    <Link to="/launchkit/marketplace" className="font-mono text-xs text-primary hover:underline">
      Back to the marketplace →
    </Link>
  );
}

function ShareButton() {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(window.location.href);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="inline-flex items-center justify-center gap-1.5 rounded border border-border px-3 py-2 font-mono text-xs text-muted-foreground transition hover:border-primary hover:text-primary"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
      {copied ? "Link copied" : "Share"}
    </button>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-border bg-surface p-4">{children}</div>;
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 font-mono text-xs">
      <span className="text-meta">{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  );
}

// --- built-in -------------------------------------------------------------

function BuiltinListing({ slug }: { slug: string }) {
  const chainId = useNetworkPref((s) => s.preferredChainId);
  const navigate = useNavigate();
  const setPending = useEditorIntake((s) => s.setPending);
  const { counts } = useTemplateDeploys();
  const tpl = getTemplate(slug);

  if (!tpl) {
    return (
      <Shell title="Listing">
        <EmptyState
          icon={Store}
          title="No such template"
          body="That built-in template does not exist."
          action={<BackLink />}
        />
      </Shell>
    );
  }
  const name = templateLabel(tpl, chainId);
  return (
    <Shell title={name} subtitle={applyTerminology(tpl.description, chainId)}>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <div className="flex flex-wrap items-center gap-2">
              <KindBadge kind="template" />
              <span
                className="inline-flex items-center gap-1 font-mono text-[10px] uppercase text-success"
                title="Ships with DevStation. Not a third-party audit."
              >
                <BadgeCheck className="h-3 w-3" /> Official
              </span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {applyTerminology(tpl.longDescription, chainId)}
            </p>
          </Panel>
          <CodeBlock code={tpl.solidity} language="solidity" maxHeight="560px" />
        </div>
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <Panel>
            <PriceTag
              item={{ price: 0n, currency: "QIE", model: "one-time" }}
              className="text-base"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Free for everyone, maintained by DevStation.
            </p>
            <div className="mt-4 grid gap-2">
              <Link
                to="/launchkit/deploy"
                search={{ template: tpl.id }}
                className="inline-flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover"
              >
                <Rocket className="h-3.5 w-3.5" /> Deploy
              </Link>
              <button
                onClick={() => {
                  setPending(`${tpl.name}.sol`, tpl.solidity);
                  void navigate({ to: "/launchkit/editor" });
                }}
                className="inline-flex items-center justify-center gap-2 rounded border border-border px-3 py-2 font-mono text-xs text-foreground hover:border-primary hover:text-primary"
              >
                <Code2 className="h-3.5 w-3.5" /> Open in Editor
              </button>
              <ShareButton />
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <MetaRow label="Contract" value={tpl.name} />
              <MetaRow label="Deploys" value={(counts[tpl.id] ?? tpl.deployCount).toString()} />
              <MetaRow label="Constructor args" value={tpl.args.length} />
              <MetaRow label="Version" value={tpl.version} />
            </div>
          </Panel>
        </aside>
      </div>
    </Shell>
  );
}

// --- legacy TemplateRegistry ------------------------------------------------

function LegacyListing({ id }: { id: number }) {
  const navigate = useNavigate();
  const { isConnected } = useAccount();
  const setPending = useEditorIntake((s) => s.setPending);
  const registry = useTemplateRegistry();
  const [busy, setBusy] = useState(false);
  const { data: tpl, isLoading } = useQuery({
    queryKey: ["template-registry", "template", id, registry.registry],
    enabled: registry.configured,
    queryFn: () => registry.fetchTemplate(id),
  });

  if (isLoading)
    return (
      <Shell title="Loading…">
        <div className="h-64 animate-pulse rounded-lg border border-border bg-surface" />
      </Shell>
    );
  if (!tpl || !tpl.active) {
    return (
      <Shell title="Listing">
        <EmptyState
          icon={Store}
          title="This listing is not available"
          body="It may have been delisted, or it is on another network."
          action={<BackLink />}
        />
      </Shell>
    );
  }

  const openLegacy = async () => {
    if (!isConnected) return toast.error("Connect a wallet first.");
    setBusy(true);
    try {
      if (tpl.price > 0n) await registry.payForDeploy(id, tpl.price);
      setPending(`${tpl.name}.sol`, tpl.source);
      void navigate({ to: "/launchkit/editor" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell title={tpl.name} subtitle={tpl.description}>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <CodeBlock code={tpl.source} language="solidity" maxHeight="620px" />
        </div>
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Panel>
            <KindBadge kind="template" />
            <div className="mt-3">
              <PriceTag
                item={{ price: tpl.price, currency: "QIE", model: "per-deploy" }}
                className="text-base"
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Source is public. Paying records your deploy against this template and pays its
              creator.
            </p>
            <div className="mt-4 grid gap-2">
              <button
                onClick={() => void openLegacy()}
                disabled={busy}
                className="inline-flex items-center justify-center gap-2 rounded bg-primary px-3 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Rocket className="h-3.5 w-3.5" />
                )}
                {tpl.price > 0n ? "Pay and open in Editor" : "Open in Editor"}
              </button>
              <ShareButton />
            </div>
            <div className="mt-4 border-t border-border pt-3">
              <MetaRow label="Creator" value={shortAddr(tpl.creator)} />
              <MetaRow label="Deploys" value={tpl.deployCount} />
            </div>
          </Panel>
        </aside>
      </div>
    </Shell>
  );
}

// --- DevStationMarketplace --------------------------------------------------

function MarketListingPage({ id }: { id: number }) {
  const market = useMarketplace();
  const {
    data: listing,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ["marketplace", "listing", market.chainId, id],
    enabled: market.configured,
    queryFn: () => market.fetchListing(id),
  });

  if (!market.configured) {
    return (
      <Shell title="Listing">
        <EmptyState
          icon={Store}
          title="Switch to QIE Mainnet"
          body="Community listings live on QIE Mainnet. Switch networks in the sidebar to open this one."
          action={<BackLink />}
        />
      </Shell>
    );
  }
  if (isLoading)
    return (
      <Shell title="Loading…">
        <div className="h-64 animate-pulse rounded-lg border border-border bg-surface" />
      </Shell>
    );
  if (!listing || listing.hidden) {
    return (
      <Shell title="Listing">
        <EmptyState
          icon={Store}
          title="This listing is not available"
          body="It does not exist on this network, or it has been taken down."
          action={<BackLink />}
        />
      </Shell>
    );
  }
  return <MarketListingView listing={listing} onChange={() => void refetch()} />;
}

function MarketListingView({
  listing,
  onChange,
}: {
  listing: MarketListing;
  onChange: () => void;
}) {
  const market = useMarketplace();
  const navigate = useNavigate();
  const setPending = useEditorIntake((s) => s.setPending);
  const projects = useProjects();
  const [busy, setBusy] = useState<string | null>(null);
  const [files, setFiles] = useState<Bundle | null>(null);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [tipInput, setTipInput] = useState("");

  const isCreator =
    !!market.address && market.address.toLowerCase() === listing.creator.toLowerCase();
  const { data: bought, refetch: refetchAccess } = useQuery({
    queryKey: ["marketplace", "access", market.chainId, listing.id, market.address],
    enabled: !!market.address,
    queryFn: () => market.hasAccess(listing.id),
  });
  const unlocked = listing.price === 0n || isCreator || !!bought;
  const perDeploy = listing.model === "per-deploy";
  const { creator: creatorShare } = splitSale(listing.price);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      const text = e instanceof Error ? e.message : "That failed.";
      toast.error(text.split("\n")[0].slice(0, 200));
    } finally {
      setBusy(null);
    }
  };

  const loadFiles = async () => {
    if (files) return files;
    const got = await market.downloadFiles(listing);
    setFiles(got);
    setOpenFile(Object.keys(got).sort()[0] ?? null);
    return got;
  };

  const solidityOf = (bundle: Bundle) => {
    const path = Object.keys(bundle).find((p) => p.endsWith(".sol"));
    if (!path) throw new Error("This template has no Solidity file.");
    return { path, source: bundle[path] };
  };

  const buy = () =>
    run("buy", async () => {
      await market.buy(listing);
      toast.success(`Purchased ${listing.name}`);
      await refetchAccess();
      void market.refetchPurchases();
      onChange();
      await loadFiles();
    });

  const deployPerUse = () =>
    run("deploy", async () => {
      await market.recordDeploy(listing);
      const { path, source } = solidityOf(await loadFiles());
      setPending(path.split("/").pop() ?? path, source);
      onChange();
      void navigate({ to: "/launchkit/editor" });
    });

  const openTemplate = () =>
    run("open", async () => {
      const { path, source } = solidityOf(await loadFiles());
      setPending(path.split("/").pop() ?? path, source);
      void navigate({ to: "/launchkit/editor" });
    });

  const cloneApp = () =>
    run("clone", async () => {
      const bundle = await loadFiles();
      projects.hydrate();
      const projectId = projects.create(listing.name, market.address ?? null);
      projects.update(projectId, { files: bundle });
      toast.success("Cloned into your apps");
      void navigate({ to: "/launchkit/apps/$id", params: { id: projectId } });
    });

  const sendTip = () =>
    run("tip", async () => {
      const amount = parsePrice(tipInput, listing.currency);
      if (!amount) throw new Error(`Enter a tip in ${listing.currency}.`);
      await market.tip(listing, amount);
      toast.success(
        `Sent ${formatAmount(amount, listing.currency)} ${listing.currency} to the creator`,
      );
      setTipInput("");
    });

  const sortedPaths = useMemo(() => (files ? Object.keys(files).sort() : []), [files]);
  const previewPaths = listing.metadata.files ?? [];

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "Marketplace", listing.name]}
        title={listing.name}
        subtitle={listing.description}
      />
      <div className="grid gap-6 px-5 py-6 sm:px-8 lg:grid-cols-3 lg:px-12">
        <div className="space-y-4 lg:col-span-2">
          <Panel>
            <div className="flex flex-wrap items-center gap-2">
              <KindBadge kind={listing.kind} />
              {listing.metadata.category && (
                <span className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                  {listing.metadata.category}
                </span>
              )}
              {listing.featuredUntil > Date.now() && (
                <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase text-primary-foreground">
                  Featured
                </span>
              )}
            </div>
            {listing.metadata.readme ? (
              <div className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {listing.metadata.readme}
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">{listing.description}</p>
            )}
            {(listing.metadata.tags?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {listing.metadata.tags!.map((tag) => (
                  <span
                    key={tag}
                    className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {listing.metadata.demoUrl && (
              <a
                href={listing.metadata.demoUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="mt-4 inline-flex items-center gap-1.5 font-mono text-xs text-primary hover:underline"
              >
                <ExternalLink className="h-3.5 w-3.5" /> Live demo
              </a>
            )}
          </Panel>

          {/* Files */}
          <div className="rounded-lg border border-border bg-surface">
            <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
              <span className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">
                What you get
              </span>
              {unlocked && !files && (
                <button
                  onClick={() => void run("files", loadFiles)}
                  disabled={busy === "files"}
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] text-primary hover:underline disabled:opacity-50"
                >
                  {busy === "files" ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <FileText className="h-3 w-3" />
                  )}
                  Show the files
                </button>
              )}
            </div>
            {files ? (
              <div className="grid md:grid-cols-[220px_1fr]">
                <ul className="max-h-[520px] overflow-auto border-b border-border p-2 md:border-b-0 md:border-r">
                  {sortedPaths.map((path) => (
                    <li key={path}>
                      <button
                        onClick={() => setOpenFile(path)}
                        className={`w-full truncate rounded px-2 py-1 text-left font-mono text-[11px] ${openFile === path ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                      >
                        {path}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="min-w-0 p-3">
                  {openFile && (
                    <>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[11px] text-foreground">
                          {openFile}
                        </span>
                        <button
                          onClick={() => downloadText(openFile, files[openFile])}
                          className="inline-flex shrink-0 items-center gap-1 font-mono text-[11px] text-muted-foreground hover:text-primary"
                        >
                          <Download className="h-3 w-3" /> Download
                        </button>
                      </div>
                      <CodeBlock
                        code={files[openFile]}
                        language={languageOf(openFile)}
                        maxHeight="460px"
                      />
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="p-4">
                {previewPaths.length > 0 ? (
                  <ul className="grid gap-1 sm:grid-cols-2">
                    {previewPaths.map((path) => (
                      <li
                        key={path}
                        className="flex items-center gap-1.5 truncate font-mono text-[11px] text-muted-foreground"
                      >
                        {unlocked ? (
                          <FileText className="h-3 w-3 shrink-0" />
                        ) : (
                          <Lock className="h-3 w-3 shrink-0 text-meta" />
                        )}
                        {path}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-mono text-[11px] text-meta">
                    {unlocked
                      ? "Open the files to see what is inside."
                      : "The files unlock when you buy."}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Purchase panel */}
        <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
          <Panel>
            <PriceTag item={listing} className="text-lg" />
            <p className="mt-2 text-xs text-muted-foreground">
              {listing.price === 0n
                ? "Free for everyone."
                : perDeploy
                  ? "Paid each time you deploy it. The creator receives 95%."
                  : "Pay once, keep it forever. The creator receives 95%."}
            </p>

            <div className="mt-4 grid gap-2">
              {isCreator && (
                <Link
                  to="/launchkit/marketplace/creator"
                  className="inline-flex items-center justify-center gap-2 rounded border border-primary/50 bg-primary/10 px-3 py-2 font-mono text-xs text-primary"
                >
                  You created this · Manage it
                </Link>
              )}

              {!market.address ? (
                <p className="rounded border border-border bg-surface-2 p-2 text-center font-mono text-[11px] text-muted-foreground">
                  Connect a wallet to {listing.price === 0n ? "open" : "buy"} this.
                </p>
              ) : perDeploy && !isCreator ? (
                <ActionButton primary busy={busy === "deploy"} onClick={deployPerUse} icon={Rocket}>
                  Pay {formatPrice(listing.price, listing.currency)} and deploy
                </ActionButton>
              ) : !unlocked ? (
                <ActionButton primary busy={busy === "buy"} onClick={buy} icon={ShoppingBag}>
                  Buy for {formatPrice(listing.price, listing.currency)}
                </ActionButton>
              ) : listing.kind === "template" ? (
                <ActionButton primary busy={busy === "open"} onClick={openTemplate} icon={Code2}>
                  Open in Editor
                </ActionButton>
              ) : listing.kind === "app" ? (
                <ActionButton primary busy={busy === "clone"} onClick={cloneApp} icon={AppWindow}>
                  Clone into my apps
                </ActionButton>
              ) : (
                <ActionButton
                  primary
                  busy={busy === "files"}
                  onClick={() => void run("files", loadFiles)}
                  icon={FileText}
                >
                  {listing.kind === "skill" ? "Open the skill" : "Open the kit"}
                </ActionButton>
              )}

              {unlocked && !listing.price && null}
              {bought && !isCreator && (
                <p className="flex items-center justify-center gap-1 font-mono text-[11px] text-success">
                  <Check className="h-3 w-3" /> In your library
                </p>
              )}
              <ShareButton />
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <MetaRow label="Creator" value={shortAddr(listing.creator)} />
              <MetaRow label="Sales" value={listing.sales} />
              {listing.deploys > 0 && <MetaRow label="Deploys" value={listing.deploys} />}
              {listing.price > 0n && (
                <MetaRow
                  label="Creator receives"
                  value={formatPrice(creatorShare, listing.currency)}
                />
              )}
              {listing.metadata.version && (
                <MetaRow label="Version" value={listing.metadata.version} />
              )}
              <MetaRow label="Listed" value={new Date(listing.createdAt).toLocaleDateString()} />
            </div>
          </Panel>

          {!isCreator && market.address && (
            <Panel>
              <div className="flex items-center gap-2 font-mono text-xs font-bold text-foreground">
                <Gift className="h-3.5 w-3.5 text-primary" /> Tip the creator
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Tips go to them in full. No platform fee.
              </p>
              <div className="mt-3 flex gap-2">
                <input
                  value={tipInput}
                  onChange={(e) => setTipInput(e.target.value)}
                  inputMode="decimal"
                  placeholder={`Amount in ${listing.currency}`}
                  className="min-w-0 flex-1 rounded border border-border bg-background px-2.5 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
                />
                <button
                  onClick={sendTip}
                  disabled={busy === "tip"}
                  className="inline-flex items-center gap-1.5 rounded border border-border px-3 py-2 font-mono text-xs text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {busy === "tip" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Copy className="hidden h-3.5 w-3.5" />
                  )}
                  Tip
                </button>
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  busy,
  primary,
  icon: Icon,
}: {
  children: React.ReactNode;
  onClick: () => void;
  busy?: boolean;
  primary?: boolean;
  icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      onClick={onClick}
      disabled={busy}
      className={
        primary
          ? "inline-flex items-center justify-center gap-2 rounded bg-primary px-3 py-2.5 font-mono text-xs font-bold text-primary-foreground transition hover:bg-primary-hover disabled:opacity-50"
          : "inline-flex items-center justify-center gap-2 rounded border border-border px-3 py-2 font-mono text-xs text-foreground hover:border-primary hover:text-primary disabled:opacity-50"
      }
    >
      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}
