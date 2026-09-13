import { describe, expect, it } from "bun:test";
import { zodToJsonSchema } from "./orchestrator";
import { TOOLS, type ToolDefinition } from "./tools";
import { describeFailure } from "./providers/openrouter";

// What the model is told about each tool has to be something every provider
// accepts. A malformed property name in one tool fails the whole request, and
// 0.2.4 shipped exactly that: update_plan's schema was built by splitting its
// usage string on commas, and Anthropic refused every request from then on.

const ANTHROPIC_KEY = /^[a-zA-Z0-9_.-]{1,64}$/;

function keysOf(schema: unknown, path = ""): string[] {
  if (!schema || typeof schema !== "object") return [];
  const s = schema as { properties?: Record<string, unknown>; items?: unknown };
  const own = Object.keys(s.properties ?? {}).map((k) => `${path}${k}`);
  const nested = Object.entries(s.properties ?? {}).flatMap(([k, v]) => keysOf(v, `${path}${k}.`));
  return [...own, ...nested, ...keysOf(s.items, path)];
}

describe("tool schemas the model is shown", () => {
  for (const def of Object.values(TOOLS)) {
    it(`${def.name} has property names every provider accepts`, () => {
      const schema = zodToJsonSchema(def as ToolDefinition);
      for (const key of keysOf(schema)) {
        const last = key.split(".").pop() ?? key;
        expect(last).toMatch(ANTHROPIC_KEY);
      }
    });
  }

  it("describes update_plan's steps as a list of objects", () => {
    const schema = zodToJsonSchema(TOOLS.update_plan as ToolDefinition) as {
      properties: { plan: { type: string; items: { required: string[] } } };
    };
    expect(schema.properties.plan.type).toBe("array");
    expect(schema.properties.plan.items.required).toEqual(["step", "status"]);
  });
});

describe("a provider error from OpenRouter", () => {
  it("says what the provider actually objected to", () => {
    const detail = JSON.stringify({
      error: {
        message: "Provider returned error",
        code: 400,
        metadata: {
          raw: JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message:
                "tools.15.custom.input_schema.properties: Property keys should match pattern",
            },
          }),
          provider_name: "Anthropic",
        },
      },
    });
    const text = describeFailure("OpenRouter", 400, detail);
    expect(text).toContain("Provider returned error");
    expect(text).toContain("tools.15.custom.input_schema.properties");
  });
});
