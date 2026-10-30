// The one switch for what this deployment serves; see lib/features.ts. In a
// module of its own, with no imports, so the hostname rules can read it too.

/** True (the default): ship the Coding Agent alone, at "/". Set
 *  VITE_CODING_AGENT_ONLY=0 at build time to serve every feature. */
export const CODING_AGENT_ONLY = String(import.meta.env.VITE_CODING_AGENT_ONLY ?? "1") !== "0";
