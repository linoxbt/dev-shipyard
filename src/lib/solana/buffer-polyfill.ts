// Browser Buffer polyfill. @solana/web3.js, @solana/spl-token and Metaplex use
// Node's Buffer at runtime; Vite does not polyfill Node globals, so we install
// one on the client. Imported as the FIRST import in SolanaProvider (which is
// client-mounted) so globalThis.Buffer exists well before any deploy runs.
// On the server Buffer is already a global, so this is a no-op there.
import { Buffer } from "buffer";

if (typeof globalThis !== "undefined" && !(globalThis as { Buffer?: unknown }).Buffer) {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;
}
