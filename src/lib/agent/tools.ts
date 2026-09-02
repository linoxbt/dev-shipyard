import { z } from "zod";
import { evaluate, type Verdict } from "./policy";
import { asUntrusted, redact } from "./secrets";
import type { ProtectedAction } from "./authorization";

// The tool boundary.
//
// Today the model writes fenced code blocks and the runner applies them, which
// means it cannot look before it edits, cannot run a command and read the
// output, and cannot repair what it broke. A tool registry is what turns that
// into a loop: propose a call, check it, run it, feed the result back.
//
// Two rules hold everything together:
//
//   1. A tool is described by a SCHEMA, and arguments are parsed against it
//      before anything runs. A model that invents an argument gets a
//      validation error, not an execution.
//   2. Every call passes through the policy engine first. The tool does not
//      decide whether it may run — evaluate() does, from the operation name
//      and the resources, never from anything the model wrote.
//
// Output is redacted and wrapped as untrusted before it goes back to the model:
// a file's contents, a build log or a dependency's README are DATA. Text inside
// them that reads like an instruction is material to handle, not a command.

export interface ToolDefinition<S extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  /** The operation this maps to for policy purposes. */
  operation: string;
  schema: S;
  /** Which argument names identify what is being touched, so the policy engine
   *  and any authorization grant can be scoped to real resources. */
  resourcesFrom: (args: z.infer<S>) => string[];
  /** Output that must be treated as untrusted when returned to the model. */
  returnsUntrustedContent: boolean;
}

const filePath = z
  .string()
  .min(1)
  .max(400)
  // A tool must never reach outside the workspace, whatever the model asks.
  .refine((p) => !p.includes(".."), "path traversal is not allowed")
  .refine((p) => !p.startsWith("/"), "absolute paths are not allowed");

export const TOOLS: Record<string, ToolDefinition> = {
  list_files: {
    name: "list_files",
    description: "List the files in the project.",
    operation: "project.inspect",
    schema: z.object({ path: filePath.optional() }),
    resourcesFrom: (a) => [(a as { path?: string }).path ?? "."],
    returnsUntrustedContent: false,
  },
  read_file: {
    name: "read_file",
    description: "Read one file's contents.",
    operation: "file.read",
    schema: z.object({ path: filePath }),
    resourcesFrom: (a) => [(a as { path: string }).path],
    returnsUntrustedContent: true,
  },
  search_files: {
    name: "search_files",
    description: "Search the project for a string.",
    operation: "project.inspect",
    schema: z.object({ query: z.string().min(1).max(200), path: filePath.optional() }),
    resourcesFrom: () => ["."],
    returnsUntrustedContent: true,
  },
  write_file: {
    name: "write_file",
    description: "Create or replace a file with the given contents.",
    operation: "file.write",
    schema: z.object({ path: filePath, content: z.string().max(400_000) }),
    resourcesFrom: (a) => [(a as { path: string }).path],
    returnsUntrustedContent: false,
  },
  delete_file: {
    name: "delete_file",
    description: "Delete a file from the project.",
    operation: "file.delete",
    schema: z.object({ path: filePath }),
    resourcesFrom: (a) => [(a as { path: string }).path],
    returnsUntrustedContent: false,
  },
  install_dependency: {
    name: "install_dependency",
    description: "Add a package to the project and install it.",
    operation: "dependency.install",
    schema: z.object({
      // No shell metacharacters: this becomes an argument to a package
      // manager, and a name is a name.
      name: z
        .string()
        .min(1)
        .max(120)
        .regex(/^[@a-z0-9._/-]+$/i, "not a package name"),
      version: z.string().max(40).optional(),
      dev: z.boolean().optional(),
    }),
    resourcesFrom: (a) => [(a as { name: string }).name],
    returnsUntrustedContent: true,
  },
  run_build: {
    name: "run_build",
    description: "Install, lint, build and test the project, returning the logs.",
    operation: "build.dev",
    schema: z.object({}),
    resourcesFrom: () => ["project"],
    returnsUntrustedContent: true,
  },
  run_tests: {
    name: "run_tests",
    description: "Run the project's test suite.",
    operation: "test.run",
    schema: z.object({}),
    resourcesFrom: () => ["project"],
    returnsUntrustedContent: true,
  },
};

