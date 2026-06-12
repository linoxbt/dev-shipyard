import { useState } from "react";
import {
  Eye,
  Pencil,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  Radio,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { parseEther } from "viem";
import { slugForChainId } from "@/lib/explorer/network";
import { parseArgs } from "@/lib/abiArgParser";
import { AbiInput, type AbiParam } from "@/components/editor/AbiInput";
import { cn } from "@/lib/utils";

interface AbiFunction {
  name: string;
  type: "function";
  stateMutability: "view" | "pure" | "nonpayable" | "payable";
  inputs: AbiParam[];
  outputs: Array<{ name: string; type: string }>;
}

interface AbiEvent {
  name: string;
  type: "event";
  inputs: Array<{ name: string; type: string; indexed?: boolean }>;
}

interface Props {
  contractAddress: `0x${string}`;
  abi: unknown[];
  chainId: number;
  /** Limit which sections render. "all" (default) shows read, write, and events. */
  only?: "read" | "write" | "all";
}

function isFn(item: unknown): item is AbiFunction {
  return (
    typeof item === "object" && item !== null && (item as { type?: string }).type === "function"
  );
}

export function ContractInteractor({ contractAddress, abi, chainId, only = "all" }: Props) {
  const fns = abi.filter(isFn);
  const readFunctions = fns.filter(
    (f) => f.stateMutability === "view" || f.stateMutability === "pure",
  );
  const writeFunctions = fns.filter(
    (f) => f.stateMutability === "nonpayable" || f.stateMutability === "payable",
  );
  const events = abi.filter(
    (item): item is AbiEvent =>
      typeof item === "object" && item !== null && (item as { type?: string }).type === "event",
  );

  const showRead = only === "all" || only === "read";
  const showWrite = only === "all" || only === "write";
  const showEvents = only === "all";

  return (
    <div className="space-y-3">
      {showRead && (
        <Section
          title="Read Contract"
          icon={<Eye className="h-3.5 w-3.5 text-info" />}
          accent="border-info/30 bg-info/5"
          count={readFunctions.length}
          defaultOpen
        >
          {readFunctions.length === 0 ? (
            <Empty>No read functions.</Empty>
          ) : (
            readFunctions.map((fn, i) => (
              <ReadFunctionRow
                key={`${fn.name}-${i}`}
                fn={fn}
                contractAddress={contractAddress}
                abi={abi}
                chainId={chainId}
              />
            ))
          )}
        </Section>
      )}

      {showWrite && (
        <Section
          title="Write Contract"
          icon={<Pencil className="h-3.5 w-3.5 text-warning" />}
          accent="border-warning/30 bg-warning/5"
          count={writeFunctions.length}
          defaultOpen={only === "write"}
        >
          {writeFunctions.length === 0 ? (
            <Empty>No write functions.</Empty>
          ) : (
            writeFunctions.map((fn, i) => (
              <WriteFunctionRow
                key={`${fn.name}-${i}`}
                fn={fn}
                contractAddress={contractAddress}
                abi={abi}
                chainId={chainId}
              />
            ))
          )}
        </Section>
      )}

      {showEvents && (
        <Section
          title="Contract Events"
          icon={<Radio className="h-3.5 w-3.5 text-primary" />}
          accent="border-border bg-background/40"
          count={events.length}
        >
          {events.length === 0 ? (
            <Empty>No events.</Empty>
          ) : (
            events.map((ev, i) => (
              <div
                key={`${ev.name}-${i}`}
                className="rounded border border-border bg-background p-2"
              >
                <div className="font-mono text-[11px] font-semibold text-foreground">{ev.name}</div>
                <div className="mt-0.5 font-mono text-[10px] text-meta">
                  (
                  {ev.inputs
                    .map((p) => `${p.type}${p.indexed ? " indexed" : ""} ${p.name}`)
                    .join(", ")}
                  )
                </div>
              </div>
            ))
          )}
          {events.length > 0 && (
            <div className="space-y-1.5 pt-1">
              <p className="font-mono text-[9px] text-meta">
                Use Routebook to inspect events emitted in past transactions for this contract.
              </p>
              <Link
                to="/routebook"
                className="inline-flex items-center gap-1 font-mono text-[10px] text-primary hover:underline"
              >
                View in Routebook <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

/* ── Collapsible section ── */
function Section({
  title,
  icon,
  accent,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  accent: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={cn("rounded border", accent)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-2"
      >
        {open ? (
          <ChevronDown className="h-3 w-3 text-meta" />
        ) : (
          <ChevronRight className="h-3 w-3 text-meta" />
        )}
        {icon}
        <span className="font-mono text-[11px] font-semibold text-foreground">{title}</span>
        <span className="ml-auto font-mono text-[9px] text-meta">{count}</span>
      </button>
      {open && <div className="space-y-2 px-2.5 pb-2.5">{children}</div>}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="font-mono text-[10px] text-meta">{children}</p>;
}

/* ── Read function ── */
function ReadFunctionRow({
  fn,
  contractAddress,
  abi,
  chainId,
}: {
  fn: AbiFunction;
  contractAddress: `0x${string}`;
  abi: unknown[];
  chainId: number;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [argError, setArgError] = useState<string | null>(null);

  let parsedArgs: unknown[] = [];
  try {
    parsedArgs = parseArgs(fn.inputs, values);
  } catch {
    /* surfaced on query */
  }

  const { data, error, isFetching, refetch } = useReadContract({
    address: contractAddress,
    abi: abi as [],
    functionName: fn.name,
    args: parsedArgs,
    chainId,
    query: { enabled: false },
  });

  const query = async () => {
    try {
      parseArgs(fn.inputs, values); // validate (throws on bad BigInt etc.)
      setArgError(null);
      await refetch();
    } catch (e) {
      setArgError(e instanceof Error ? e.message : "Invalid arguments");
    }
  };

  return (
    <div className="rounded border border-border bg-background p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-code">{fn.name}</span>
        <span className="rounded bg-info/15 px-1.5 py-0.5 font-mono text-[8px] uppercase text-info">
          view
        </span>
      </div>
      {fn.inputs.map((p, i) => (
        <ParamField
          key={`${p.name}-${i}`}
          param={p}
          index={i}
          value={values[p.name || `arg${i}`] ?? ""}
          onChange={(v) => setValues((s) => ({ ...s, [p.name || `arg${i}`]: v }))}
        />
      ))}
      <button
        onClick={query}
        disabled={isFetching}
        className="mt-1 flex items-center gap-1 rounded border border-info/50 px-2.5 py-1 font-mono text-[10px] text-info hover:bg-info/10 disabled:opacity-50"
      >
        {isFetching ? <Loader2 className="h-3 w-3 animate-spin" /> : null} Query
      </button>
      {(argError || error) && (
        <p className="mt-1 break-all font-mono text-[10px] text-danger">
          {argError ?? (error instanceof Error ? error.message : "Call failed")}
        </p>
      )}
      {data !== undefined && !argError && !error && (
        <div className="mt-1.5">
          <ResultView data={data} outputs={fn.outputs} chainId={chainId} />
        </div>
      )}
    </div>
  );
}

/* ── Write function ── */
function WriteFunctionRow({
  fn,
  contractAddress,
  abi,
  chainId,
}: {
  fn: AbiFunction;
  contractAddress: `0x${string}`;
  abi: unknown[];
  chainId: number;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [ethValue, setEthValue] = useState("");
  const [txHash, setTxHash] = useState<`0x${string}`>();
  const [err, setErr] = useState<string | null>(null);
  const payable = fn.stateMutability === "payable";

  const { writeContractAsync, isPending } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const send = async () => {
    setErr(null);
    try {
      const args = parseArgs(fn.inputs, values);
      const hash = await writeContractAsync({
        address: contractAddress,
        abi: abi as [],
        functionName: fn.name,
        args,
        chainId,
        value: payable && ethValue ? parseEther(ethValue) : undefined,
      });
      setTxHash(hash);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Transaction failed");
    }
  };

  return (
    <div className="rounded border border-border bg-background p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="font-mono text-[11px] font-bold text-warning">{fn.name}</span>
        <span className="rounded bg-warning/15 px-1.5 py-0.5 font-mono text-[8px] uppercase text-warning">
          write
        </span>
        {payable && (
          <span className="rounded bg-warning/25 px-1.5 py-0.5 font-mono text-[8px] uppercase text-warning">
            payable
          </span>
        )}
      </div>
      {fn.inputs.map((p, i) => (
        <ParamField
          key={`${p.name}-${i}`}
          param={p}
          index={i}
          value={values[p.name || `arg${i}`] ?? ""}
          onChange={(v) => setValues((s) => ({ ...s, [p.name || `arg${i}`]: v }))}
        />
      ))}
      {payable && (
        <div className="mb-1">
          <div className="font-mono text-[9px] text-meta">QIE to send with this call</div>
          <input
            value={ethValue}
            onChange={(e) => setEthValue(e.target.value)}
            inputMode="decimal"
            placeholder="0.0"
            className="w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-meta focus:border-warning focus:outline-none"
          />
        </div>
      )}
      <button
        onClick={send}
        disabled={isPending || isConfirming}
        className="mt-1 flex w-full items-center justify-center gap-1 rounded bg-warning px-2.5 py-1 font-mono text-[10px] font-bold text-black hover:opacity-90 disabled:opacity-50"
      >
        {(isPending || isConfirming) && <Loader2 className="h-3 w-3 animate-spin" />}
        Send Transaction
      </button>

      {/* Status */}
      <div className="mt-1 font-mono text-[10px]">
        {isPending && <span className="text-meta">Waiting for wallet signature…</span>}
        {txHash && isConfirming && (
          <span className="flex items-center gap-1 break-all text-meta">
            <Loader2 className="h-3 w-3 animate-spin" /> Submitted: {short(txHash)}
            <Link
              to="/explorer/$network/tx/$hash"
              params={{ network: slugForChainId(chainId), hash: txHash }}
              className="text-primary hover:underline"
            >
              view
            </Link>
          </span>
        )}
        {isSuccess && (
          <div className="text-success">
            ✓ Confirmed in block {receipt ? Number(receipt.blockNumber) : ""}
            <p className="mt-0.5 text-meta">
              State may have changed. Re-query read functions to see updated values.
            </p>
          </div>
        )}
        {err && <span className="break-all text-danger">✗ {err}</span>}
      </div>
    </div>
  );
}

/* ── Param label + input ── */
function ParamField({
  param,
  index,
  value,
  onChange,
}: {
  param: AbiParam;
  index: number;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="mb-1.5">
      <div className="flex items-baseline justify-between font-mono text-[9px]">
        <span className="text-foreground">{param.name || `arg${index}`}</span>
        <span className="text-meta">{param.type}</span>
      </div>
      <AbiInput param={param} value={value} onChange={onChange} />
    </div>
  );
}

/* ── Result formatting ── */
function ResultView({
  data,
  outputs,
  chainId,
}: {
  data: unknown;
  outputs: Array<{ name: string; type: string }>;
  chainId: number;
}) {
  // Multiple return values come back as an array.
  if (outputs.length > 1 && Array.isArray(data)) {
    return (
      <div className="space-y-1 rounded border border-border bg-surface p-2">
        {outputs.map((o, i) => (
          <div key={i} className="flex flex-col">
            <span className="font-mono text-[9px] text-meta">
              {o.name || `output ${i}`} ({o.type})
            </span>
            <FormattedValue value={(data as unknown[])[i]} type={o.type} chainId={chainId} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="rounded border border-border bg-surface p-2">
      <FormattedValue value={data} type={outputs[0]?.type ?? ""} chainId={chainId} />
    </div>
  );
}

function FormattedValue({
  value,
  type,
  chainId,
}: {
  value: unknown;
  type: string;
  chainId: number;
}) {
  if (typeof value === "boolean") {
    return (
      <span className={cn("font-mono text-[11px]", value ? "text-success" : "text-danger")}>
        {value ? "true" : "false"}
      </span>
    );
  }

  if (type === "address" && typeof value === "string") {
    return (
      <span className="flex items-center gap-1.5 break-all font-mono text-[11px] text-code">
        {value}
        <CopyBtn text={value} />
        <Link
          to="/explorer/$network/address/$hash"
          params={{ network: slugForChainId(chainId), hash: value }}
          className="text-primary hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
        </Link>
      </span>
    );
  }

  if (typeof value === "bigint" || (typeof value === "number" && Number.isFinite(value))) {
    const bi = typeof value === "bigint" ? value : BigInt(Math.trunc(value));
    const big = bi > 10n ** 15n;
    return (
      <div className="font-mono text-[11px] text-foreground">
        {bi.toString()}
        {big && <div className="text-[9px] text-meta">≈ {formatUnitsApprox(bi)} (18 decimals)</div>}
      </div>
    );
  }

  if (typeof value === "string") {
    const isHex = value.startsWith("0x");
    if (isHex && (type.startsWith("bytes") || type === "")) {
      return (
        <span className="flex items-center gap-1.5 break-all font-mono text-[11px] text-code">
          {value} <CopyBtn text={value} />
        </span>
      );
    }
    return <span className="font-mono text-[11px] text-foreground">&quot;{value}&quot;</span>;
  }

  // tuple / array / object
  return (
    <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[10px] text-foreground">
      {safeStringify(value)}
    </pre>
  );
}

function formatUnitsApprox(wei: bigint): string {
  const whole = wei / 10n ** 18n;
  const frac = (wei % 10n ** 18n).toString().padStart(18, "0").slice(0, 4);
  return `${whole.toString()}.${frac}`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2);
  } catch {
    return String(value);
  }
}

function short(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
      className="text-meta hover:text-foreground"
    >
      {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
