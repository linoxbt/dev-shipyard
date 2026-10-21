// Convert string inputs from the contract-interaction UI into the JS types
// viem/wagmi expect for each Solidity ABI type.
//
// Strict on purpose: every value that cannot be what the type says is an error
// naming the field, never a quiet substitute. An empty uint used to become 0,
// "TRUE" became false and an over-long bytes32 string was cut to fit, and each
// of those deploys a contract with a value nobody typed.

export interface AbiParamLike {
  name?: string;
  type: string;
  components?: ReadonlyArray<AbiParamLike>;
}

export class AbiArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AbiArgError";
  }
}

const label = (name: string | undefined, type: string) => (name ? `${name} (${type})` : type);

/** `T[]` or `T[n]`: the element type and, for a fixed array, its length. */
function arrayShape(type: string): { inner: string; length: number | null } | null {
  const m = /^(.*)\[(\d*)\]$/.exec(type);
  if (!m) return null;
  return { inner: m[1], length: m[2] === "" ? null : Number(m[2]) };
}

function toElementString(el: unknown): string {
  return typeof el === "string" ? el : JSON.stringify(el);
}

export function parseArg(
  value: string,
  type: string,
  components?: ReadonlyArray<AbiParamLike>,
  name?: string,
): unknown {
  const v = value.trim();
  const what = label(name, type);

  // MUST come before the uint/int prefix check below: "uint256[]" and
  // "int128[]" both start with "uint"/"int" too, so checking array-ness
  // first is the only way a numeric array doesn't get routed into
  // BigInt(v), which throws on anything but a single plain number.
  const shape = arrayShape(type);
  if (shape) {
    let items: unknown[];
    if (!v) {
      items = [];
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(v);
      } catch {
        parsed = undefined;
      }
      if (Array.isArray(parsed)) {
        items = parsed;
      } else if (shape.inner.startsWith("tuple") || arrayShape(shape.inner)) {
        // Nested arrays and structs have no unambiguous comma form.
        throw new AbiArgError(`${what} must be a JSON array, e.g. [ ... ].`);
      } else {
        // Comma-separated, for convenience with simple element types.
        items = v.split(",");
      }
    }
    if (shape.length !== null && items.length !== shape.length) {
      throw new AbiArgError(`${what} needs exactly ${shape.length} items, got ${items.length}.`);
    }
    return items.map((el, i) =>
      parseArg(toElementString(el), shape.inner, components, `${name ?? "item"}[${i}]`),
    );
  }

  if (type === "tuple") {
    if (!components) throw new AbiArgError(`${what} has no component types in the ABI.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(v);
    } catch {
      throw new AbiArgError(`${what} must be JSON: an array or an object with the struct fields.`);
    }
    if (Array.isArray(parsed)) {
      if (parsed.length !== components.length) {
        throw new AbiArgError(`${what} needs ${components.length} fields, got ${parsed.length}.`);
      }
      return components.map((c, i) =>
        parseArg(toElementString(parsed[i]), c.type, c.components, c.name || `field${i}`),
      );
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      // viem accepts a named object for a tuple whose components are all named.
      if (components.every((c) => c.name)) {
        const out: Record<string, unknown> = {};
        for (const c of components) {
          if (!(c.name! in obj)) throw new AbiArgError(`${what} is missing "${c.name}".`);
          out[c.name!] = parseArg(toElementString(obj[c.name!]), c.type, c.components, c.name);
        }
        return out;
      }
    }
    throw new AbiArgError(`${what} must be a JSON array of its fields.`);
  }

  if (type === "address") {
    if (!/^0x[0-9a-fA-F]{40}$/.test(v)) {
      throw new AbiArgError(`${what} must be a 0x address of 40 hex characters.`);
    }
    return v as `0x${string}`;
  }

  if (type.startsWith("uint") || type.startsWith("int")) {
    if (!v) throw new AbiArgError(`${what} is required.`);
    if (!/^-?\d+$/.test(v) && !/^0x[0-9a-fA-F]+$/.test(v)) {
      throw new AbiArgError(`${what} must be a whole number (no decimals or units).`);
    }
    const n = BigInt(v);
    const bits = Number(type.replace(/^u?int/, "") || "256");
    const unsigned = type.startsWith("uint");
    if (unsigned && n < 0n) throw new AbiArgError(`${what} cannot be negative.`);
    const max = unsigned ? (1n << BigInt(bits)) - 1n : (1n << BigInt(bits - 1)) - 1n;
    const min = unsigned ? 0n : -(1n << BigInt(bits - 1));
    if (n > max || n < min) throw new AbiArgError(`${what} is out of range for ${type}.`);
    return n;
  }

  if (type === "bool") {
    const b = v.toLowerCase();
    if (b === "true" || b === "1") return true;
    if (b === "false" || b === "0" || b === "") return false;
    throw new AbiArgError(`${what} must be true or false.`);
  }

  const fixed = /^bytes(\d+)$/.exec(type);
  if (fixed) {
    const size = Number(fixed[1]);
    if (v.startsWith("0x")) {
      if (!/^0x[0-9a-fA-F]*$/.test(v) || v.length > 2 + size * 2) {
        throw new AbiArgError(`${what} must be at most ${size} bytes of hex.`);
      }
      // Right-pad short hex, as Solidity does for a bytesN literal.
      return (v + "0".repeat(2 + size * 2 - v.length)) as `0x${string}`;
    }
    // A plain string is encoded as UTF-8, right-padded. It must fit.
    const bytes = new TextEncoder().encode(v);
    if (bytes.length > size) {
      throw new AbiArgError(`${what} is ${bytes.length} bytes as text; it holds at most ${size}.`);
    }
    const padded = new Uint8Array(size);
    padded.set(bytes);
    return ("0x" +
      Array.from(padded)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")) as `0x${string}`;
  }

  if (type === "bytes") {
    if (!/^0x([0-9a-fA-F]{2})*$/.test(v)) {
      throw new AbiArgError(`${what} must be 0x-prefixed hex with an even number of digits.`);
    }
    return v as `0x${string}`;
  }

  return v; // string and anything else
}

/** The key a form stores an input's value under. Unnamed parameters are
 *  `arg{i}`, everywhere: the form that writes and the parser that reads must
 *  agree, or an unnamed constructor argument is silently always empty. */
export function argKey(input: { name?: string }, i: number): string {
  return input.name || `arg${i}`;
}

export function parseArgs(
  inputs: ReadonlyArray<AbiParamLike>,
  values: Record<string, string>,
): unknown[] {
  return inputs.map((input, i) =>
    parseArg(values[argKey(input, i)] ?? "", input.type, input.components, argKey(input, i)),
  );
}
