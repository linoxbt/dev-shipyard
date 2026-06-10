// The autonomous build loop for "Code with AI": stream the model, parse its
// directive, run the requested tool (compile in-browser, deploy via the
// connected wallet), feed the result back, and repeat — up to a fix/turn cap.
// All tool execution is client-side (the solc worker and the wallet both live
// in the browser), so the loop runs here, not on the server.
//
// The run (timeline + model conversation + last artifact) is persisted to
// localStorage so it survives reloads, and a deploy that needs constructor
// arguments PAUSES the loop to show the user a form before signing.

import { useEffect, useReducer, useRef, useState } from "react";
import { useAccount, useDeployContract, usePublicClient } from "wagmi";
import { compile, DEFAULT_SOLC_VERSION, type CompileOutput } from "@/lib/compiler";
import { chatStream } from "@/lib/ai";
import { useActiveChain } from "@/hooks/useActiveChain";
import { useProjectRegistry } from "@/hooks/useProjectRegistry";
import { slugForChainId } from "@/lib/explorer/network";
import {
  SOLIDITY_AGENT_PROMPT,
  parseAction,
  compileOkMessage,
  compileErrorMessage,
  compileGaveUpMessage,
  deployOkMessage,
  deployErrorMessage,
  suggestedFormValues,
} from "@/lib/ai-agent";
import type { ChatMessage } from "@/lib/ai";

const MAX_FIX_ATTEMPTS = 5; // failed compiles before the agent gives up
const MAX_TURNS = 16; // hard backstop on total model turns per run
const STORAGE_KEY = "devstation-agent-run-v1";

export interface ConstructorInput {
  name: string;
  type: string;
}

export interface ToolStep {
  kind: "compile" | "deploy" | "record";
  status: "running" | "ok" | "error";
  title: string;
  detail?: string;
  address?: `0x${string}`;
  txHash?: `0x${string}`;
}

export type TimelineItem =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; step: ToolStep }
  | {
      type: "deploy-form";
      id: string;
      artifactName: string;
      inputs: ConstructorInput[];
      suggested: Record<string, string>;
      status: "pending" | "submitted" | "cancelled";
    };

interface Artifact {
  name: string;
  abi: unknown[];
  bytecode: `0x${string}`;
  constructorInputs: ConstructorInput[];
}

interface Persisted {
  timeline: TimelineItem[];
  convo: ChatMessage[];
  artifact: Artifact | null;
}

function load(): Persisted {
  if (typeof localStorage === "undefined") return { timeline: [], convo: [], artifact: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { timeline: [], convo: [], artifact: null };
    const p = JSON.parse(raw) as Persisted;
    return { timeline: p.timeline ?? [], convo: p.convo ?? [], artifact: p.artifact ?? null };
  } catch {
    return { timeline: [], convo: [], artifact: null };
  }
}

function save(p: Persisted) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* quota / serialization — non-fatal */
  }
}

// Pick the deployable contract from a compile output: the one the model named,
// else the contract with the most bytecode (skips interfaces/libraries whose
// creation bytecode is empty).
function pickContract(out: CompileOutput, preferred?: string): string | null {
  const entries = Object.entries(out.contracts).filter(([, c]) => c.bytecode.length > 2);
  if (entries.length === 0) return null;
  if (preferred && out.contracts[preferred]?.bytecode.length > 2) return preferred;
  entries.sort((a, b) => b[1].bytecode.length - a[1].bytecode.length);
  return entries[0][0];
}

function constructorInputsOf(abi: unknown[]): ConstructorInput[] {
  const ctor = abi.find(
    (i) => typeof i === "object" && i !== null && (i as { type?: string }).type === "constructor",
  ) as { inputs?: ConstructorInput[] } | undefined;
  return ctor?.inputs ?? [];
}

// Coerce a single value to the type viem needs for an ABI input.
function coerceValue(type: string, v: unknown): unknown {
  if (type.endsWith("[]")) {
    if (Array.isArray(v)) return v;
    const s = String(v ?? "").trim();
    if (!s) return [];
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* fall through to comma-split */
    }
    return s.split(",").map((x) => x.trim());
  }
  if (type.startsWith("uint") || type.startsWith("int")) return BigInt((v ?? 0) as string);
  if (type === "bool") return v === true || v === "true";
  return v;
}

// Build the ordered, typed constructor args from a form's {name: value} map.
function argsFromForm(inputs: ConstructorInput[], values: Record<string, string>): unknown[] {
  return inputs.map((inp) => coerceValue(inp.type, values[inp.name]));
}

