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
import type { Abi } from "viem";
import { useProjectRegistry } from "@/hooks/useProjectRegistry";
import { useContractLabels } from "@/hooks/useContractLabels";
import { normalizeLabelCategory } from "@/lib/labels/categories";
import { runStaticAnalysis } from "@/lib/staticAnalysis";
import { reviewFindings, summarise, canDeploy } from "@/lib/security/gate";
import { runSuite } from "@/lib/testing/runner";
import { testSuite } from "@/lib/testing/types";
import { useSponsorTopup } from "@/hooks/useSponsorTopup";
import { isSponsorEligibleChain } from "@/lib/sponsor/pricing";
import { slugForChainId } from "@/lib/explorer/network";
import {
  submitStandardJsonVerification,
  getVerificationStatus,
  getIsContractIndexed,
} from "@/lib/api/verify.functions";
import { encodeConstructorArgs } from "@/lib/verify/constructorArgs";
import {
  SOLIDITY_AGENT_PROMPT,
  parseAction,
  compileOkMessage,
  compileErrorMessage,
  compileGaveUpMessage,
  deployOkMessage,
  deployErrorMessage,
  testOkMessage,
  testFailMessage,
  testSetupFailMessage,
  testGaveUpMessage,
  reviewOkMessage,
  reviewBlockedMessage,
  reviewGaveUpMessage,
  labelOkMessage,
  labelErrorMessage,
  suggestedFormValues,
} from "@/lib/ai-agent";
import type { ChatMessage } from "@/lib/ai";

const MAX_FIX_ATTEMPTS = 5; // failed compiles before the agent gives up
const MAX_TEST_ATTEMPTS = 4; // failed test runs before the agent stops retrying
const MAX_REVIEW_ATTEMPTS = 3; // blocked security reviews before it stops
// Hard backstop on model turns per run. The pipeline is compile -> test ->
// review -> deploy -> label -> done (6 turns clean), and the retry budgets
// allow 5 + 4 + 3 = 12 more, so 16 could be exhausted mid-pipeline on a rough
// run and stop with nothing said. 24 covers the worst case with headroom.
const MAX_TURNS = 24;
const STORAGE_KEY = "devstation-agent-run-v1";

export interface ConstructorInput {
  name: string;
  type: string;
}

export interface ToolStep {
  kind: "compile" | "test" | "review" | "deploy" | "record" | "verify" | "label" | "topup";
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
  // For source verification after deploy (standard-input path).
  standardJsonInput: string;
  qualifiedName: string;
  compilerVersion: string;
}

interface Persisted {
  timeline: TimelineItem[];
  convo: ChatMessage[];
  artifact: Artifact | null;
  /** Bytecode that passed the security review. Persisted so a reload cannot
   *  silently clear the gate while leaving a pending deploy form on screen. */
  reviewedBytecode?: string | null;
  /** Source of the last successful compile, so @@REVIEW still works after a
   *  reload rather than reporting "nothing to review". */
  lastSource?: string | null;
  /** Contract deployed in this run, so @@LABEL still has a target. */
  deployedAddress?: string | null;
}

