import type { GenerateInput, ModelProvider, ProviderMessage, ProviderResult } from "./types";

// The provider a sandbox uses: every model call goes to DevStation's own
// server (routes/api.model.ts) with the turn's pass, and that server holds the
// model keys, checks the plan and meters the spend. Nothing in the sandbox can
// read a key, because there is none there.

/** Under the host's request-body limit (4.5 MB on Vercel), with room. */
const MAX_BODY = 3_800_000;

export interface ProxyTarget {
  /** https://<site>/api/model */
  url: string;
  /** The turn's sealed pass. */
  token: string;
}

export class ProxyProvider implements ModelProvider {
  readonly name = "devstation";

  constructor(
    private readonly target: ProxyTarget,
    readonly model: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async generate(input: GenerateInput): Promise<ProviderResult> {
    const payload = fitBody({
      system: input.system,
      messages: input.messages,
      tools: input.tools,
      maxTokens: input.maxTokens,
    });

    let res: Response | null = null;
    let lastError = "";
    // A cold function or a dropped connection before any answer is worth two
    // more tries; once the reply has started, a failure is final.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await this.fetchImpl(this.target.url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.target.token}`,
          },
          body: payload,
          signal: input.signal,
        });
        if (res.status < 500) break;
        lastError = `DevStation's model service answered ${res.status}.`;
      } catch (error) {
        if (input.signal?.aborted) throw error;
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    if (!res) throw new Error(lastError || "DevStation's model service could not be reached.");
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => null)) as { message?: string } | null;
      throw new Error(
        data?.message || lastError || `DevStation's model service answered ${res.status}.`,
      );
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let result: ProviderResult | null = null;
    let failure: string | null = null;
    const handle = (line: string) => {
      if (!line.trim()) return;
      let frame: { d?: string; r?: ProviderResult; e?: string };
      try {
        frame = JSON.parse(line);
      } catch {
        return;
      }
      if (typeof frame.d === "string") input.onDelta?.(frame.d);
      if (frame.r) result = frame.r;
      if (typeof frame.e === "string") failure = frame.e;
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handle(line);
    }
    handle(buffer);
    if (failure) throw new Error(failure);
    if (!result) throw new Error("The model's answer was cut off. Try again.");
    return result;
  }

  /** Tell the site a turn finished (for its records). Never throws. */
  async reportTurn(turn: {
    workspace: string;
    turn: number;
    phase: "idle" | "error" | "cancelled";
    steps: number;
    costUsd: number;
    changed: number;
    plan: boolean;
  }): Promise<void> {
    try {
      await this.fetchImpl(this.target.url.replace(/\/api\/model$/, "/api/model/turn"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.target.token}`,
        },
        body: JSON.stringify(turn),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // The site also records a finished turn when it next sees it.
    }
  }
}

/**
 * The request, kept under the body limit. A long run's history is mostly old
 * tool output and pictures, so those go first: pictures before the latest
 * message become a line saying so, then old tool results are shortened. The
 * newest messages are never touched.
 */
export function fitBody(payload: {
  system: string;
  messages: ProviderMessage[];
  tools?: unknown;
  maxTokens?: number;
}): string {
  let body = JSON.stringify(payload);
  if (body.length <= MAX_BODY) return body;
  const messages = payload.messages.map((m) => ({ ...m })) as ProviderMessage[];
  const keep = Math.max(0, messages.length - 6);
  for (let i = 0; i < keep; i++) {
    const m = messages[i];
    if (m.role === "user" && m.images?.length) {
      messages[i] = {
        role: "user",
        content: `${m.content}\n[${m.images.length} picture(s) left out to fit the request]`,
      };
    }
  }
  body = JSON.stringify({ ...payload, messages });
  for (let limit = 4000; body.length > MAX_BODY && limit >= 250; limit = Math.floor(limit / 2)) {
    for (let i = 0; i < keep; i++) {
      const m = messages[i];
      if (m.role === "tool" && m.content.length > limit) {
        messages[i] = {
          ...m,
          content: `${m.content.slice(0, limit)}\n…(shortened to fit the request)`,
        };
      }
    }
    body = JSON.stringify({ ...payload, messages });
  }
  return body;
}
