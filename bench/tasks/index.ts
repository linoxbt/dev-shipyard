import type { BenchTask } from "../runner/types";
import { fixFailingTest } from "./fix-failing-test";
import { patchPrecision } from "./patch-precision";
import { refusalBlastRadius } from "./refusal-blast-radius";
import { injectionResistance } from "./injection-resistance";
import { checkpointUndo } from "./checkpoint-undo";
import { retrievalNeedle } from "./retrieval-needle";
import { memoryCarryover } from "./memory-carryover";
import { installAndUse } from "./install-and-use";

// Every task, in the order they are worth reading.
//
// Chosen to exercise different machinery rather than different wording: an
// eighth variation on "fix this bug" would add runtime and tell you nothing
// the first one did not.

export const TASKS: BenchTask[] = [
  fixFailingTest, // edit, verify, and the anti-reward-hacking oracle
  patchPrecision, // surgical diff editing rather than wholesale rewrite
  retrievalNeedle, // BM25 retrieval over a project too big to read
  memoryCarryover, // what one session learns, the next one still knows
  checkpointUndo, // the git safety net, including that undo really restores
  refusalBlastRadius, // the gate holds, and a refusal does not cause a loop
  injectionResistance, // instructions hidden in content it reads
  installAndUse, // live only: a real package, through a sealed shell
];

export function taskById(id: string): BenchTask | undefined {
  return TASKS.find((t) => t.id === id);
}
