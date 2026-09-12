// Deciding how dangerous a command is, with nothing that can run one.
//
// Split out of shell.ts because the registry in tools.ts needs this
// classification and tools.ts is imported by the browser. Leaving these two in
// the same file put `node:child_process` in the client bundle, which Vite
// externalises and which then throws the moment the module is evaluated. The
// App Builder page died on it, and nobody saw for a while because the page was
// behind a "coming soon" gate.
//
// Nothing here touches the process. Everything that does stays in shell.ts.
//
// The classification below is NOT the security boundary. A deny-list of
// dangerous commands can always be worked around (base64, a shell variable, a
// script that writes another script), and treating it as the thing keeping the
// host safe is how people end up surprised. The boundary is the sandbox: a
// scoped workspace, and in hardened mode a container with no network and a
// read-only root. What this does is decide when to ASK, which is a different
// job and one a heuristic is allowed to do imperfectly.
//
// So the default is "needs approval". A small allow-list of genuinely
// read-only commands runs without asking; a deny-list escalates to
// always-ask-even-in-full-auto. Anything unrecognised lands in the middle
// rather than being assumed safe.

export type CommandRisk = "safe" | "writes" | "destructive";

/** Commands that only read. The first word of the command has to be one of
 *  these AND the whole command has to be free of the shell metacharacters that
 *  would let something else ride along.
 *
 *  Interpreters are deliberately NOT here. `node`, `bun`, `python`, `go` and
 *  `cargo` were, and that made the whole gate optional: write a script, run it
 *  with node, and nothing asks. The module comment above is right that a
 *  deny-list is not the security boundary, but an allow-list that includes
 *  "run arbitrary code" is not even a speed bump. Running the project's tests
 *  does not go through here anyway: run_tests is its own tool and its own
 *  operation. */
const READ_ONLY = new Set([
  "ls",
  "pwd",
  "echo",
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "rg",
  "find",
  "which",
  "file",
  "stat",
  "du",
  "df",
  "date",
  "whoami",
  "env",
  "printenv",
  "sort",
  "uniq",
  "diff",
  "tree",
]);

/** Read-only subcommands of tools whose other subcommands are not. */
const READ_ONLY_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set(["status", "log", "diff", "show", "branch", "remote", "rev-parse", "ls-files"]),
  npm: new Set(["ls", "list", "view", "outdated", "--version", "-v"]),
  bun: new Set(["--version", "-v", "pm"]),
  docker: new Set(["ps", "images", "version"]),
};

/** Anything that can destroy work or reach past the workspace. Kept per
 *  platform: `rm -rf` is not a real command on Windows, so a POSIX-only list
 *  would wave through the PowerShell equivalent: a safety gap, not merely a
 *  portability one. */
const DESTRUCTIVE_POSIX: RegExp[] = [
  /\brm\s+(-[a-z]*[rf][a-z]*\s+)+/i,
  /\brm\s+-[a-z]*r/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\bchmod\s+(-R\s+)?[0-7]*777/i,
  /\bchown\s+-R\b/i,
  /:\s*\(\s*\)\s*\{.*\|.*&\s*\}\s*;/, // fork bomb
  /\bsudo\b/i,
  /\bsu\s+-/i,
  />\s*\/dev\/(sd|nvme|disk)/i,
  /\bshutdown\b|\breboot\b|\bhalt\b/i,
  /\bkillall\b|\bpkill\s+-9/i,
  /\bcurl\b[^|]*\|\s*(ba)?sh/i, // pipe-to-shell
  /\bwget\b[^|]*\|\s*(ba)?sh/i,
  /\bgit\s+push\b[^\n]*(--force|-f)\b/i,
  /\bgit\s+reset\b[^\n]*--hard/i,
  /\bgit\s+clean\b[^\n]*-[a-z]*f/i,
  /\bgit\s+branch\b[^\n]*-D\b/i,
  /\bnpm\s+publish\b/i,
];

