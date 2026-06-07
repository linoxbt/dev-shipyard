import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { ArrowLeft, Loader2, Wand2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { PageHeader } from "@/components/shared/PageHeader";
import { compile } from "@/lib/compiler";
import {
  CATEGORIES,
  type ConstructorArg,
  type Template,
  type TemplateCategory,
} from "@/lib/mock/templates";
import { useUserTemplates } from "@/lib/user-templates";

const search = z.object({ edit: z.string().optional() });

export const Route = createFileRoute("/launchkit/templates/submit")({
  validateSearch: search,
  head: () => ({ meta: [{ title: "Submit a Template — DevStation" }] }),
  component: SubmitTemplate,
});

const STARTER = `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MyContract {
    string public greeting;

    constructor(string memory greeting_) {
        greeting = greeting_;
    }
}
`;

// Map an ABI input type to our simpler ConstructorArg type.
function abiTypeToArg(t: string): ConstructorArg["type"] {
  if (t === "address[]") return "address[]";
  if (/^(u?int\d*)\[\]$/.test(t)) return "uint[]";
  if (t === "address") return "address";
  if (t === "bool") return "bool";
  if (t.startsWith("uint") || t.startsWith("int")) return "uint";
  return "string";
}

function SubmitTemplate() {
  const { edit: editId } = Route.useSearch();
  const navigate = useNavigate();
  const { address, isConnected } = useAccount();

  const userTemplates = useUserTemplates((s) => s.templates);
  const hydrate = useUserTemplates((s) => s.hydrate);
  const add = useUserTemplates((s) => s.add);
  const update = useUserTemplates((s) => s.update);
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const editing = useMemo(
    () => (editId ? userTemplates.find((t) => t.id === editId) : undefined),
    [editId, userTemplates],
  );

  const [category, setCategory] = useState<TemplateCategory>("Custom");
  const [description, setDescription] = useState("");
  const [longDescription, setLongDescription] = useState("");
  const [tags, setTags] = useState("");
  const [requiresImage, setRequiresImage] = useState(false);
  const [source, setSource] = useState(STARTER);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Prefill when editing an existing community template.
  useEffect(() => {
    if (editing && !loaded) {
      setCategory(editing.category);
      setDescription(editing.description);
      setLongDescription(editing.longDescription);
      setTags(editing.tags.join(", "));
      setRequiresImage(editing.requiresImage ?? false);
      setSource(editing.solidity);
      setLoaded(true);
    }
  }, [editing, loaded]);

  // Ownership guard for edit mode.
  const ownsEdit = !editId || (editing && editing.submitter && editing.submitter === address);
  if (editId && editing && !ownsEdit) {
    return (
      <div>
        <PageHeader
          breadcrumb={["DevStation", "LaunchKit", "Templates", "Edit"]}
          title="Edit Template"
        />
        <div className="p-6">
          <div className="flex items-center gap-2 rounded border border-warning/40 bg-warning/10 p-4 font-mono text-xs text-warning">
            <AlertTriangle className="h-4 w-4" />
            Only the wallet that submitted this template can edit it.
          </div>
        </div>
      </div>
    );
  }

  const submit = async () => {
    setErrors([]);
    if (!isConnected || !address) {
      toast.error("Connect a wallet to submit a template");
      return;
    }
    if (!description.trim()) {
      setErrors(["A short description is required."]);
      return;
    }
    setBusy(true);
    try {
      // Compile so we can derive the ABI + constructor args, and to guarantee the
      // template actually deploys.
      const result = await compile({
        sources: { "Template.sol": source },
        version: "0.8.20",
        mainFile: "Template.sol",
      });
      if (result.status === "error") {
        setErrors(result.errors.map((e) => e.formattedMessage));
        return;
      }
      // Pick the deployable contract (has bytecode). Prefer the last defined.
      const entries = Object.entries(result.contracts).filter(([, c]) => c.bytecode.length > 2);
      if (entries.length === 0) {
        setErrors(["No deployable contract found in the source."]);
        return;
      }
      const [contractName, contract] = entries[entries.length - 1];

      const ctor = (
        contract.abi as Array<{ type: string; inputs?: { name: string; type: string }[] }>
      ).find((i) => i.type === "constructor");
      const args: ConstructorArg[] = (ctor?.inputs ?? []).map((inp) => ({
        name: inp.name || "arg",
        label: inp.name || inp.type,
        type: abiTypeToArg(inp.type),
        placeholder: inp.type === "address" ? "0x..." : "",
      }));

      const tagList = tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const base: Template = {
        id: editing?.id ?? `u-${contractName.toLowerCase()}-${Date.now().toString(36)}`,
        name: contractName,
        category,
        description: description.trim(),
        longDescription: longDescription.trim() || description.trim(),
        tags: tagList,
        verified: false,
        deployCount: editing?.deployCount ?? 0,
        solidity: source,
        abi: JSON.stringify(contract.abi),
        args,
        author: address,
        submitter: editing?.submitter ?? address,
        requiresImage,
        version: editing?.version ?? "1.0.0",
        estimatedGas: 500000,
        createdAt: editing?.createdAt ?? Date.now(),
      };

      if (editing) update(editing.id, base);
      else add(base);
      toast.success(editing ? "Template updated" : "Template submitted");
      navigate({ to: "/launchkit/templates/$id", params: { id: base.id } });
    } catch (e) {
      setErrors([e instanceof Error ? e.message : "Compilation failed"]);
    } finally {
      setBusy(false);
    }
  };

  const field =
    "w-full rounded border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-meta focus:border-primary focus:outline-none";
  const label = "mb-1 block font-mono text-[11px] uppercase tracking-wider text-meta";

  return (
    <div>
      <PageHeader
        breadcrumb={["DevStation", "LaunchKit", "Templates", editing ? "Edit" : "Submit"]}
        title={editing ? `Edit ${editing.name}` : "Submit a Template"}
        subtitle="Share a Solidity contract template. We compile it on submit to derive its ABI and constructor inputs — so it's instantly deployable."
        action={
          <Link
            to="/launchkit/templates"
            className="flex items-center gap-1 rounded border border-border px-3 py-1.5 font-mono text-xs text-muted-foreground hover:border-primary hover:text-primary"
          >
            <ArrowLeft className="h-3 w-3" /> Back
          </Link>
        }
      />

      <div className="grid gap-6 p-6 lg:grid-cols-5">
        {/* Metadata */}
        <div className="space-y-4 lg:col-span-2">
          {!isConnected && (
            <div className="rounded border border-warning/40 bg-warning/10 p-3 font-mono text-[11px] text-warning">
              Connect a wallet to submit — it becomes the template owner (only it can edit later).
            </div>
          )}
          <div>
            <label className={label}>Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as TemplateCategory)}
              className={field}
            >
              {CATEGORIES.filter((c) => c !== "All").map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>
              Short description <span className="text-danger">*</span>
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One line shown on the template card"
              className={field}
            />
          </div>
          <div>
            <label className={label}>Long description</label>
            <textarea
              value={longDescription}
              onChange={(e) => setLongDescription(e.target.value)}
              rows={4}
              placeholder="Optional. Shown on the template detail page."
              className={`${field} resize-none`}
            />
          </div>
          <div>
            <label className={label}>Tags (comma separated)</label>
            <input
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="erc20, token, mintable"
              className={field}
            />
          </div>
          <label className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={requiresImage}
              onChange={(e) => setRequiresImage(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Deploying this template needs an image (e.g. NFT artwork)
          </label>

          <button
            onClick={submit}
            disabled={busy}
            className="flex w-full items-center justify-center gap-2 rounded bg-primary px-4 py-2 font-mono text-xs font-bold text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Wand2 className="h-3.5 w-3.5" />
            )}
            {busy ? "Compiling…" : editing ? "Save Changes" : "Compile & Submit"}
          </button>

          {errors.length > 0 && (
            <div className="space-y-1 rounded border border-danger/40 bg-danger/10 p-3 font-mono text-[10px] text-danger">
              {errors.map((e, i) => (
                <p key={i} className="whitespace-pre-wrap break-words">
                  {e}
                </p>
              ))}
            </div>
          )}
        </div>

        {/* Source */}
        <div className="lg:col-span-3">
          <label className={label}>
            Solidity source <span className="text-danger">*</span>
          </label>
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            rows={26}
            className="w-full rounded border border-border bg-[#0d1117] px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground focus:border-primary focus:outline-none"
          />
          <p className="mt-1 font-mono text-[10px] text-meta">
            Must be self-contained or use only OpenZeppelin imports (resolved from CDN). The
            contract name becomes the template name.
          </p>
        </div>
      </div>
    </div>
  );
}
