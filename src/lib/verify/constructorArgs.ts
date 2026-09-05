import { encodeAbiParameters, type AbiParameter } from "viem";

// Blockscout's `constructor_args` is the ABI-encoded constructor tail that
// follows the creation bytecode: the raw encoded args, with NO function
// selector. `encodeAbiParameters` produces exactly that. Passing it explicitly
// is more reliable than Blockscout's autodetect, and we already have the typed
// argument values at deploy time (the same array handed to deployContract).
//
// Returns undefined when the contract has no constructor inputs, when no args
// were supplied, or when encoding fails (caller should then fall back to
// autodetect rather than send a wrong value).
export function encodeConstructorArgs(abi: unknown[], args: unknown[]): `0x${string}` | undefined {
  try {
    const ctor = (abi as Array<{ type?: string; inputs?: AbiParameter[] }>).find(
      (item) => item?.type === "constructor",
    );
    const inputs = ctor?.inputs ?? [];
    if (inputs.length === 0 || args.length === 0) return undefined;
    return encodeAbiParameters(inputs, args);
  } catch {
    return undefined;
  }
}