const DESTRUCTIVE_WINDOWS: RegExp[] = [
  /Remove-Item\b[^\n]*-Recurse/i,
  /Remove-Item\b[^\n]*-Force/i,
  /\brmdir\b[^\n]*\/s/i,
  /\bdel\b[^\n]*\/[qsf]/i,
  /Format-Volume\b/i,
  /Clear-Disk\b/i,
  /Stop-Computer\b|Restart-Computer\b/i,
  /Set-ExecutionPolicy\b/i,
  /Invoke-WebRequest\b[^\n]*\|\s*Invoke-Expression/i,
  /\biex\b\s*\(/i,
];

/** Metacharacters that chain, redirect or substitute. Their presence means the
 *  first word no longer tells you what the command does. */
const CHAINING = /[;&|`$><]|\$\(|&&|\|\|/;

/**
 * Both sets, on every platform, whatever `platform` says.
 *
 * The parameter stays because callers pass it and because the ORDER matters
 * for nothing else here, but the choice it used to make was wrong. PowerShell
 * runs on Linux and macOS, and `pwsh` is one apt-get away; a Linux host with it
 * installed was classifying `Remove-Item -Recurse -Force /` as an ordinary
 * write, which under `--autonomy autonomous` runs without asking. Deciding
 * which commands are dangerous from the operating system of the machine rather
 * than from the command itself is the mistake.
 *
 * The cost of always checking both is false positives on POSIX, and there are
 * none worth having: no benign shell command contains `Format-Volume` or
 * `Stop-Computer`.
 */
export function destructivePatterns(platform: NodeJS.Platform = process.platform): RegExp[] {
  // Windows patterns first on Windows, purely so the common case matches
  // sooner. Every pattern is checked either way.
  return platform === "win32"
    ? [...DESTRUCTIVE_WINDOWS, ...DESTRUCTIVE_POSIX]
    : [...DESTRUCTIVE_POSIX, ...DESTRUCTIVE_WINDOWS];
}

export function classifyCommand(
  command: string,
  platform: NodeJS.Platform = process.platform,
): CommandRisk {
  const trimmed = command.trim();
  if (!trimmed) return "safe";

  // Destructive wins over everything, including an allow-listed first word:
  // "ls && rm -rf /" starts with ls.
  for (const pattern of destructivePatterns(platform)) {
    if (pattern.test(trimmed)) return "destructive";
  }

  // Substitution can run anything, whatever the command around it is.
  if (SUBSTITUTION.test(trimmed)) return "writes";

  if (CHAINING.test(trimmed)) {
    // A chain of commands that each only read is still only reading. Treating
    // every `;` or `|` as a write made `ls -a; ls -d */ 2>/dev/null` ask for
    // permission as a high-risk command, which is how prompts get clicked
    // through unread. Each part is judged on its own; any part that is not
    // plainly read-only, or any redirect into a file, keeps the whole chain gated.
    const segments = trimmed.split(/\s*(?:&&|\|\||;|\|)\s*/).filter(Boolean);
    return segments.length > 0 && segments.every(segmentReadsOnly) ? "safe" : "writes";
  }

  return segmentReadsOnly(trimmed) ? "safe" : "writes";
}

/** `$(…)`, backticks, `${…}` and process substitution. */
const SUBSTITUTION = /`|\$\(|\$\{|<\(|>\(/;

/** Redirects that discard output rather than write a file. */
const HARMLESS_REDIRECT = /\s*(?:[12]?>\s*\/dev\/null|2>&1|&>\s*\/dev\/null)/g;

function segmentReadsOnly(segment: string): boolean {
  const cleaned = segment.replace(HARMLESS_REDIRECT, "").trim();
  if (!cleaned) return true;
  // Any remaining output redirect writes to a file.
  if (/>/.test(cleaned)) return false;
  const [head, sub] = cleaned.split(/\s+/);
  const subcommands = READ_ONLY_SUBCOMMANDS[head];
  if (subcommands) return Boolean(sub && subcommands.has(sub));
  return READ_ONLY.has(head);
}

/** The policy operation a command maps to, so risk is decided by the same
 *  engine as everything else rather than by a second set of rules here. */
export function operationForCommand(command: string): string {
  switch (classifyCommand(command)) {
    case "safe":
      return "project.inspect";
    case "destructive":
      return "shell.exec";
    default:
      return "shell.write";
  }
}