export function useCodeAgent() {
  const timelineRef = useRef<TimelineItem[]>([]);
  const convoRef = useRef<ChatMessage[]>([]);
  const artifactRef = useRef<Artifact | null>(null);
  const compileFailsRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [running, setRunning] = useState(false);

  const { address, isConnected } = useAccount();
  const { deployContractAsync } = useDeployContract();
  const publicClient = usePublicClient();
  const { chainId, chain, walletMismatch, syncWallet } = useActiveChain();
  const { recordDeployment } = useProjectRegistry();

  // Hydrate the saved run once on mount.
  useEffect(() => {
    const p = load();
    timelineRef.current = p.timeline;
    convoRef.current = p.convo;
    artifactRef.current = p.artifact;
    force();
  }, []);

  const persist = () =>
    save({ timeline: timelineRef.current, convo: convoRef.current, artifact: artifactRef.current });
  // commit() re-renders during streaming; commitSave() also persists (used at
  // message/step boundaries to avoid writing localStorage on every token).
  const commit = () => force();
  const commitSave = () => {
    persist();
    force();
  };

  const push = (item: TimelineItem): number => {
    timelineRef.current.push(item);
    commitSave();
    return timelineRef.current.length - 1;
  };
  const updateAssistant = (idx: number, chunk: string) => {
    const it = timelineRef.current[idx];
    if (it && it.type === "assistant") {
      it.text += chunk;
      commit();
    }
  };
  const updateStep = (idx: number, patch: Partial<ToolStep>) => {
    const it = timelineRef.current[idx];
    if (it && it.type === "tool") {
      it.step = { ...it.step, ...patch };
      commitSave();
    }
  };
  const setFormStatus = (id: string, status: "submitted" | "cancelled") => {
    const it = timelineRef.current.find((t) => t.type === "deploy-form" && t.id === id);
    if (it && it.type === "deploy-form") {
      it.status = status;
      commitSave();
    }
  };

  const stop = () => abortRef.current?.abort();

  const reset = () => {
    abortRef.current?.abort();
    timelineRef.current = [];
    convoRef.current = [];
    artifactRef.current = null;
    compileFailsRef.current = 0;
    setRunning(false);
    commitSave();
  };

  // Deploy the current artifact with already-typed args, record it, and push the
  // result both to the UI and back to the model conversation.
  const doDeploy = async (args: unknown[]) => {
    const artifact = artifactRef.current;
    const sIdx = push({
      type: "tool",
      step: { kind: "deploy", status: "running", title: `Deploying to ${chain.name}…` },
    });
    try {
      if (!artifact) throw new Error("No compiled contract yet — compile first.");
      if (!isConnected || !address)
        throw new Error("No wallet connected. Connect a wallet to deploy.");
      if (!publicClient) throw new Error("No RPC client for the selected network.");
      if (walletMismatch) {
        await syncWallet().catch(() => {
          throw new Error(`Switch your wallet to ${chain.name} to deploy.`);
        });
      }
      const hash = await deployContractAsync({
        abi: artifact.abi as [],
        bytecode: artifact.bytecode,
        args: args.length > 0 ? args : undefined,
        chainId,
      });
      updateStep(sIdx, { title: `Deploying ${artifact.name}… confirming`, txHash: hash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const addr = receipt.contractAddress as `0x${string}` | null;
      if (!addr) throw new Error("Deploy mined but no contract address in the receipt.");
      updateStep(sIdx, {
        status: "ok",
        title: `Deployed ${artifact.name}`,
        detail: `block ${receipt.blockNumber}`,
        address: addr,
        txHash: hash,
      });
      convoRef.current.push({
        role: "user",
        content: deployOkMessage(
          artifact.name,
          addr,
          hash,
          Number(receipt.blockNumber),
          chain.name,
        ),
      });

      // Record on the ProjectRegistry so it shows on My Projects (also mirrored
      // to local history). Best-effort: a failed record must not fail the deploy
      // — and it prompts a second wallet signature.
      const rIdx = push({
        type: "tool",
        step: { kind: "record", status: "running", title: "Recording to My Projects…" },
      });
      try {
        await recordDeployment({
          contractAddress: addr,
          templateId: "custom",
          templateName: "AI Agent",
          projectName: artifact.name,
          network: chain.name,
          txHash: hash,
          chainId,
          abi: artifact.abi,
        });
        updateStep(rIdx, { status: "ok", title: "Recorded to My Projects" });
      } catch (e) {
        updateStep(rIdx, {
          status: "error",
          title: "Saved locally (onchain record skipped)",
          detail: e instanceof Error ? e.message : undefined,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Deploy failed";
      updateStep(sIdx, { status: "error", title: "Deploy failed", detail: msg });
      convoRef.current.push({ role: "user", content: deployErrorMessage(msg) });
    }
  };

  // The model<->tool loop. Returns when the agent is DONE, hits the turn cap, or
  // PAUSES for a constructor-args form (the loop is resumed by submitDeployForm).
  const runModelLoop = async (controller: AbortController) => {
    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        const aIdx = push({ type: "assistant", text: "" });
        const full = await chatStream({
          system: SOLIDITY_AGENT_PROMPT,
          messages: convoRef.current,
          signal: controller.signal,
          onDelta: (c) => updateAssistant(aIdx, c),
        });
        convoRef.current.push({ role: "assistant", content: full });
        commitSave();

        const action = parseAction(full);

        if (action.kind === "compile") {
          if (!action.source) {
            convoRef.current.push({
              role: "user",
              content:
                "[TOOL RESULT] No Solidity code block found in your message. Include the full contract in a ```solidity block and @@COMPILE again.",
            });
            continue;
          }
          const sIdx = push({
            type: "tool",
            step: { kind: "compile", status: "running", title: "Compiling…" },
          });
          const out = await compile({
            sources: { "Contract.sol": action.source },
            version: DEFAULT_SOLC_VERSION,
            mainFile: "Contract.sol",
          });

          if (out.status === "success") {
            const name = pickContract(out, action.name);
            if (!name) {
              updateStep(sIdx, { status: "error", title: "No deployable contract" });
              convoRef.current.push({
                role: "user",
                content:
                  "[TOOL RESULT] Compiled, but no deployable contract (only interfaces/libraries). Provide a concrete contract and @@COMPILE again.",
              });
              continue;
            }
            const c = out.contracts[name];
            const constructorInputs = constructorInputsOf(c.abi);
            artifactRef.current = { name, abi: c.abi, bytecode: c.bytecode, constructorInputs };
            const bytes = (c.bytecode.length - 2) / 2;
            updateStep(sIdx, {
              status: "ok",
              title: `Compiled ${name}`,
              detail: `${bytes.toLocaleString()} bytes · solc ${DEFAULT_SOLC_VERSION}`,
            });
            convoRef.current.push({
              role: "user",
              content: compileOkMessage(name, bytes, constructorInputs),
            });
          } else {
            compileFailsRef.current++;
            const left = MAX_FIX_ATTEMPTS - compileFailsRef.current;
            updateStep(sIdx, {
              status: "error",
              title: `Compile failed (attempt ${compileFailsRef.current}/${MAX_FIX_ATTEMPTS})`,
              detail: out.errors[0]?.formattedMessage || out.errors[0]?.message,
            });
            convoRef.current.push({
              role: "user",
              content:
                compileFailsRef.current >= MAX_FIX_ATTEMPTS
                  ? compileGaveUpMessage(out.errors)
                  : compileErrorMessage(out.errors, left),
            });
          }
          continue;
        }

        if (action.kind === "deploy") {
          const artifact = artifactRef.current;
          if (!artifact) {
            convoRef.current.push({
              role: "user",
              content: deployErrorMessage("No compiled contract yet — @@COMPILE first."),
            });
            continue;
          }
          // Constructor args present → PAUSE and let the user fill a form.
          if (artifact.constructorInputs.length > 0) {
            push({
              type: "deploy-form",
              id: `form-${turn}-${timelineRef.current.length}`,
              artifactName: artifact.name,
              inputs: artifact.constructorInputs,
              suggested: suggestedFormValues(artifact.constructorInputs, action.args, address),
              status: "pending",
            });
            return; // paused — resumed by submitDeployForm / cancelDeployForm
          }
          // No constructor args → deploy directly.
          await doDeploy([]);
          continue;
        }

        break; // done or no directive
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        push({
          type: "assistant",
          text: `⚠ ${e instanceof Error ? e.message : "The agent run failed."}`,
        });
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const run = async (prompt: string) => {
    if (running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    compileFailsRef.current = 0;
    push({ type: "user", text: prompt });
    convoRef.current.push({ role: "user", content: prompt });
    await runModelLoop(controller);
  };

  // User submitted the constructor form → deploy with their values, then resume
  // the model loop so the agent summarizes and finishes.
  const submitDeployForm = async (formId: string, values: Record<string, string>) => {
    if (running) return;
    const form = timelineRef.current.find((t) => t.type === "deploy-form" && t.id === formId);
    if (!form || form.type !== "deploy-form" || form.status !== "pending") return;
    setFormStatus(formId, "submitted");
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    await doDeploy(argsFromForm(form.inputs, values));
    await runModelLoop(controller);
  };

  const cancelDeployForm = (formId: string) => {
    setFormStatus(formId, "cancelled");
    convoRef.current.push({
      role: "user",
      content:
        "[TOOL RESULT] The user cancelled the deployment. Acknowledge briefly and @@DONE (do not deploy).",
    });
    commitSave();
  };

  return {
    timeline: timelineRef.current,
    running,
    run,
    stop,
    reset,
    submitDeployForm,
    cancelDeployForm,
    isConnected,
    targetChain: chain,
    explorerSlug: slugForChainId(chainId),
  };
}
