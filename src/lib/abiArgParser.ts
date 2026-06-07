// Convert string inputs from the contract-interaction UI into the JS types
// viem/wagmi expect for each Solidity ABI type.

export function parseArg(value: string, type: string): unknown {
  const v = value.trim();

  if (type === "address") return v as `0x${string}`;

  if (type.startsWith("uint") || type.startsWith("int")) {
    return BigInt(v || "0");
  }

  if (type === "bool") return v === "true";

  if (type === "bytes32") {
    if (v.startsWith("0x")) return v as `0x${string}`;
    // Encode a short string as right-padded bytes32.
    const bytes = new TextEncoder().encode(v);
    const padded = new Uint8Array(32);
    padded.set(bytes.slice(0, 32));
    return ("0x" +
      Array.from(padded)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")) as `0x${string}`;
  }

  if (type === "bytes" || /^bytes\d+$/.test(type)) return v as `0x${string}`;

  if (type.endsWith("[]")) {
    const inner = type.slice(0, -2);
    try {
      const arr = JSON.parse(v) as unknown[];
      if (!Array.isArray(arr)) return [];
      // Recursively coerce each element to the inner type.
      return arr.map((el) => parseArg(typeof el === "string" ? el : JSON.stringify(el), inner));
    } catch {
      // Fall back to comma-separated parsing for convenience.
      if (!v) return [];
      return v.split(",").map((el) => parseArg(el, inner));
    }
  }

  return v; // string and anything else
}

export function parseArgs(
  inputs: Array<{ name: string; type: string }>,
  values: Record<string, string>,
): unknown[] {
  return inputs.map((input, i) => parseArg(values[input.name || `arg${i}`] ?? "", input.type));
}
