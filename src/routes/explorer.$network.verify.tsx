import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { CheckCircle2, XCircle, Loader2, ShieldCheck } from "lucide-react";
import { z } from "zod";
import { Card } from "@/components/explorer/ui";
import { useExplorerNetwork, chainIdForSlug } from "@/lib/explorer/network";
import { useVerifyContract } from "@/hooks/useVerifyContract";
import { SOLC_VERSIONS, DEFAULT_SOLC_VERSION } from "@/lib/compiler";
import { contractNameOf } from "@/lib/solidity-name";

const search = z.object({
  address: z.string().optional(),
});

export const Route = createFileRoute("/explorer/$network/verify")({
  validateSearch: search,
  head: () => ({ meta: [{ title: "Verify Contract — QIE Explorer" }] }),
  component: VerifyPage,
});

const LICENSES = [
  { id: "mit", label: "MIT" },
  { id: "gnu_gpl_v3", label: "GPL-3.0" },
  { id: "apache_2_0", label: "Apache-2.0" },
  { id: "unlicense", label: "Unlicense" },
  { id: "none", label: "No License" },
];

function VerifyPage() {
  const network = useExplorerNetwork();
  const chainId = chainIdForSlug(network);
  const { address: presetAddress } = Route.useSearch();
  const { verify, reset, state, message } = useVerifyContract();

  const [address, setAddress] = useState(presetAddress ?? "");
  const [contractName, setContractName] = useState("");
  const [compilerVersion, setCompilerVersion] = useState<string>(DEFAULT_SOLC_VERSION);
  const [optimization, setOptimization] = useState(false);
  const [optimizationRuns, setOptimizationRuns] = useState(200);
  const [license, setLicense] = useState("mit");
  const [sourceCode, setSourceCode] = useState("");

  const busy = state === "submitting" || state === "pending";
  const addrValid = /^0x[a-fA-F0-9]{40}$/.test(address.trim());
  const canSubmit = addrValid && sourceCode.trim().length > 0 && !busy;

  const onSourceBlur = () => {
    if (!contractName) {
      const n = contractNameOf(sourceCode);
      if (n) setContractName(n);
    }
  };

  const submit = () => {
    if (!canSubmit) return;
    void verify({
      chainId,
      address: address.trim() as `0x${string}`,
      contractName: contractName.trim() || contractNameOf(sourceCode) || "Contract",
      sourceCode,
      compilerVersion,
      optimization,
      optimizationRuns,
      licenseType: license,
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" />
        <h1 className="font-mono text-lg font-bold text-foreground">
          Verify &amp; Publish Contract
        </h1>
      </div>
      <p className="font-mono text-xs text-meta">
        Verify a contract&apos;s source on the QIE {network} explorer (single-file / flattened
        Solidity). Once verified, the contract page shows its source, ABI, and Read/Write functions.
      </p>

      <Card title="Contract details">
        <div className="space-y-4 p-4">
          <Field label="Contract Address" required>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0x..."
              disabled={busy}
              className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
            />
            {address && !addrValid && (
              <span className="text-[10px] text-danger">Enter a valid 0x address.</span>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Compiler Version" required>
              <select
                value={compilerVersion}
                onChange={(e) => setCompilerVersion(e.target.value)}
                disabled={busy}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
              >
                {SOLC_VERSIONS.map((v) => (
                  <option key={v} value={v}>
                    v{v}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="License">
              <select
                value={license}
                onChange={(e) => setLicense(e.target.value)}
                disabled={busy}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
              >
                {LICENSES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Contract Name">
              <input
                value={contractName}
                onChange={(e) => setContractName(e.target.value)}
                placeholder="auto-detected from source"
                disabled={busy}
                className="w-full rounded border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
              />
            </Field>

            <Field label="Optimization">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={optimization}
                    onChange={(e) => setOptimization(e.target.checked)}
                    disabled={busy}
                    className="h-3.5 w-3.5"
                  />
                  Enabled
                </label>
                {optimization && (
                  <input
                    type="number"
                    value={optimizationRuns}
                    onChange={(e) => setOptimizationRuns(Number(e.target.value) || 200)}
                    disabled={busy}
                    className="w-24 rounded border border-border bg-background px-2 py-1 font-mono text-xs text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
                    title="Optimizer runs"
                  />
                )}
              </div>
            </Field>
          </div>

          <Field label="Solidity Source Code (flattened / single file)" required>
            <textarea
              value={sourceCode}
              onChange={(e) => setSourceCode(e.target.value)}
              onBlur={onSourceBlur}
              rows={14}
              placeholder="// SPDX-License-Identifier: MIT&#10;pragma solidity ^0.8.20;&#10;&#10;contract MyContract { ... }"
              disabled={busy}
              className="w-full resize-y rounded border border-border bg-background px-2 py-2 font-mono text-[11px] leading-relaxed text-foreground focus:border-primary focus:outline-none disabled:opacity-60"
            />
            <span className="text-[10px] text-meta">
              Must include all imports inline. Use the Contract Editor&apos;s flatten output for
              contracts with OpenZeppelin imports.
            </span>
          </Field>

          {/* Status */}
          {state !== "idle" && (
            <div
              className={`flex items-start gap-2 rounded border p-3 font-mono text-xs ${
                state === "verified"
                  ? "border-success/40 bg-success/10 text-success"
                  : state === "failed"
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-primary/40 bg-primary/10 text-foreground"
              }`}
            >
              {state === "verified" ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              ) : state === "failed" ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
              )}
              <span className="break-words">{message}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            {state === "verified" ? (
              <Link
                to="/explorer/$network/address/$hash"
                params={{ network, hash: address.trim() }}
                className="inline-flex items-center gap-1.5 rounded bg-primary px-4 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover"
              >
                View verified contract →
              </Link>
            ) : (
              <button
                onClick={submit}
                disabled={!canSubmit}
                className="inline-flex items-center gap-1.5 rounded bg-primary px-4 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-40"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                {busy ? "Verifying…" : "Verify & Publish"}
              </button>
            )}
            {(state === "failed" || state === "verified") && (
              <button
                onClick={reset}
                className="rounded border border-border px-4 py-2 font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                {state === "verified" ? "Verify another" : "Reset"}
              </button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="font-mono text-[11px] text-muted-foreground">
        {label} {required && <span className="text-danger">*</span>}
      </span>
      {children}
    </label>
  );
}
