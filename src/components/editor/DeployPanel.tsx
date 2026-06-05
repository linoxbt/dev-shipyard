import { useState, useMemo, useEffect, useRef } from "react";
import { X, Rocket, ExternalLink, Copy, Check } from "lucide-react";
import { useDeployContract, useWaitForTransactionReceipt } from "wagmi";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import { useProjectRegistry } from "@/hooks/useProjectRegistry";
import { chainConfig } from "@/lib/chains";
import type { TerminalLine } from "@/components/shared/TerminalOutput";

interface ContractInfo {
  abi: unknown[];
  bytecode: `0x${string}`;
  deployedBytecode: `0x${string}`;
}

interface Props {
  contracts: Record<string, ContractInfo>;
  chainId: number;
  onClose: () => void;
  onLog: (line: TerminalLine) => void;
}

export function DeployPanel({ contracts, chainId, onClose, onLog }: Props) {
  const names = Object.keys(contracts);
  const [selected, setSelected] = useState(names[0] ?? "");
  const contract = contracts[selected];
  const { address } = useAccount();
  const { recordDeployment, onChain } = useProjectRegistry();
  const { deployContractAsync } = useDeployContract();
  const [txHash, setTxHash] = useState<`0x${string}` | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState<{ addr: `0x${string}` } | null>(null);
  const [args, setArgs] = useState<Record<string, string>>({});

  const { data: receipt } = useWaitForTransactionReceipt({
    hash: txHash as `0x${string}` | undefined,
  });

  // Parse constructor args from ABI
  const constructorArgs = useMemo(() => {
    if (!contract?.abi) return [];
    const c = contract.abi.find(
      (item: unknown) =>
        typeof item === "object" &&
        item !== null &&
        (item as Record<string, unknown>).type === "constructor",
    ) as { inputs?: Array<{ name: string; type: string; internalType?: string }> } | undefined;
    return c?.inputs ?? [];
  }, [contract]);

  const handleDeploy = async () => {
    if (!contract || !address) return;
    setDeploying(true);
    const ts = new Date().toLocaleTimeString();
    const cfg = chainConfig(chainId);
    try {
      const parsed = constructorArgs.map((a) => {
        const v = args[a.name] ?? "";
        if (a.type.startsWith("uint")) return BigInt(v || "0");
        if (a.type === "bool") return v === "true";
        if (a.type === "address") return v as `0x${string}`;
        if (a.type.endsWith("[]")) return v ? v.split(",").map((x) => x.trim()) : [];
        return v;
      });

      onLog({
        text: `[${ts}] [Deploy] Deploying ${selected} to ${cfg.name}...`,
        status: "pending",
      });
      const hash = await deployContractAsync({
        abi: contract.abi as [],
        bytecode: contract.bytecode,
        args: parsed.length > 0 ? parsed : undefined,
      });
      setTxHash(hash);
      onLog({ text: `[${ts}] [Deploy] TX submitted: ${hash}`, status: "success" });
      onLog({ text: `[${ts}] [Deploy] Waiting for confirmation...`, status: "pending" });

      // Wait is handled by useWaitForTransactionReceipt in a parent effect-like way
      toast.success("Transaction sent");
    } catch (err) {
      onLog({
        text: `[${ts}] [Error] ${err instanceof Error ? err.message : "Deploy failed"}`,
        status: "error",
      });
      toast.error(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  };

  // Once the deployment receipt arrives, record it (on-chain registry when
  // configured, always localStorage) and surface the address.
  const recordedRef = useRef(false);
  useEffect(() => {
    if (!receipt || !txHash || recordedRef.current) return;
    recordedRef.current = true;
    const addr = receipt.contractAddress as `0x${string}`;
    setDeployed({ addr });
    const ts = new Date().toLocaleTimeString();
    onLog({ text: `[${ts}] [Deploy] ✓ Confirmed — address: ${addr}`, status: "success" });
    const cfg = chainConfig(chainId);
    void recordDeployment({
      contractAddress: addr,
      templateId: "custom",
      projectName: selected,
      network: cfg.name,
      txHash,
      chainId,
    })
      .then(() => {
        if (onChain) {
          onLog({ text: `[${ts}] [Deploy] ✓ Recorded in ProjectRegistry`, status: "success" });
        }
      })
      .catch(() => {
        onLog({
          text: `[${ts}] [Warning] Saved locally; on-chain registry record failed`,
          status: "warning",
        });
      });
  }, [receipt, txHash, chainId, selected, recordDeployment, onChain, onLog]);

  const [copied, setCopied] = useState(false);
  const cfg = chainConfig(chainId);

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[320px] border-l border-border bg-surface shadow-lg">
      <div className="flex h-full flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="font-mono text-sm font-bold text-primary">Deploy</h2>
          <button onClick={onClose} className="text-meta hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 p-4">
          {/* Contract selector */}
          <div>
            <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-meta">
              Contract
            </div>
            <select
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                setArgs({});
              }}
              className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground"
            >
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>

          {/* Constructor args */}
          {constructorArgs.length > 0 ? (
            <div>
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-meta">
                Constructor Arguments
              </div>
              {constructorArgs.map((a) => (
                <div key={a.name} className="mb-2">
                  <div className="flex items-baseline justify-between font-mono text-[10px]">
                    <span className="text-foreground">{a.name}</span>
                    <span className="text-meta">{a.type}</span>
                  </div>
                  {a.type === "bool" ? (
                    <button
                      onClick={() =>
                        setArgs((p) => ({
                          ...p,
                          [a.name]: p[a.name] === "true" ? "false" : "true",
                        }))
                      }
                      className={`mt-0.5 inline-flex h-5 w-9 items-center rounded-full border border-border ${args[a.name] === "true" ? "bg-primary" : "bg-background"}`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-foreground transition ${args[a.name] === "true" ? "translate-x-5" : "translate-x-0.5"}`}
                      />
                    </button>
                  ) : (
                    <input
                      value={args[a.name] ?? ""}
                      onChange={(e) => setArgs((p) => ({ ...p, [a.name]: e.target.value }))}
                      placeholder={a.type === "address" ? "0x..." : ""}
                      className="mt-0.5 w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-meta"
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="font-mono text-[11px] text-meta">No constructor arguments</p>
          )}

          {/* Deploy button */}
          <button
            onClick={handleDeploy}
            disabled={deploying || !address}
            className="flex w-full items-center justify-center gap-2 rounded bg-primary px-3 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
          >
            <Rocket className="h-3.5 w-3.5" /> {deploying ? "Deploying…" : "Deploy Contract"}
          </button>
          {!address && (
            <p className="text-center font-mono text-[10px] text-meta">
              Connect a wallet to deploy
            </p>
          )}

          {/* Post-deploy */}
          {deployed && (
            <div className="space-y-2 rounded border border-success/40 bg-success/5 p-3">
              <div className="font-mono text-[10px] uppercase tracking-wider text-success">
                Deployed
              </div>
              <div className="break-all font-mono text-[11px] text-foreground">{deployed.addr}</div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(deployed.addr);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                  className="flex items-center gap-1 font-mono text-[10px] text-meta hover:text-foreground"
                >
                  {copied ? (
                    <Check className="h-3 w-3 text-success" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}{" "}
                  Copy
                </button>
                <a
                  href={`${cfg.explorerUrl}/address/${deployed.addr}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
                >
                  Explorer <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
