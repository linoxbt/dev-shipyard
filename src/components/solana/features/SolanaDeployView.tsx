// Solana variant of the Deploy page — rendered by /launchkit/deploy when the
// active chain family is Solana. Reads the ?template search param loosely so it
// works embedded in the shared route.

import { useMemo, useState } from "react";
import { useSearch } from "@tanstack/react-router";
import { Rocket, ExternalLink, CheckCircle2, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { SolanaWalletPanel } from "@/components/solana/SolanaWalletPanel";
import { SolanaClusterSelector } from "@/components/solana/SolanaClusterSelector";
import { useSolanaDeploy, type DeployResult } from "@/lib/solana/deploy";
import { useSolanaWallet } from "@/hooks/useSolanaWallet";
import { solanaExplorerLink } from "@/lib/solana/chains";
import { SOLANA_TEMPLATES, solanaTemplate } from "@/lib/solana/templates";
import { recordSolanaDeploy } from "@/lib/solana/deploy-history";
import { metadataUploadEnabled, uploadTokenMetadata } from "@/lib/solana/metadata-upload";

export function SolanaDeployView() {
  const search = useSearch({ strict: false }) as { template?: string };
  const templateId = search.template;
  const template = useMemo(
    () => solanaTemplate(templateId ?? "") ?? SOLANA_TEMPLATES.find((t) => t.kind !== "program")!,
    [templateId],
  );

  const deploy = useSolanaDeploy();
  const wallet = useSolanaWallet();

  const [name, setName] = useState(template.token?.name ?? "");
  const [symbol, setSymbol] = useState(template.token?.symbol ?? "");
  const [uri, setUri] = useState(template.token?.uri ?? "");
  const [description, setDescription] = useState("");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const uploadOn = metadataUploadEnabled();
  const [decimals, setDecimals] = useState(template.token?.decimals ?? 9);
  const [supply, setSupply] = useState(template.token?.supply ?? 1_000_000);
  const [fixedSupply, setFixedSupply] = useState(template.token?.fixedSupply ?? false);
  const [freezable, setFreezable] = useState(template.token?.freezable ?? false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DeployResult | null>(null);

  const isNft = template.kind === "nft";

  const onDeploy = async () => {
    if (!deploy.ready) {
      toast.error("Connect or unlock a Solana wallet first.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      // If an image was chosen (and an upload backend is configured), host the
      // image + Metaplex metadata JSON and use its short URL as the on-chain uri.
      let finalUri = uri;
      if (imageFile && uploadOn) {
        toast.message("Uploading metadata…");
        const up = await uploadTokenMetadata({ name, symbol, description, imageFile });
        finalUri = up.metadataUrl;
        setUri(finalUri);
      }
      const res = isNft
        ? await deploy.deployNft({ name, symbol, uri: finalUri, count: Math.max(1, supply) })
        : await deploy.deployToken({ name, symbol, uri: finalUri, decimals, supply, fixedSupply, freezable });
      setResult(res);
      recordSolanaDeploy({
        kind: isNft ? "nft" : "token",
        cluster: wallet.cluster,
        address: res.mint,
        signature: res.signature,
        name: template.name,
        templateId: template.id,
        wallet: wallet.address ?? undefined,
        timestamp: Math.floor(Date.now() / 1000),
      });
      toast.success(isNft ? "NFT minted on Solana" : "Token deployed on Solana");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Deploy failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Deploy"]}
        title={`Deploy: ${template.name}`}
        subtitle={template.description}
      />

      <div className="grid gap-6 p-4 lg:grid-cols-3 lg:p-6">
        <div className="space-y-4 lg:col-span-2">
          {template.kind === "program" ? (
            <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-4 font-mono text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This is a Rust/Anchor program. Open it in the Contract Editor to build (via the
                remote build service) and deploy — token/NFT deploys are configured here.
              </span>
            </div>
          ) : (
            <div className="space-y-4 rounded border border-border bg-surface p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="font-mono text-xs text-meta">Name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={isNft ? "My NFT" : "My Token"}
                    className="mt-1 w-full rounded border border-border bg-background px-2.5 py-1.5 font-mono text-sm text-foreground outline-none focus:border-primary"
                  />
                </label>
                <label className="block">
                  <span className="font-mono text-xs text-meta">Symbol</span>
                  <input
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase().slice(0, 10))}
                    placeholder={isNft ? "NFT" : "TKN"}
                    className="mt-1 w-full rounded border border-border bg-background px-2.5 py-1.5 font-mono text-sm text-foreground outline-none focus:border-primary"
                  />
                </label>
              </div>
              <label className="block">
                <span className="font-mono text-xs text-meta">Description</span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  placeholder={isNft ? "About this NFT…" : "About this token…"}
                  className="mt-1 w-full resize-none rounded border border-border bg-background px-2.5 py-1.5 font-mono text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
              <div>
                <span className="font-mono text-xs text-meta">Image</span>
                {uploadOn ? (
                  <div className="mt-1 flex items-center gap-3">
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                      className="block w-full font-mono text-[11px] text-muted-foreground file:mr-3 file:rounded file:border-0 file:bg-primary file:px-2 file:py-1 file:font-mono file:text-[11px] file:text-primary-foreground"
                    />
                    {imageFile && <span className="shrink-0 font-mono text-[10px] text-success">{imageFile.name}</span>}
                  </div>
                ) : (
                  <input
                    value={uri}
                    onChange={(e) => setUri(e.target.value)}
                    placeholder="https://…/metadata.json (or set VITE_SOLANA_BUILD_API to upload an image)"
                    className="mt-1 w-full rounded border border-border bg-background px-2.5 py-1.5 font-mono text-sm text-foreground outline-none focus:border-primary"
                  />
                )}
                <p className="mt-1 font-mono text-[10px] text-meta">
                  {uploadOn
                    ? "Upload an image — DevStation hosts it + builds the on-chain metadata JSON."
                    : "Configure VITE_SOLANA_BUILD_API (the build server) to upload an image; otherwise paste a metadata JSON URL."}
                </p>
              </div>
              {!isNft && (
                <label className="block">
                  <span className="font-mono text-xs text-meta">Decimals</span>
                  <input
                    type="number"
                    min={0}
                    max={9}
                    value={decimals}
                    onChange={(e) => setDecimals(Number(e.target.value))}
                    className="mt-1 w-full rounded border border-border bg-background px-2.5 py-1.5 font-mono text-sm text-foreground outline-none focus:border-primary"
                  />
                </label>
              )}
              <label className="block">
                <span className="font-mono text-xs text-meta">
                  {isNft ? "Editions to mint" : "Initial supply (whole tokens)"}
                </span>
                <input
                  type="number"
                  min={isNft ? 1 : 0}
                  value={supply}
                  onChange={(e) => setSupply(Number(e.target.value))}
                  className="mt-1 w-full rounded border border-border bg-background px-2.5 py-1.5 font-mono text-sm text-foreground outline-none focus:border-primary"
                />
              </label>
              {!isNft && (
                <div className="flex flex-wrap gap-4">
                  <label className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={fixedSupply}
                      onChange={(e) => setFixedSupply(e.target.checked)}
                    />
                    Fixed supply (revoke mint authority)
                  </label>
                  <label className="inline-flex items-center gap-2 font-mono text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={freezable}
                      onChange={(e) => setFreezable(e.target.checked)}
                    />
                    Freezable
                  </label>
                </div>
              )}

              <button
                onClick={onDeploy}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-sm text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                {busy ? "Deploying…" : `Deploy on ${wallet.cluster === "solana-devnet" ? "Devnet" : "Mainnet"}`}
              </button>
            </div>
          )}

          {result && (
            <div className="space-y-2 rounded border border-success/40 bg-success/10 p-4 font-mono text-xs">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle2 className="h-4 w-4" /> Deployed successfully
              </div>
              <ResultRow
                label="Mint / Asset"
                value={result.mint}
                href={solanaExplorerLink(wallet.cluster, "address", result.mint)}
              />
              <ResultRow
                label="Transaction"
                value={result.signature}
                href={solanaExplorerLink(wallet.cluster, "tx", result.signature)}
              />
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded border border-border bg-surface p-4">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-meta">Cluster</div>
            <SolanaClusterSelector />
          </div>
          <div className="rounded border border-border bg-surface p-4">
            <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-meta">Wallet</div>
            <SolanaWalletPanel />
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultRow({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 text-meta">{label}</span>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 truncate text-primary hover:underline"
      >
        {value} <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    </div>
  );
}
