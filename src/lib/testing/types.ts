// Schema for the declarative test suites the AI agent emits.
//
// The model returns DATA, never code. Nothing here is eval'd, and the runner
// can only do three things: deploy the contract under test, call a function on
// it, and assert on the result. That keeps an autonomous agent from being able
// to execute arbitrary JavaScript in the user's browser just by writing it
// into a chat reply — which is exactly what a "let the model write test code"
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
  expect: expectation,
});

export const testSuite = z.object({
  /** Constructor arguments for the contract under test. */
  deployArgs: z.array(argValue).default([]),
  tests: z.array(testCase).min(1),
});

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
  deployed: boolean;
  deployError?: string;
  outcomes: TestOutcome[];
  passed: number;
  failed: number;
  /** True only when the contract deployed AND every test passed. */
  ok: boolean;
}
