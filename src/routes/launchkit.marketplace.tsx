import { useState } from "react";
import { ComingSoon } from "@/components/shared/ComingSoon";
import { isComingSoon } from "@/lib/coming-soon";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAccount } from "wagmi";
import { formatEther } from "viem";
import { toast } from "sonner";
import { Store, Coins, Download, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { useTemplateRegistry, type OnChainTemplate } from "@/hooks/useTemplateRegistry";
import { useEditorIntake } from "@/lib/editor-intake";
import { useNetworkPref } from "@/lib/active-chain";
import { chainConfig, nativeSymbol } from "@/lib/chains";
import { shortAddr } from "@/lib/explorer/format";

// The on-chain template marketplace.
//
// Templates published here store their Solidity ON-CHAIN, so the source is
// public and free to read. Paying a template's price is what records the deploy
// against it: that is what pays the creator and grows their deploy count. The
// UI says so plainly rather than implying the payment unlocks something.

export const Route = createFileRoute("/launchkit/marketplace")({
  // Gated on the shared map, never on a flag local to this file: the
  // sidebar badge reads the same entry, so the two cannot disagree.
  // Marketplace stays referenced, so removing the map entry is all it takes
  // to bring the page back.
  component: () =>
    isComingSoon("/launchkit/marketplace") ? (
      <ComingSoon path="/launchkit/marketplace" />
    ) : (
      <Marketplace />
    ),
});

function Marketplace() {
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();
  const chainId = useNetworkPref((s) => s.preferredChainId);
  const chain = chainConfig(chainId);
  const setPending = useEditorIntake((s) => s.setPending);
  const {
    configured,
    registry,
    summaries,
    loading,
    fetchTemplate,
    payForDeploy,
    withdraw,
    earnings,
    refetchEarnings,
    refetchSummaries,
  } = useTemplateRegistry();

  const [busy, setBusy] = useState<number | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [preview, setPreview] = useState<OnChainTemplate | null>(null);

  // Delisted templates stay readable on-chain so existing attributed deploys
  // still resolve, but they are not on offer.
  const listed = summaries.filter((s) => s.active);

  const use = async (id: number, priceWei: bigint) => {
    if (!isConnected) {
      toast.error("Connect a wallet to use a template.");
      return;
    }
    setBusy(id);
    try {
      const t = await fetchTemplate(id);
      if (!t) throw new Error("That template could not be read from chain.");
      if (priceWei > BigInt(0)) {
        await payForDeploy(id, priceWei);
        toast.success(
          `Paid ${formatEther(priceWei)} ${nativeSymbol(chainId)} to ${shortAddr(t.creator)}`,
        );
        void refetchSummaries();
      }
      setPending(`${t.name}.sol`, t.source);
      navigate({ to: "/launchkit/editor" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That failed.");
    } finally {
      setBusy(null);
    }
  };

  const view = async (id: number) => {
    setBusy(id);
    try {
      setPreview(await fetchTemplate(id));
    } catch {
      toast.error("Could not read that template.");
    } finally {
      setBusy(null);
    }
  };

  const cashOut = async () => {
    setWithdrawing(true);
    try {
      await withdraw();
      toast.success("Withdrawn");
      void refetchEarnings();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Withdraw failed.");
    } finally {
      setWithdrawing(false);
    }
  };

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Marketplace"]}
        title="Template marketplace"
        subtitle={`Community templates published on ${chain.name}. Source is on-chain and free to read.`}
      />
      <div className="space-y-4 py-4 sm:py-6 px-5 sm:px-8 lg:px-12">
        {!configured ? (
          <div className="rounded border border-dashed border-border p-12 text-center">
            <Store className="mx-auto h-6 w-6 text-meta" />
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              No template registry is deployed on {chain.name}.
            </p>
            <p className="mt-1 font-mono text-[10px] text-meta">
              Switch to a network where the marketplace is live.
            </p>
          </div>
        ) : (
          <>
            {earnings > BigInt(0) && (
              <div className="flex items-center justify-between rounded border border-border bg-surface-2 p-3">
                <div className="flex items-center gap-2">
                  <Coins className="h-4 w-4 text-primary" />
                  <span className="font-mono text-xs text-foreground">
                    {formatEther(earnings)} {nativeSymbol(chainId)} earned from your templates
                  </span>
                </div>
                <button
                  onClick={() => void cashOut()}
                  disabled={withdrawing}
                  className="rounded border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                >
                  {withdrawing ? "Withdrawing…" : "Withdraw"}
                </button>
              </div>
            )}

            {loading ? (
              <p className="font-mono text-xs text-muted-foreground">Reading the registry…</p>
            ) : listed.length === 0 ? (
              <div className="rounded border border-dashed border-border p-12 text-center">
                <Store className="mx-auto h-6 w-6 text-meta" />
                <p className="mt-3 font-mono text-xs text-muted-foreground">
                  No templates published on {chain.name} yet.
                </p>
                <p className="mt-1 font-mono text-[10px] text-meta">
                  Publish one from a template you have written to be the first.
                </p>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {listed.map((t) => (
                  <div key={t.id} className="rounded border border-border bg-surface-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-mono text-sm text-foreground">{t.name}</p>
                      <span className="shrink-0 font-mono text-[10px] text-primary">
                        {t.price > BigInt(0)
                          ? `${formatEther(t.price)} ${nativeSymbol(chainId)}`
                          : "free"}
                      </span>
                    </div>
                    <p className="mt-1 font-mono text-[10px] text-meta">
                      by {shortAddr(t.creator)} · {t.deployCount} deploy
                      {t.deployCount === 1 ? "" : "s"}
                    </p>
                    <div className="mt-3 flex gap-2">
                      <button
                        onClick={() => void use(t.id, t.price)}
                        disabled={busy === t.id}
                        className="flex flex-1 items-center justify-center gap-1.5 rounded border border-border px-2 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-50"
                      >
                        {busy === t.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Download className="h-3 w-3" />
                        )}
                        Use
                      </button>
                      <button
                        onClick={() => void view(t.id)}
                        className="rounded border border-border px-2 py-1.5 font-mono text-[11px] text-muted-foreground hover:border-primary hover:text-primary"
                      >
                        Source
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {preview && (
              <div className="rounded border border-border">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <p className="font-mono text-xs text-foreground">
                    {preview.name}{" "}
                    <span className="text-meta">· by {shortAddr(preview.creator)}</span>
                  </p>
                  <button
                    onClick={() => setPreview(null)}
                    className="font-mono text-[11px] text-meta hover:text-foreground"
                  >
                    close
                  </button>
                </div>
                {preview.description && (
                  <p className="border-b border-border px-3 py-2 font-mono text-[11px] text-muted-foreground">
                    {preview.description}
                  </p>
                )}
                <pre className="max-h-80 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-muted-foreground">
                  {preview.source}
                </pre>
              </div>
            )}

            <p className="font-mono text-[10px] text-meta">
              Source is stored on-chain and readable by anyone free of charge. A template&apos;s
              price buys attribution: paying records the deploy against the template, which is what
              pays its creator. Registry {shortAddr(registry)} on {chain.name}.
              {address && " Earnings are withdrawn to your connected wallet."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