export type ToolName = keyof typeof TOOLS;

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
}

export type ToolRejection =
  | { reason: "unknown_tool"; message: string }
  | { reason: "invalid_arguments"; message: string }
  // The action travels with the rejection. Without it the caller would have to
  // rebuild the action to issue a grant, and a grant whose fingerprint was
  // computed from a second, separately-built action is a grant for something
  // nobody checked.
  | {
      reason: "needs_authorization";
      message: string;
      // Only ever the confirm branch: a rejection is what an "allow" is not.
      // Typed as such so the caller can read riskLevel without re-narrowing a
      // union that cannot actually be the other case here.
      verdict: Extract<Verdict, { decision: "confirm" }>;
      action: ProtectedAction;
      tool: ToolDefinition;
    };

export type ToolPreflight =
  | { ok: true; tool: ToolDefinition; args: Record<string, unknown>; action: ProtectedAction }
  | { ok: false; rejection: ToolRejection };

export interface PreflightContext {
  taskId: string;
  userId: string;
  projectId: string;
  environment?: "development" | "preview" | "production";
  autonomy?: "ask_sensitive" | "ask_integrations" | "ask_deploy" | "autonomous";
}

/** Validate a proposed call and decide whether it may run.
 *
 *  Called before EVERY execution. A tool that skips this has no security
 *  properties at all, which is why nothing here is optional. */
export function preflight(call: ToolCall, ctx: PreflightContext): ToolPreflight {
  const tool = TOOLS[call.name];
  if (!tool) {
    return {
      ok: false,
      rejection: {
        reason: "unknown_tool",
        message: `There is no tool called "${call.name}".`,
      },
    };
  }

  const parsed = tool.schema.safeParse(call.args);
  if (!parsed.success) {
    // The model gets the validation error back and can correct itself, which
    // is a repair cycle rather than a failure.
    return {
      ok: false,
      rejection: {
        reason: "invalid_arguments",
        message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      },
    };
  }

  const args = parsed.data as Record<string, unknown>;
  const action: ProtectedAction = {
    actionId: call.id,
    taskId: ctx.taskId,
    userId: ctx.userId,
    operation: tool.operation,
    resources: tool.resourcesFrom(args),
    environment: ctx.environment,
    projectId: ctx.projectId,
    parameters: args,
  };

  const verdict = evaluate(action, { autonomy: ctx.autonomy });
  if (verdict.decision === "confirm") {
    return {
      ok: false,
      rejection: {
        reason: "needs_authorization",
        message: verdict.why,
        verdict,
        action,
        tool,
      },
    };
  }
  return { ok: true, tool, args, action };
}

/** Prepare a tool's output for the model.
 *
 *  Truncated so one enormous log cannot consume the context budget, redacted so
 *  a credential in a build log never reaches the transcript, and wrapped when
 *  the content came from the project rather than from us. */
export function presentResult(tool: ToolDefinition, output: string, maxChars = 8_000): string {
  const clipped =
    output.length > maxChars
      ? `${output.slice(0, maxChars / 2)}\n\n… ${output.length - maxChars} characters omitted …\n\n${output.slice(-maxChars / 2)}`
      : output;
  return tool.returnsUntrustedContent ? asUntrusted(tool.name, clipped) : redact(clipped).text;
}

/** The tool list as the model should see it. */
export function toolCatalogue(): Array<{ name: string; description: string }> {
  return Object.values(TOOLS).map((t) => ({ name: t.name, description: t.description }));
}
