// Schema for the declarative test suites the AI agent emits.
//
// The model returns DATA, never code. Nothing here is eval'd, and the runner
// can only do three things: deploy the contract under test, call a function on
// it, and assert on the result. That keeps an autonomous agent from being able
// to execute arbitrary JavaScript in the user's browser just by writing it
// into a chat reply, which is exactly what a "let the model write test code"
// design would allow.

import { z } from "zod";

/** Addresses the model may reference symbolically. Resolved by the runner to
 *  deterministic test accounts, so a suite never contains a real address. */
export const OWNER_PLACEHOLDER = "$OWNER";
/** Alias for OWNER_PLACEHOLDER. @@DEPLOY uses "$WALLET" for the user's own
 *  address, so suites accept it too rather than making the model remember two
 *  names for the same idea. */
export const WALLET_PLACEHOLDER = "$WALLET";
export const OTHER_PLACEHOLDER = "$OTHER";

// Arguments arrive as JSON, so integers come through as strings (JSON has no
// bigint). The runner coerces them using the ABI's own type information.
const argValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.array(argValue)]),
);

const expectation = z
  .object({
    /** Return value equals this (compared as a string after ABI decoding). */
    equals: z.union([z.string(), z.number(), z.boolean()]).optional(),
    /** The call must revert: `true` for any revert, or a string the revert
     *  reason must contain. Pass `false` for the plain "this call must
     *  succeed" case, when there is no return value worth asserting on. */
    reverts: z.union([z.boolean(), z.string()]).optional(),
    /** An event with this name must be emitted. */
    emits: z.string().optional(),
  })
  .refine((e) => e.equals !== undefined || e.reverts !== undefined || e.emits !== undefined, {
    message: "Each test needs at least one of: equals, reverts, emits",
  });

export const testCase = z.object({
  name: z.string().min(1),
  /** Function to call on the deployed contract. */
  call: z.string().min(1),
  args: z.array(argValue).default([]),
  /** Caller address. Defaults to the owner; use $OTHER to test access control. */
  from: z.string().optional(),
  /** Native token to send with the call, in wei, as a decimal string. */
  value: z.string().optional(),
  /** Advance the chain clock by this many seconds BEFORE the call. Lets a
   *  suite exercise cliffs, vesting schedules, timelocks and deadlines
   *  without waiting. Capped so a suite cannot ask for absurd arithmetic. */
  warpSeconds: z
    .number()
    .int()
    .min(0)
    .max(100 * 365 * 24 * 60 * 60)
    .optional(),
  expect: expectation,
});

/** A helper contract deployed BEFORE the contract under test, so a contract
 *  with an external dependency can actually be exercised.
 *
 *  Without this, anything that calls out to another contract: a vault that
 *  pulls tokens with transferFrom, an invoice contract, a staking pool: could
 *  only be tested up to its first external call, because nothing existed at
 *  the dependency's address. Helper sources are kept SEPARATE from the
 *  contract under test on purpose: they are compiled only for the test run and
 *  never end up in the source that gets deployed and verified onchain. */
/** Placeholders the runner owns. A helper must never bind one of these:
 *  rebinding "the deployer" to a contract makes an ownership assertion pass
 *  while proving nothing, which is the worst possible silent failure in the
 *  step that gates deployment. */
export const RESERVED_PLACEHOLDERS: readonly string[] = [
  OWNER_PLACEHOLDER,
  OTHER_PLACEHOLDER,
  WALLET_PLACEHOLDER,
];

/** Caps on what one suite may ask the browser to do. Each helper is a full
 *  solc compile (seconds), run serially, so an unbounded list would freeze the
 *  tab with nothing explaining why. Generous enough that no honest suite hits
 *  them. */
export const MAX_HELPERS = 5;
export const MAX_HELPER_SOURCE_BYTES = 24_000;

export const helperContract = z.object({
  /** Placeholder the helper's address is bound to, e.g. "$TOKEN". Usable in
   *  deployArgs, test args and expected values. */
  as: z
    .string()
    .regex(/^\$[A-Z][A-Z0-9_]*$/, 'Must look like "$TOKEN": $ then UPPER_SNAKE')
    .refine((v) => !RESERVED_PLACEHOLDERS.includes(v), {
      message: `Cannot reuse a built-in placeholder (${RESERVED_PLACEHOLDERS.join(", ")}): pick another name such as $TOKEN`,
    }),
  /** Full Solidity source for the helper. Compiled for the test run only. */
  solidity: z
    .string()
    .min(1)
    .max(MAX_HELPER_SOURCE_BYTES, "Helper source is too large: keep mocks minimal"),
  /** Which contract in that source to deploy. Defaults to the only one. */
  contract: z.string().optional(),
  args: z.array(argValue).default([]),
});

export const testSuite = z.object({
  /** Helper contracts deployed first, in order. Each may reference earlier
   *  helpers' placeholders in its own args. */
  deploy: z
    .array(helperContract)
    .max(MAX_HELPERS, `At most ${MAX_HELPERS} helper contracts per suite`)
    .refine((list) => new Set(list.map((h) => h.as)).size === list.length, {
      message: "Two helpers claim the same placeholder, each needs a distinct name",
    })
    .default([]),
  /** Constructor arguments for the contract under test. */
  deployArgs: z.array(argValue).default([]),
  tests: z.array(testCase).min(1),
});

export type HelperContract = z.infer<typeof helperContract>;
export type TestCase = z.infer<typeof testCase>;
export type TestSuite = z.infer<typeof testSuite>;

export interface TestOutcome {
  name: string;
  passed: boolean;
  /** Why it failed, in language that can be fed straight back to the model. */
  detail?: string;
  gasUsed?: string;
}

export interface SuiteResult {
  /** Addresses assigned to helper placeholders, for reporting. */
  helpers?: Record<string, string>;
  deployed: boolean;
  deployError?: string;
  outcomes: TestOutcome[];
  passed: number;
  failed: number;
  /** True only when the contract deployed AND every test passed. */
  ok: boolean;
}
