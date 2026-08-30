// Resource ceilings for one job.
//
// These are deliberately tight. A generated app is a handful of files and a
// short dependency list; anything that needs more than this is either wrong or
// hostile, and in both cases stopping early is the right answer.

export const LIMITS = {
  /** Hard wall-clock per phase, enforced by the runner AND by docker. */
  phaseTimeoutMs: 180_000,
  /** Installing gets longer than the rest. It is the only phase that touches
   *  the network, and a cold install of a generated project was measured at
   *  175s — near enough to the ordinary limit that jobs failed by a few
   *  seconds. The image is warmed to make this rare, but a project that adds
   *  its own dependencies still has real downloading to do.
   *
   *  Widened again for gVisor. Measured on this host: a warm install is 43s
   *  under runc and 138s under runsc — 3.2x, because gVisor services syscalls
   *  in user space and npm does little else. A cold install at that ratio
   *  would be around nine minutes, so the ceiling has to clear it. */
  installTimeoutMs: 600_000,
  /** Whole job, across all phases. Has to exceed the install ceiling plus the
   *  phases after it, which are 1.4-1.9x slower under gVisor too. */
  jobTimeoutMs: 900_000,
  memory: "1g",
  /** Fraction of one CPU core. */
  cpus: "1.0",
  /** Guards against fork bombs. */
  pidsLimit: 256,
  /** Per-phase captured output; beyond this we truncate rather than stream
   *  unbounded data back to a browser. */
  maxLogBytes: 200_000,
  /** Total bytes of source accepted in one job. */
  maxInputBytes: 2_000_000,
  maxFiles: 200,
  /** Total bytes of build output returned. */
  maxOutputBytes: 8_000_000,
} as const;

export type PhaseName = "install" | "lint" | "typecheck" | "build" | "test";

/** Which phases may reach the network.
 *
 *  Only installing needs a registry. Everything after it runs with
 *  `--network none`, so model-written code cannot exfiltrate anything or call
 *  out during a build or a test. */
export const NETWORK_PHASES: ReadonlySet<PhaseName> = new Set<PhaseName>(["install"]);

export const PHASE_COMMANDS: Record<PhaseName, string[]> = {
  // Seeded from the image's warm copy before npm runs. Everything a generated
  // project starts with is then already present, so npm has only the packages
  // the model added to fetch — usually none. `cp -a` of ~120MB inside the
  // container costs a second or two against the ~175s a cold install took.
  //
  // A shell, because it is two commands. `|| true` on the copy: a project
  // that has its own node_modules is not an error, just an unusual one.
  install: [
    "sh",
    "-c",
    "cp -a /opt/warm/node_modules /work/ 2>/dev/null || true; " +
      "npm install --no-audit --no-fund --loglevel=error",
  ],
  lint: ["npx", "--no-install", "eslint", ".", "--max-warnings=0"],
  typecheck: ["npx", "--no-install", "tsc", "--noEmit"],
  build: ["npm", "run", "build"],
  test: ["npx", "--no-install", "playwright", "test", "--reporter=line"],
};

/** How long a phase may run. */
export function phaseTimeout(phase: PhaseName): number {
  return phase === "install" ? LIMITS.installTimeoutMs : LIMITS.phaseTimeoutMs;
}
