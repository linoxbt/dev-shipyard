import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { z } from "zod";
import { ArrowLeft, ArrowRight, Check, Download, Copy, Rocket } from "lucide-react";
import { toast } from "sonner";
import { useAccount, useDeployContract, usePublicClient } from "wagmi";
import { PageHeader } from "@/components/shared/PageHeader";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { TerminalOutput, type TerminalLine } from "@/components/shared/TerminalOutput";
import { TxHashChip } from "@/components/shared/TxHashChip";
import { AddressChip } from "@/components/shared/AddressChip";
import {
  TEMPLATES,
  getTemplate,
  categoryColor,
  type Template,
  type ConstructorArg,
} from "@/lib/mock/templates";
import { GAS_PRICE_GWEI } from "@/lib/chain";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useProjectRegistry } from "@/hooks/useProjectRegistry";
import { compile } from "@/lib/compiler";

const search = z.object({ template: z.string().optional() });

export const Route = createFileRoute("/launchkit/deploy")({
  validateSearch: search,
  head: () => ({
    meta: [{ title: "Deploy a Contract — DevStation LaunchKit" }],
  }),
  component: DeployWizard,
});

type Stage = "select" | "configure" | "deploying" | "success";

function DeployWizard() {
  const { template: presetId } = Route.useSearch();
  const { address, isConnected } = useAccount();
  const { chain, config } = useActiveChain();
  const { recordDeployment } = useProjectRegistry();
  const { deployContractAsync } = useDeployContract();
  const publicClient = usePublicClient();

  const [stage, setStage] = useState<Stage>(presetId ? "configure" : "select");
  const [templateId, setTemplateId] = useState<string | null>(presetId ?? null);
  const [filter, setFilter] = useState("");
  const [args, setArgs] = useState<Record<string, string>>({});
  const [projectName, setProjectName] = useState("");
  const [deployLines, setDeployLines] = useState<TerminalLine[]>([]);
  const [deployResult, setDeployResult] = useState<null | {
    address: string;
    txHash: string;
    block: number;
  }>(null);

  const template = templateId ? (getTemplate(templateId) ?? null) : null;

  const filteredTemplates = useMemo(() => {
    const q = filter.toLowerCase();
    return TEMPLATES.filter(
      (t) => !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }, [filter]);

  const handleSelectTemplate = (t: Template) => {
    setTemplateId(t.id);
    setProjectName(t.name);
    setArgs({});
  };

  const handleConfigure = () => {
    if (!template) return;
    setStage("configure");
  };

  const log = (text: string, status: TerminalLine["status"] = "pending") =>
    setDeployLines((p) => [...p, { text, status }]);

  // Real on-chain deploy: compile in-browser, send the creation tx through the
  // connected wallet, wait for the receipt, and record it.
  const startDeploy = async () => {
    if (!template || !address || !publicClient) return;
    setStage("deploying");
    setDeployLines([]);
    const ts = () => new Date().toLocaleTimeString();

    try {
      log(`[${ts()}] [Compiler] Compiling ${template.name}.sol with solc 0.8.20...`);
      const result = await compile({
        sources: { [`${template.name}.sol`]: template.solidity },
        version: "0.8.20",
        mainFile: `${template.name}.sol`,
      });
      for (const imp of result.resolvedImports) {
        log(`[${ts()}] [Compiler] ✓ Resolved ${imp.path} via CDN`, "success");
      }
      if (result.status === "error") {
        for (const e of result.errors) log(`[${ts()}] [Error] ${e.formattedMessage}`, "error");
        toast.error("Compilation failed");
        return;
      }
      const contract = result.contracts[template.name];
      if (!contract) {
        log(`[${ts()}] [Error] Compiled output missing ${template.name}`, "error");
        return;
      }
      log(
        `[${ts()}] [Compiler] ✓ Compiled (${(contract.bytecode.length - 2) / 2} bytes)`,
        "success",
      );

      // Encode constructor args from the template's declared arg list.
      const encodedArgs = parseArgs(template.args, args);
      log(`[${ts()}] [Deploy] Submitting deployment to ${chain.name} (chain ${chain.id})...`);
      const hash = await deployContractAsync({
        abi: contract.abi as [],
        bytecode: contract.bytecode,
        args: encodedArgs.length > 0 ? encodedArgs : undefined,
        chainId: chain.id,
      });
      log(`[${ts()}] [Deploy] Transaction submitted: ${hash}`, "success");
      log(`[${ts()}] [Deploy] Waiting for confirmation...`);

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const deployedAddr = receipt.contractAddress as `0x${string}`;
      if (!deployedAddr) {
        log(`[${ts()}] [Error] No contract address in receipt`, "error");
        return;
      }
      log(`[${ts()}] [Deploy] ✓ Confirmed in block ${receipt.blockNumber}`, "success");
      log(`[${ts()}] [Deploy] ✓ Contract deployed at ${deployedAddr}`, "success");

      await recordDeployment({
        contractAddress: deployedAddr,
        templateId: template.id,
        projectName: projectName || template.name,
        network: chain.name,
        txHash: hash,
        chainId: chain.id,
      }).catch(() => {});

      setDeployResult({ address: deployedAddr, txHash: hash, block: Number(receipt.blockNumber) });
      setStage("success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Deploy failed";
      log(`[${new Date().toLocaleTimeString()}] [Error] ${msg}`, "error");
      toast.error(msg);
    }
  };

  /* ─────── STAGE: SELECT ─────── */
  if (stage === "select") {
    return (
      <div>
        <PageHeader
          breadcrumb={["DevStation", "LaunchKit", "Deploy"]}
          title="Deploy a Contract"
          subtitle="Step 1 of 3 — Select a verified template to get started."
        />
        <div className="space-y-4 p-6">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search templates..."
            className="w-full max-w-md rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
          />
          <div className="grid gap-2 md:grid-cols-2">
            {filteredTemplates.map((t) => {
              const selected = templateId === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => handleSelectTemplate(t)}
                  className={`flex items-start gap-3 rounded border p-3 text-left transition ${
                    selected
                      ? "border-info bg-info/5"
                      : "border-border bg-surface hover:border-primary/40"
                  }`}
                >
                  <div
                    className={`mt-0.5 flex h-4 w-4 items-center justify-center rounded-sm border ${
                      selected ? "border-info bg-info text-background" : "border-border"
                    }`}
                  >
                    {selected && <Check className="h-3 w-3" />}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-foreground">{t.name}</span>
                      <span
                        className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${categoryColor(
                          t.category,
                        )}`}
                      >
                        {t.category}
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-meta">
                        {t.deployCount} deploys
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{t.description}</p>
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex justify-end pt-4">
            <button
              disabled={!template}
              onClick={handleConfigure}
              className="flex items-center gap-2 rounded bg-primary px-4 py-2 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
            >
              Continue with {template?.name ?? "..."} <ArrowRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ─────── STAGE: CONFIGURE ─────── */
  if (stage === "configure" && template) {
    const gasQIE = (template.estimatedGas * GAS_PRICE_GWEI) / 1e9;
    return (
      <div>
        <PageHeader
          breadcrumb={["DevStation", "LaunchKit", "Deploy", template.name]}
          title={`Configure ${template.name}`}
          subtitle="Step 2 of 3 — Fill in constructor arguments and review deployment."
        />
        <div className="grid gap-6 p-6 lg:grid-cols-5">
          {/* Form */}
          <div className="space-y-4 lg:col-span-3">
            <div className="rounded border border-border bg-surface p-4">
              <div className="mb-3 flex items-center gap-2">
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${categoryColor(
                    template.category,
                  )}`}
                >
                  {template.category}
                </span>
                <span className="font-mono text-sm font-bold text-foreground">{template.name}</span>
              </div>
              <p className="text-xs text-muted-foreground">{template.description}</p>
            </div>

            <div className="rounded border border-border bg-surface p-4">
              <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Constructor Arguments
              </h3>
              <div className="space-y-4">
                {template.args.map((a) => (
                  <ArgField
                    key={a.name}
                    arg={a}
                    value={args[a.name] ?? ""}
                    onChange={(v) => setArgs((p) => ({ ...p, [a.name]: v }))}
                  />
                ))}
              </div>
            </div>

            <div className="rounded border border-border bg-surface p-4">
              <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Project Label
              </h3>
              <label className="block">
                <span className="font-mono text-xs text-muted-foreground">Project Name</span>
                <input
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder={template.name}
                  className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
                />
                <span className="mt-1 block text-[10px] text-meta">
                  This name will appear in Routebook whenever this contract is involved in a
                  transaction.
                </span>
              </label>
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-4 lg:col-span-2">
            <div className="rounded border border-border bg-surface p-4">
              <h3 className="mb-3 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Deployment Preview
              </h3>
              <dl className="space-y-2 font-mono text-xs">
                <PreviewRow label="Template" value={template.name} />
                <PreviewRow label="Network" value={`${chain.name} (Chain ${chain.id})`} />
                <PreviewRow label="Compiler" value="Solidity 0.8.20" />
                <PreviewRow
                  label="Est. Gas"
                  value={`~${template.estimatedGas.toLocaleString()} units`}
                />
                <PreviewRow label="Est. Cost" value={<span>~{gasQIE.toFixed(6)} QIE</span>} />
                <PreviewRow label="Compiled" value="In-browser (solc)" />
                <PreviewRow label="Registry" value={projectName || template.name} />
              </dl>
            </div>

            <div>
              <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-meta">
                Generated Constructor Call
              </div>
              <CodeBlock
                language="json"
                showLineNumbers={false}
                code={JSON.stringify(
                  Object.fromEntries(
                    template.args.map((a) => [a.name, args[a.name] || `<${a.type}>`]),
                  ),
                  null,
                  2,
                )}
              />
            </div>
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border bg-surface px-6 py-4">
          <button
            onClick={() => setStage("select")}
            className="flex items-center gap-1 rounded border border-border px-3 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
          <button
            onClick={startDeploy}
            disabled={!isConnected}
            title={isConnected ? undefined : "Connect a wallet to deploy"}
            className="flex items-center gap-2 rounded bg-primary px-5 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
          >
            <Rocket className="h-3.5 w-3.5" />
            {isConnected ? "Deploy Contract" : "Connect Wallet to Deploy"}
          </button>
        </div>
      </div>
    );
  }

  /* ─────── STAGE: DEPLOYING ─────── */
  if (stage === "deploying" && template) {
    const hasError = deployLines.some((l) => l.status === "error");
    return (
      <div>
        <PageHeader
          breadcrumb={["DevStation", "LaunchKit", "Deploy", template.name]}
          title="Deploying…"
          subtitle="Step 3 of 3 — Compile, sign in your wallet, broadcast, confirm."
        />
        <div className="space-y-4 p-6">
          <TerminalOutput lines={deployLines} instant />
          {hasError && (
            <button
              onClick={() => setStage("configure")}
              className="rounded border border-border px-4 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              ← Back to configuration
            </button>
          )}
        </div>
      </div>
    );
  }

  /* ─────── STAGE: SUCCESS ─────── */
  if (stage === "success" && template && deployResult) {
    const envContent = generateEnv(template, deployResult, projectName, config, chain.id);
    const submission = generateSubmission(
      template,
      deployResult,
      projectName,
      chain.name,
      chain.id,
      config,
    );

    return (
      <div>
        <PageHeader
          breadcrumb={["DevStation", "LaunchKit", "Deploy", template.name]}
          title="Deployed"
          subtitle="Your contract is live on-chain."
        />
        <div className="space-y-6 p-6">
          {/* Success banner */}
          <div className="rounded border border-success/40 bg-success/5 p-6">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <h2 className="font-mono text-lg font-bold text-success">Contract Deployed</h2>
                <dl className="mt-3 grid grid-cols-1 gap-2 font-mono text-xs sm:grid-cols-2">
                  <SuccessRow label="Project" value={projectName || template.name} />
                  <SuccessRow label="Template" value={template.name} />
                  <SuccessRow label="Network" value={`${chain.name} · ${chain.id}`} />
                  <SuccessRow label="Block" value={`#${deployResult.block.toLocaleString()}`} />
                  <SuccessRow
                    label="Address"
                    value={<AddressChip address={deployResult.address} showLabel={false} full />}
                  />
                  <SuccessRow label="Tx Hash" value={<TxHashChip hash={deployResult.txHash} />} />
                </dl>
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            {/* ENV */}
            <ResultCard
              title="Download .env File"
              action={
                <button
                  onClick={() => download(envContent, ".env")}
                  className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 font-mono text-xs text-primary-foreground hover:bg-primary-hover"
                >
                  <Download className="h-3 w-3" /> Download .env
                </button>
              }
            >
              <CodeBlock
                code={envContent}
                language="env"
                maxHeight="220px"
                showLineNumbers={false}
              />
            </ResultCard>

            {/* Submission */}
            <ResultCard
              title="Hackathon Submission"
              action={
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(submission);
                    toast.success("Submission copied to clipboard");
                  }}
                  className="flex items-center gap-1 rounded border border-primary px-3 py-1.5 font-mono text-xs text-primary hover:bg-primary/10"
                >
                  <Copy className="h-3 w-3" /> Copy Submission
                </button>
              }
            >
              <CodeBlock
                code={submission}
                language="env"
                maxHeight="220px"
                showLineNumbers={false}
              />
              <p className="mt-2 text-[10px] text-meta">
                Pre-filled from your deployment. Add your GitHub and demo URL before submitting.
              </p>
            </ResultCard>

            {/* Routebook */}
            <ResultCard
              title="View in Routebook"
              action={
                <Link
                  to="/routebook/$txHash"
                  params={{ txHash: deployResult.txHash }}
                  className="flex items-center gap-1 rounded bg-info px-3 py-1.5 font-mono text-xs text-background hover:bg-info/80"
                >
                  Open in Routebook <ArrowRight className="h-3 w-3" />
                </Link>
              }
            >
              <div className="space-y-2 rounded border border-border bg-background p-3 font-mono text-xs">
                <div className="text-muted-foreground">
                  → <span className="text-primary">{template.name}</span>.deploy()
                </div>
                <div className="ml-3 text-muted-foreground">
                  → <span className="text-info">ContractLabelRegistry</span>.register(...)
                </div>
                <div className="ml-3 text-muted-foreground">
                  → <span className="text-info">ProjectRegistry</span>.record(...)
                </div>
                <div className="text-success">✓ Success</div>
              </div>
            </ResultCard>
          </div>

          <div className="flex justify-end gap-2">
            <Link
              to="/launchkit/projects"
              className="rounded border border-border px-4 py-2 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
            >
              Go to My Projects
            </Link>
            <button
              onClick={() => {
                setStage("select");
                setTemplateId(null);
                setArgs({});
                setDeployResult(null);
              }}
              className="rounded bg-primary px-4 py-2 font-mono text-xs font-medium text-primary-foreground hover:bg-primary-hover"
            >
              Deploy Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

/* ─────── components ─────── */

function ArgField({
  arg,
  value,
  onChange,
}: {
  arg: ConstructorArg;
  value: string;
  onChange: (v: string) => void;
}) {
  if (arg.type === "bool") {
    const v = value === "true";
    return (
      <div>
        <Label arg={arg} />
        <button
          type="button"
          onClick={() => onChange(v ? "false" : "true")}
          className={`mt-1 inline-flex h-6 w-11 items-center rounded-full border border-border ${
            v ? "bg-primary" : "bg-background"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-foreground transition ${
              v ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
        {arg.helper && <Helper>{arg.helper}</Helper>}
      </div>
    );
  }

  if (arg.type === "address[]" || arg.type === "uint[]") {
    const items = value ? value.split(",") : [""];
    const update = (i: number, v: string) => {
      const next = [...items];
      next[i] = v;
      onChange(next.join(","));
    };
    return (
      <div>
        <Label arg={arg} />
        <div className="mt-1 space-y-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex gap-2">
              <input
                value={it}
                onChange={(e) => update(i, e.target.value)}
                placeholder={arg.type === "address[]" ? "0x..." : "0"}
                className="flex-1 rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
              />
              {items.length > 1 && (
                <button
                  type="button"
                  onClick={() => onChange(items.filter((_, j) => j !== i).join(","))}
                  className="rounded border border-border px-2 font-mono text-xs text-meta hover:border-danger hover:text-danger"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...items, ""].join(","))}
            className="font-mono text-[11px] text-primary hover:underline"
          >
            + Add item
          </button>
        </div>
        {arg.helper && <Helper>{arg.helper}</Helper>}
      </div>
    );
  }

  return (
    <div>
      <Label arg={arg} />
      <input
        type={arg.type === "uint" ? "number" : "text"}
        value={value}
        onChange={(e) => {
          let v = e.target.value;
          if (arg.uppercase) v = v.toUpperCase();
          if (arg.maxLength) v = v.slice(0, arg.maxLength);
          onChange(v);
        }}
        placeholder={arg.placeholder}
        className="mt-1 w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none"
      />
      {arg.helper && <Helper>{arg.helper}</Helper>}
    </div>
  );
}

function Label({ arg }: { arg: ConstructorArg }) {
  return (
    <label className="flex items-center justify-between font-mono text-xs text-foreground">
      <span>{arg.label}</span>
      <span className="text-[10px] text-meta">{arg.type}</span>
    </label>
  );
}

function Helper({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[10px] text-meta">{children}</p>;
}

function PreviewRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-meta">{label}</dt>
      <dd className="text-right text-foreground">{value}</dd>
    </div>
  );
}

function SuccessRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-success/20 pb-1 last:border-0">
      <span className="text-meta">{label}</span>
      <span className="text-foreground">{value}</span>
    </div>
  );
}

function ResultCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded border border-border bg-surface">
      <div className="border-b border-border px-4 py-2.5">
        <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h3>
      </div>
      <div className="flex-1 p-4">{children}</div>
      {action && <div className="border-t border-border px-4 py-3">{action}</div>}
    </div>
  );
}

/* ─────── helpers ─────── */

interface ChainCfg {
  rpcUrl: string;
  explorerUrl: string;
  name: string;
}

// Map a template's declared args + the user's form values to real,
// abi-encodable constructor arguments (in declaration order).
function parseArgs(defs: ConstructorArg[], values: Record<string, string>): unknown[] {
  return defs.map((a) => {
    const raw = (values[a.name] ?? "").trim();
    switch (a.type) {
      case "uint":
        return BigInt(raw || "0");
      case "bool":
        return raw === "true";
      case "address":
        return raw as `0x${string}`;
      case "address[]":
        return raw ? raw.split(",").map((s) => s.trim() as `0x${string}`) : [];
      case "uint[]":
        return raw ? raw.split(",").map((s) => BigInt(s.trim())) : [];
      default:
        return raw;
    }
  });
}

function generateEnv(
  template: Template,
  result: { address: string; txHash: string; block: number },
  projectName: string,
  config: ChainCfg,
  chainId: number,
) {
  return `# Generated by DevStation
# Project: ${projectName || template.name}
# Template: ${template.name}

QIE_RPC_URL=${config.rpcUrl}
QIE_CHAIN_ID=${chainId}
QIE_EXPLORER=${config.explorerUrl}

CONTRACT_ADDRESS=${result.address}
DEPLOY_TX_HASH=${result.txHash}
DEPLOY_BLOCK=${result.block}
`;
}

function generateSubmission(
  template: Template,
  result: { address: string; txHash: string; block: number },
  projectName: string,
  networkName: string,
  chainId: number,
  config: ChainCfg,
) {
  return `Project Name: ${projectName || template.name}
Template: ${template.name}
Network: ${networkName} (Chain ${chainId})
Contract: ${result.address}
Tx Hash: ${result.txHash}
Block: ${result.block}
Explorer: ${config.explorerUrl}/address/${result.address}

GitHub: <add your repo URL>
Demo: <add your demo URL>
Description: <one paragraph about your project>
`;
}

function download(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
