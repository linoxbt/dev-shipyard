// The autonomous build loop for "Code with AI": stream the model, parse its
// directive, run the requested tool (compile in-browser, deploy via the
// connected wallet), feed the result back, and repeat — up to a fix/turn cap.
// All tool execution is client-side (the solc worker and the wallet both live
// in the browser), so the loop runs here, not on the server.

import { useReducer, useRef, useState } from "react";
import { useAccount, useDeployContract, usePublicClient } from "wagmi";
import { compile, DEFAULT_SOLC_VERSION, type CompileOutput } from "@/lib/compiler";
import { chatStream } from "@/lib/ai";
import { useActiveChain } from "@/hooks/useActiveChain";
import {
  SOLIDITY_AGENT_PROMPT,
  parseAction,
  compileOkMessage,
  compileErrorMessage,
  compileGaveUpMessage,
  deployOkMessage,
  deployErrorMessage,
} from "@/lib/ai-agent";
import type { ChatMessage } from "@/lib/ai";

const MAX_FIX_ATTEMPTS = 5; // failed compiles before the agent gives up
const MAX_TURNS = 16; // hard backstop on total model turns per run

export interface ToolStep {
  kind: "compile" | "deploy";
  status: "running" | "ok" | "error";
  title: string;
  detail?: string;
  address?: `0x${string}`;
  txHash?: `0x${string}`;
}

export type TimelineItem =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; step: ToolStep };

interface Artifact {
  name: string;
  abi: unknown[];
  bytecode: `0x${string}`;
  constructorInputs: { name: string; type: string }[];
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

function constructorInputsOf(abi: unknown[]): { name: string; type: string }[] {
  const ctor = abi.find(
    (i) => typeof i === "object" && i !== null && (i as { type?: string }).type === "constructor",
  ) as { inputs?: { name: string; type: string }[] } | undefined;
  return ctor?.inputs ?? [];
}

// Coerce JSON args (strings/numbers from the model) into the types viem needs,
// using the constructor ABI. "$WALLET" resolves to the connected address.
function coerceArgs(
  inputs: { name: string; type: string }[],
  raw: unknown[],
  wallet?: string,
): unknown[] {
  return inputs.map((inp, i) => {
    let v = raw[i];
    if (v === "$WALLET" && wallet) v = wallet;
    if (inp.type.endsWith("[]")) return Array.isArray(v) ? v : [];
    if (inp.type.startsWith("uint") || inp.type.startsWith("int"))
      return BigInt((v ?? 0) as string);
    if (inp.type === "bool") return v === true || v === "true";
    return v;
  });
}

export function useCodeAgent() {
  const timelineRef = useRef<TimelineItem[]>([]);
  const convoRef = useRef<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const [, force] = useReducer((x: number) => x + 1, 0);
  const [running, setRunning] = useState(false);

  const { address, isConnected } = useAccount();
  const { deployContractAsync } = useDeployContract();
  const publicClient = usePublicClient();
  const { chainId, chain, config, walletMismatch, syncWallet } = useActiveChain();

  const commit = () => force();
  const push = (item: TimelineItem): number => {
    timelineRef.current.push(item);
    commit();
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
      commit();
    }
  };

  const stop = () => abortRef.current?.abort();

  const reset = () => {
    abortRef.current?.abort();
    timelineRef.current = [];
    convoRef.current = [];
    commit();
  };

  const run = async (prompt: string) => {
    if (running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);

    push({ type: "user", text: prompt });
    convoRef.current.push({ role: "user", content: prompt });

    let lastArtifact: Artifact | null = null;
    let compileFails = 0;

    try {
      for (let turn = 0; turn < MAX_TURNS; turn++) {
        // 1) Stream the model's next message.
        const aIdx = push({ type: "assistant", text: "" });
        const full = await chatStream({
          system: SOLIDITY_AGENT_PROMPT,
          messages: convoRef.current,
          signal: controller.signal,
          onDelta: (c) => updateAssistant(aIdx, c),
        });
        convoRef.current.push({ role: "assistant", content: full });

        const action = parseAction(full);

        // 2) Execute the directive (if any).
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
            lastArtifact = { name, abi: c.abi, bytecode: c.bytecode, constructorInputs };
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
            compileFails++;
            const left = MAX_FIX_ATTEMPTS - compileFails;
            updateStep(sIdx, {
              status: "error",
              title: `Compile failed (attempt ${compileFails}/${MAX_FIX_ATTEMPTS})`,
              detail: out.errors[0]?.formattedMessage || out.errors[0]?.message,
            });
            if (compileFails >= MAX_FIX_ATTEMPTS) {
              convoRef.current.push({ role: "user", content: compileGaveUpMessage(out.errors) });
            } else {
              convoRef.current.push({
                role: "user",
                content: compileErrorMessage(out.errors, left),
              });
            }
          }
          continue;
        }

        if (action.kind === "deploy") {
          const sIdx = push({
            type: "tool",
            step: { kind: "deploy", status: "running", title: `Deploying to ${chain.name}…` },
          });
          try {
            if (!lastArtifact) throw new Error("No compiled contract yet — compile first.");
            if (!isConnected || !address)
              throw new Error("No wallet connected. Connect a wallet to deploy.");
            if (!publicClient) throw new Error("No RPC client for the selected network.");
            if (walletMismatch) {
              // Try to line the wallet up with the selected network first.
              await syncWallet().catch(() => {
                throw new Error(`Switch your wallet to ${chain.name} to deploy.`);
              });
            }
            const args = coerceArgs(lastArtifact.constructorInputs, action.args, address);
            const hash = await deployContractAsync({
              abi: lastArtifact.abi as [],
              bytecode: lastArtifact.bytecode,
              args: args.length > 0 ? args : undefined,
              chainId,
            });
            updateStep(sIdx, { title: `Deploying ${lastArtifact.name}… confirming`, txHash: hash });
            const receipt = await publicClient.waitForTransactionReceipt({ hash });
            const addr = receipt.contractAddress as `0x${string}` | null;
            if (!addr) throw new Error("Deploy mined but no contract address in the receipt.");
            updateStep(sIdx, {
              status: "ok",
              title: `Deployed ${lastArtifact.name}`,
              detail: `block ${receipt.blockNumber}`,
              address: addr,
              txHash: hash,
            });
            convoRef.current.push({
              role: "user",
              content: deployOkMessage(
                lastArtifact.name,
                addr,
                hash,
                Number(receipt.blockNumber),
                chain.name,
              ),
            });
          } catch (e) {
            const msg = e instanceof Error ? e.message : "Deploy failed";
            updateStep(sIdx, { status: "error", title: "Deploy failed", detail: msg });
            convoRef.current.push({ role: "user", content: deployErrorMessage(msg) });
          }
          continue;
        }

        // done or no directive → stop the loop.
        break;
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

  return {
    timeline: timelineRef.current,
    running,
    run,
    stop,
    reset,
    isConnected,
    targetChain: chain,
    explorerUrl: config.explorerUrl,
  };
}