function load(): Persisted {
  if (typeof localStorage === "undefined") return { timeline: [], convo: [], artifact: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { timeline: [], convo: [], artifact: null };
    const p = JSON.parse(raw) as Persisted;
    return {
      timeline: p.timeline ?? [],
      convo: p.convo ?? [],
      artifact: p.artifact ?? null,
      reviewedBytecode: p.reviewedBytecode ?? null,
      lastSource: p.lastSource ?? null,
      deployedAddress: p.deployedAddress ?? null,
    };
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
  const testFailsRef = useRef(0);
  // Source of the most recent SUCCESSFUL compile — what the security review
  // analyses, so review and bytecode always describe the same contract.
  const lastSourceRef = useRef<string | null>(null);
  const reviewFailsRef = useRef(0);
  // Bytecode of the artifact that PASSED the security review. Compared against
  // the current artifact before any deploy, so recompiling always invalidates
  // the pass — the gate cannot be satisfied by reviewing one contract and then
  // deploying a different one.
  const reviewedBytecodeRef = useRef<string | null>(null);
  // Address of the contract deployed in this run, so @@LABEL knows its target.
  const deployedAddressRef = useRef<`0x${string}` | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [running, setRunning] = useState(false);

  const { address, isConnected } = useAccount();
  const { deployContractAsync } = useDeployContract();
  const publicClient = usePublicClient();
  const { chainId, chain, walletMismatch, syncWallet } = useActiveChain();
  const { recordDeployment } = useProjectRegistry();
  const { submitLabel } = useContractLabels();
  const { available: sponsorAvailable, ensureFunded } = useSponsorTopup(chainId);
  const sponsorEligible = sponsorAvailable && isSponsorEligibleChain(chainId);

  // Hydrate the saved run once on mount.
  useEffect(() => {
    const p = load();
    timelineRef.current = p.timeline;
    convoRef.current = p.convo;
    artifactRef.current = p.artifact;
    // Restoring these is what makes a reload safe: the review gate keeps its
    // decision, @@REVIEW can still see the source, and @@LABEL keeps its target.
    reviewedBytecodeRef.current = p.reviewedBytecode ?? null;
    lastSourceRef.current = p.lastSource ?? null;
    deployedAddressRef.current = (p.deployedAddress as `0x${string}` | null) ?? null;
    force();
  }, []);

  const persist = () =>
    save({
      timeline: timelineRef.current,
      convo: convoRef.current,
      artifact: artifactRef.current,
      reviewedBytecode: reviewedBytecodeRef.current,
      lastSource: lastSourceRef.current,
      deployedAddress: deployedAddressRef.current,
    });
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
    testFailsRef.current = 0;
    lastSourceRef.current = null;
    reviewFailsRef.current = 0;
    reviewedBytecodeRef.current = null;
    deployedAddressRef.current = null;
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
      // The security gate lives HERE, not at the call sites, because doDeploy
      // has two of them: the model loop and submitDeployForm (the constructor
      // form the user submits after a pause). Guarding only the loop left the
      // form path open — and since the review state was not persisted, a page
      // reload with a pending form would deploy a contract that had never
      // passed a review. Checking at the single point of action closes both.
      if (!canDeploy(reviewedBytecodeRef.current, artifact.bytecode)) {
        throw new Error(
          "This contract has not passed a security review since it was last compiled. " +
            "Run the review again before deploying.",
        );
      }
      if (!isConnected || !address)
        throw new Error("No wallet connected. Connect a wallet to deploy.");
      if (!publicClient) throw new Error("No RPC client for the selected network.");
      if (walletMismatch) {
        await syncWallet().catch(() => {
          throw new Error(`Switch your wallet to ${chain.name} to deploy.`);
        });
      }

      // Gas top-up (sponsor-eligible mainnets only, when configured): tops
      // up THIS wallet with just enough native gas token to cover the
      // deploy, same mechanism as the LaunchKit deploy wizard. Auto-applied
      // without asking — unlike the
      // old sponsor-broadcasts-the-deploy design, a top-up changes nothing
      // about who ends up owning the contract, so there's no tradeoff to
      // surface to the user here. Best-effort: a failed top-up doesn't block
      // the deploy attempt, which may still succeed if the wallet already
      // has enough gas.
      if (sponsorEligible) {
        const tIdx = push({
          type: "tool",
          step: { kind: "topup", status: "running", title: "Requesting a gas top-up…" },
        });
        try {
          const result = await ensureFunded({
            abi: artifact.abi,
            bytecode: artifact.bytecode,
            args,
            chainId,
            requesterAddress: address,
          });
          updateStep(tIdx, {
            status: "ok",
            title: result.toppedUp ? "Wallet funded" : "Wallet already had enough gas",
            txHash: result.txHash ?? undefined,
          });
        } catch (e) {
          updateStep(tIdx, {
            status: "error",
            title: "Gas top-up failed",
            detail: e instanceof Error ? e.message : undefined,
          });
        }
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
      deployedAddressRef.current = addr; // target for a follow-up @@LABEL
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
          standardJsonInput: artifact.standardJsonInput,
          qualifiedName: artifact.qualifiedName,
          compilerVersion: artifact.compilerVersion,
          constructorArgsEncoded: encodeConstructorArgs(artifact.abi, args),
        });
        updateStep(rIdx, { status: "ok", title: "Recorded to My Projects" });
      } catch (e) {
        updateStep(rIdx, {
          status: "error",
          title: "Saved locally (onchain record skipped)",
          detail: e instanceof Error ? e.message : undefined,
        });
      }

      // Source-verify on the active chain's explorer via the standard-input
      // path (handles OpenZeppelin imports). Best-effort: never fail the
      // deploy, and don't block the conversation longer than ~1 min on the
      // verifier queue.
      const vIdx = push({
        type: "tool",
        step: { kind: "verify", status: "running", title: "Verifying source on the explorer…" },
      });
      try {
        // Wait for the explorer to index the new address before submitting —
        // otherwise it 404s with "Address is not a smart-contract".
        for (let i = 0; i < 15; i++) {
          const { indexed } = await getIsContractIndexed({ data: { chainId, address: addr } });
          if (indexed) break;
          await new Promise((r) => setTimeout(r, 4000));
        }
        const res = await submitStandardJsonVerification({
          data: {
            chainId,
            address: addr,
            contractName: artifact.qualifiedName,
            standardJsonInput: artifact.standardJsonInput,
            compilerVersion: artifact.compilerVersion,
            constructorArgs: encodeConstructorArgs(artifact.abi, args),
          },
        });
        if (!res.ok) {
          updateStep(vIdx, {
            status: "error",
            title: "Verification submission failed",
            detail: res.message,
          });
        } else {
          let verified = false;
          for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 4000));
            const s = await getVerificationStatus({ data: { chainId, address: addr } });
            if (s.verified) {
              verified = true;
              break;
            }
          }
          updateStep(vIdx, {
            status: "ok",
            title: verified
              ? "Source verified on the explorer"
              : "Verification submitted (pending)",
            detail: verified
              ? undefined
              : "The explorer may finish shortly — check the contract page.",
          });
        }
      } catch (e) {
        updateStep(vIdx, {
          status: "error",
          title: "Verification skipped",
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
      let turn = 0;
      for (; turn < MAX_TURNS; turn++) {
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
            artifactRef.current = {
              name,
              abi: c.abi,
              bytecode: c.bytecode,
              constructorInputs,
              standardJsonInput: out.standardJsonInput,
              qualifiedName: c.qualifiedName,
              compilerVersion: DEFAULT_SOLC_VERSION,
            };
            // A new artifact must be re-reviewed: a pass earned by an earlier
            // version of the source says nothing about this one.
            reviewedBytecodeRef.current = null;
            lastSourceRef.current = action.source;
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

        if (action.kind === "test") {
          const artifact = artifactRef.current;
          if (!artifact) {
            convoRef.current.push({
              role: "user",
              content: testSetupFailMessage("No compiled contract yet — @@COMPILE first.", 0),
            });
            continue;
          }
          const parsedSuite = testSuite.safeParse(action.suite);
          if (!parsedSuite.success) {
            testFailsRef.current++;
            const left = MAX_TEST_ATTEMPTS - testFailsRef.current;
            const why =
              action.suite === null
                ? "No valid ```json test suite found in your message."
                : parsedSuite.error.issues
                    .map((i) => `${i.path.join(".")}: ${i.message}`)
                    .join("; ");
            convoRef.current.push({
              role: "user",
              content: left <= 0 ? testGaveUpMessage() : testSetupFailMessage(why, left),
            });
            continue;
          }

          const sIdx = push({
            type: "tool",
            step: { kind: "test", status: "running", title: "Running tests…" },
          });
          let result;
          try {
            result = await runSuite({
              abi: artifact.abi as Abi,
              bytecode: artifact.bytecode,
              suite: parsedSuite.data,
              // Helper contracts are compiled with the same in-browser solc
              // the real contract uses, but SEPARATELY — they never enter the
              // source that gets deployed and verified onchain.
              compileHelper: async (source) => {
                const out = await compile({
                  sources: { "Helper.sol": source },
                  version: DEFAULT_SOLC_VERSION,
                  mainFile: "Helper.sol",
                });
                const contracts: Record<string, { abi: unknown[]; bytecode: `0x${string}` }> = {};
                for (const [name, c] of Object.entries(out.contracts)) {
                  contracts[name] = { abi: c.abi, bytecode: c.bytecode };
                }
                return {
                  contracts,
                  errors: out.errors.map((e) => e.formattedMessage || e.message),
                };
              },
            });
          } catch (e) {
            const why = e instanceof Error ? e.message : "The test runner failed to start.";
            updateStep(sIdx, { status: "error", title: "Tests could not run", detail: why });
            testFailsRef.current++;
            const left = MAX_TEST_ATTEMPTS - testFailsRef.current;
            convoRef.current.push({
              role: "user",
              content: left <= 0 ? testGaveUpMessage() : testSetupFailMessage(why, left),
            });
            continue;
          }

          if (!result.deployed) {
            testFailsRef.current++;
            const left = MAX_TEST_ATTEMPTS - testFailsRef.current;
            updateStep(sIdx, {
              status: "error",
              title: "Tests could not run",
              detail: result.deployError,
            });
            convoRef.current.push({
              role: "user",
              content:
                left <= 0
                  ? testGaveUpMessage()
                  : testSetupFailMessage(
                      result.deployError ?? "Deploy failed in the test EVM.",
                      left,
                    ),
            });
            continue;
          }

          if (result.ok) {
            const helperNote = Object.keys(result.helpers ?? {}).length
              ? `helpers: ${Object.keys(result.helpers ?? {}).join(", ")} · `
              : "";
            updateStep(sIdx, {
              status: "ok",
              title: `Tests passed (${result.passed}/${result.outcomes.length})`,
              detail: helperNote + result.outcomes.map((o) => `✓ ${o.name}`).join(" · "),
            });
            convoRef.current.push({
              role: "user",
              content: testOkMessage(artifact.name, result.passed),
            });
          } else {
            testFailsRef.current++;
            const left = MAX_TEST_ATTEMPTS - testFailsRef.current;
            const failures = result.outcomes.filter((o) => !o.passed);
            updateStep(sIdx, {
              status: "error",
              title: `Tests failed (${result.failed}/${result.outcomes.length}) · attempt ${testFailsRef.current}/${MAX_TEST_ATTEMPTS}`,
              detail: failures.map((f) => `✗ ${f.name}: ${f.detail ?? ""}`).join(" · "),
            });
            convoRef.current.push({
              role: "user",
              content: left <= 0 ? testGaveUpMessage() : testFailMessage(failures, left),
            });
          }
          continue;
        }

        if (action.kind === "review") {
          const artifact = artifactRef.current;
          if (!artifact || !lastSourceRef.current) {
            convoRef.current.push({
              role: "user",
              content: "[TOOL RESULT] No compiled contract to review — @@COMPILE first.",
            });
            continue;
          }
          const sIdx = push({
            type: "tool",
            step: { kind: "review", status: "running", title: "Security review…" },
          });
          const review = reviewFindings(runStaticAnalysis(lastSourceRef.current, "Contract.sol"));

          if (review.passed) {
            reviewedBytecodeRef.current = artifact.bytecode;
            updateStep(sIdx, {
              status: "ok",
              title: "Security review passed",
              detail: summarise(review),
            });
            convoRef.current.push({
              role: "user",
              content: reviewOkMessage(artifact.name, summarise(review)),
            });
          } else {
            reviewedBytecodeRef.current = null;
            reviewFailsRef.current++;
            const left = MAX_REVIEW_ATTEMPTS - reviewFailsRef.current;
            updateStep(sIdx, {
              status: "error",
              title: `Security review blocked the deploy (${review.blocking.length})`,
              detail: review.blocking.map((b) => `${b.risk.toUpperCase()}: ${b.title}`).join(" · "),
            });
            convoRef.current.push({
              role: "user",
              content:
                left <= 0 ? reviewGaveUpMessage() : reviewBlockedMessage(review.blocking, left),
            });
          }
          continue;
        }

        if (action.kind === "label") {
          const addr = deployedAddressRef.current;
          if (!addr) {
            convoRef.current.push({
              role: "user",
              content: labelErrorMessage("Nothing deployed in this run yet."),
            });
            continue;
          }
          const labelName = action.name || artifactRef.current?.name || "Contract";
          const sIdx = push({
            type: "tool",
            step: { kind: "label", status: "running", title: "Registering name onchain…" },
          });
          try {
            await submitLabel({
              contractAddress: addr,
              name: labelName,
              category: normalizeLabelCategory(action.category),
              description: `Deployed with the DevStation AI agent.`,
              autoLabeled: true,
            });
            updateStep(sIdx, {
              status: "ok",
              title: `Registered "${labelName}"`,
              address: addr,
            });
            convoRef.current.push({ role: "user", content: labelOkMessage(labelName, addr) });
          } catch (e) {
            const why = e instanceof Error ? e.message : "Label registration failed";
            updateStep(sIdx, { status: "error", title: "Name not registered", detail: why });
            convoRef.current.push({ role: "user", content: labelErrorMessage(why) });
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
          // The security gate is enforced HERE, not in the prompt. A model can
          // skip or misreport a @@REVIEW; it cannot skip this. The pass is tied
          // to the exact bytecode reviewed, so editing and recompiling the
          // contract always requires a fresh review before it can deploy.
          if (!canDeploy(reviewedBytecodeRef.current, artifact.bytecode)) {
            convoRef.current.push({
              role: "user",
              content:
                "[TOOL RESULT] DEPLOY REFUSED: this contract has not passed a security review since it was last compiled. Run @@REVIEW name=" +
                artifact.name +
                " first, and fix any Critical/High findings before deploying.",
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

      // Fell out of the loop by exhausting the turn budget rather than by
      // finishing. Say so — silently stopping mid-build looks like a hang.
      if (turn >= MAX_TURNS - 1) {
        push({
          type: "assistant",
          text: `⚠ Stopped after ${MAX_TURNS} steps without finishing. The run is saved — send a follow-up message to continue from here, or Reset to start over.`,
        });
        commitSave();
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
    // Every retry budget resets per run. Resetting only the compile counter
    // meant a run that burned its test/review attempts left the NEXT run
    // starting from a negative budget — it would give up on its first test
    // failure with no explanation.
    compileFailsRef.current = 0;
    testFailsRef.current = 0;
    reviewFailsRef.current = 0;
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
