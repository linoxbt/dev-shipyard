// Build hex-encoded Clarity values from typed user input (for read-only calls)
// and decode hex results back to a readable Clarity string. Uses @stacks/
// transactions' Cl builder. Scalar types are supported; for complex types
// (tuple/list/optional) the user can paste a raw hex-encoded Clarity value.

import { Cl } from "@stacks/transactions";

export function argToHex(typeStr: string, value: string): string {
  const v = value.trim();
  // Raw hex passthrough (advanced / complex types).
  if (v.startsWith("0x") && v.length > 2) return v;

  const t = String(typeStr).toLowerCase();
  let cv;
  if (t.includes("uint")) cv = Cl.uint(BigInt(v || "0"));
  else if (t.includes("int")) cv = Cl.int(BigInt(v || "0"));
  else if (t.includes("bool")) cv = Cl.bool(v === "true" || v === "1");
  else if (t.includes("string-ascii")) cv = Cl.stringAscii(v);
  else if (t.includes("string-utf8")) cv = Cl.stringUtf8(v);
  else if (t.includes("buff")) cv = Cl.bufferFromHex(v.replace(/^0x/, ""));
  else if (t.includes("principal") || t.includes("trait")) {
    cv = v.includes(".") ? Cl.contractPrincipal(v.split(".")[0], v.split(".").slice(1).join(".")) : Cl.standardPrincipal(v);
  } else {
    throw new Error(`Unsupported arg type "${typeStr}". Paste a hex-encoded Clarity value (0x…).`);
  }
  return "0x" + Cl.serialize(cv);
}

export function decodeClarityHex(hex: string): string {
  try {
    return Cl.prettyPrint(Cl.deserialize(hex));
  } catch {
    return hex;
  }
}
