import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AbiParam {
  name: string;
  type: string;
  components?: readonly AbiParam[];
}

interface Props {
  param: AbiParam;
  value: string;
  onChange: (value: string) => void;
}

const inputCls =
  "w-full rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-foreground placeholder:text-meta focus:border-primary focus:outline-none";

// Renders the appropriate input control for a single Solidity ABI parameter.
export function AbiInput({ param, value, onChange }: Props) {
  const { type } = param;

  // ── bool: toggle ──
  if (type === "bool") {
    const on = value === "true";
    return (
      <button
        type="button"
        onClick={() => onChange(on ? "false" : "true")}
        className={cn(
          "inline-flex h-5 w-9 items-center rounded-full border border-border transition",
          on ? "bg-primary" : "bg-background",
        )}
      >
        <span
          className={cn(
            "inline-block h-3.5 w-3.5 transform rounded-full bg-foreground transition",
            on ? "translate-x-5" : "translate-x-0.5",
          )}
        />
      </button>
    );
  }

  // ── address ──
  if (type === "address") {
    const invalid = value.length > 0 && !/^0x[a-fA-F0-9]{40}$/.test(value.trim());
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0x..."
        className={cn(inputCls, invalid && "border-danger focus:border-danger")}
      />
    );
  }

  // ── uint / int: number with a wei helper + ×1e18 convenience ──
  if (type.startsWith("uint") || type.startsWith("int")) {
    return (
      <div>
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="numeric"
          placeholder="0"
          className={inputCls}
        />
        <div className="mt-0.5 flex items-center justify-between">
          <span className="font-mono text-[9px] text-meta">In wei (no decimals)</span>
          <button
            type="button"
            onClick={() => {
              const n = value.trim();
              if (/^\d+$/.test(n)) onChange((BigInt(n) * 10n ** 18n).toString());
            }}
            className="font-mono text-[9px] text-primary hover:underline"
            title="Multiply the current value by 1e18 (parse as ether)"
          >
            ×1e18
          </button>
        </div>
      </div>
    );
  }

  // ── bytes32 ──
  if (type === "bytes32") {
    return (
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="0x… (32 bytes) or a short string"
        className={inputCls}
      />
    );
  }

  // ── bytes / bytesN ──
  if (type === "bytes" || /^bytes\d+$/.test(type)) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        placeholder="0x..."
        className={cn(inputCls, "resize-none")}
      />
    );
  }

  // ── simple arrays of address / number: dynamic list ──
  const isAddressArray = type === "address[]";
  const isNumberArray = /^(u?int\d*)\[\]$/.test(type);
  if (isAddressArray || isNumberArray) {
    return (
      <DynamicList value={value} onChange={onChange} kind={isAddressArray ? "address" : "number"} />
    );
  }

  // ── tuple / other arrays: JSON entry ──
  if (type === "tuple" || type.endsWith("[]")) {
    return (
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={type === "tuple" ? '{ "field": value }' : '["item1", "item2"]'}
        className={cn(inputCls, "resize-none")}
      />
    );
  }

  // ── string and everything else ──
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Enter string..."
      className={inputCls}
    />
  );
}

// Dynamic add/remove list, serialized to a JSON-array string in `value`.
function DynamicList({
  value,
  onChange,
  kind,
}: {
  value: string;
  onChange: (v: string) => void;
  kind: "address" | "number";
}) {
  let items: string[] = [];
  try {
    const parsed = JSON.parse(value || "[]");
    if (Array.isArray(parsed)) items = parsed.map((x) => String(x));
  } catch {
    items = [];
  }
  const write = (next: string[]) => onChange(JSON.stringify(next));

  return (
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            value={item}
            onChange={(e) => {
              const next = items.slice();
              next[i] = e.target.value;
              write(next);
            }}
            inputMode={kind === "number" ? "numeric" : undefined}
            placeholder={kind === "address" ? "0x..." : "0"}
            className={inputCls}
          />
          <button
            type="button"
            onClick={() => write(items.filter((_, j) => j !== i))}
            className="shrink-0 rounded border border-border p-1 text-meta hover:text-danger"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => write([...items, ""])}
        className="flex items-center gap-1 font-mono text-[9px] text-primary hover:underline"
      >
        <Plus className="h-3 w-3" /> Add {kind === "address" ? "address" : "value"}
      </button>
    </div>
  );
}
