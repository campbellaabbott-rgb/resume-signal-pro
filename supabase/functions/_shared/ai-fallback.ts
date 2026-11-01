// Model-fallback chain for PAID deliverables (no imports): docs/shared-notes.md#s1

const MAX_RETRIES = 1;
const REQUEST_TIMEOUT_MS = 55000;
const RETRY_DELAY_MS = 1000;
// The whole chain's clock, inside the platform's 150 s: docs/shared-notes.md#s2
export const CHAIN_DEADLINE_MS = 125_000;
const MIN_ATTEMPT_MS = 5_000;
// Thinking headroom a caller adds to its cap: docs/shared-notes.md#s3
export const THINKING_TOKENS = 8_192;
// A timed-out model is not asked again; time kept for the next: docs/shared-notes.md#s4
const FALLBACK_WINDOW_MS = 40_000;

/** The caller stopped the chain; not a timeout. docs/shared-notes.md#s5 */
const chainStopped = (context: string) =>
  Object.assign(new Error(`${context}: stopped by the caller`), { name: "ChainStopped" });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A 200 a paid delivery cannot use. docs/shared-notes.md#s6 */
export class UnusableModelOutput extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnusableModelOutput";
  }
}

/** True when a reply that failed to parse was meant to be JSON (so it is not usable prose either). */
export function looksLikeBrokenJson(text: string): boolean {
  const t = (text ?? "").trim();
  return t === "" || t.startsWith("{") || t.startsWith("[") || t.startsWith("```") || /"[A-Za-z_]+"\s*:/.test(t.slice(0, 600));
}

export interface FallbackAIOptions {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  /** max_completion_tokens for every model. docs/shared-notes.md#s7 */
  maxCompletionTokens?: number;
  jsonResponse?: boolean;
  /** Function-calling tools (passed through to every model in the chain). */
  tools?: unknown[];
  /** tool_choice, e.g. { type: "function", function: { name: "..." } }. */
  toolChoice?: unknown;
  /** Override the default chain (pro → flash → gpt-5-mini). */
  models?: string[];
  /** Label for log lines, e.g. "FREELANCE-BOOST". */
  context?: string;
  /** The whole chain's budget in ms (default 125 s, inside the platform's 150 s). */
  deadlineMs?: number;
  /** The first model's per-attempt limit in ms. docs/shared-notes.md#s8 */
  attemptTimeoutMs?: number;
  /** Stops the chain; the call throws ChainStopped. docs/shared-notes.md#s9 */
  signal?: AbortSignal;
}

// Default order: the paid-quality primary, then the same-family model the
// products originally shipped on (known-good output shape), then cross-provider.
export const DEFAULT_MODELS = [
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'openai/gpt-5-mini',
];

// The function's primary first, then the default tail: docs/shared-notes.md#s10
export function chainFrom(primary: string): string[] {
  const tail = ['google/gemini-2.5-pro', 'google/gemini-2.5-flash', 'openai/gpt-5-mini'];
  return [primary, ...tail.filter((m) => m !== primary)];
}

export async function callAIWithModelFallback(
  apiKey: string,
  options: FallbackAIOptions,
): Promise<{ response: Response; modelUsed: string }> {
  const models = options.models ?? DEFAULT_MODELS;
  const context = options.context ?? 'AI call';
  let lastError: Error | null = null;
  let lastRateLimited: { response: Response; modelUsed: string } | null = null;
  const budgetMs = options.deadlineMs ?? CHAIN_DEADLINE_MS;
  const deadlineAt = Date.now() + budgetMs;
  const firstAttemptMs = options.attemptTimeoutMs ?? REQUEST_TIMEOUT_MS;
  // What the first model's attempts leave the next: docs/shared-notes.md#s11
  const nextModelWindowMs = models.length > 1 ? Math.min(FALLBACK_WINDOW_MS, Math.max(0, budgetMs - firstAttemptMs)) : 0;

  chain: for (let index = 0; index < models.length; index++) {
    const model = models[index];
    const isFirst = index === 0;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (options.signal?.aborted) throw chainStopped(context);
      const left = deadlineAt - Date.now();
      if (left < MIN_ATTEMPT_MS) {
        console.warn(`[${context}] chain deadline reached before ${model} attempt ${attempt + 1}`);
        lastError = lastError ?? new Error(`${context}: timed out before any model answered`);
        break chain;
      }
      const room = isFirst ? left - nextModelWindowMs : left;
      if (room < MIN_ATTEMPT_MS) {
        console.warn(`[${context}] ${model} attempt ${attempt + 1} not made: the next model's ${nextModelWindowMs} ms are kept`);
        break;
      }
      const attemptMs = Math.min(isFirst ? firstAttemptMs : REQUEST_TIMEOUT_MS, room);
      let timedOut = false;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, attemptMs);
      const stop = () => controller.abort();
      options.signal?.addEventListener("abort", stop);
      try {
        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          // openai models get no temperature or response_format: docs/shared-notes.md#s12
          body: JSON.stringify(
            model.startsWith('openai/')
              ? {
                  model,
                  messages: options.messages,
                  ...((options.maxCompletionTokens ?? options.maxTokens) !== undefined ? { max_completion_tokens: options.maxCompletionTokens ?? options.maxTokens } : {}),
                  ...(options.tools ? { tools: options.tools } : {}),
                  ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
                }
              : {
                  model,
                  messages: options.messages,
                  ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                  ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
                  ...(options.maxCompletionTokens !== undefined ? { max_completion_tokens: options.maxCompletionTokens } : {}),
                  ...(options.jsonResponse ? { response_format: { type: 'json_object' } } : {}),
                  ...(options.tools ? { tools: options.tools } : {}),
                  ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
                },
          ),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          if (model !== models[0]) {
            console.log(`[${context}] delivered via fallback model ${model}`);
          }
          return { response, modelUsed: model };
        }

        if (response.status === 402) {
          // Credits are account-level — no model will succeed. Surface now.
          console.error(`[${context}] 402 credits exhausted on ${model}`);
          return { response, modelUsed: model };
        }

        if (response.status === 429) {
          // Capacity on THIS model — the next model may still deliver.
          console.warn(`[${context}] 429 on ${model} — trying next model`);
          lastRateLimited = { response, modelUsed: model };
          break;
        }

        if (response.status >= 500) {
          console.warn(`[${context}] ${response.status} on ${model} (attempt ${attempt + 1})`);
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          break;
        }

        // Other 4xx — request shape rejected by this model; try the next.
        console.warn(`[${context}] ${response.status} on ${model} — trying next model`);
        break;
      } catch (error) {
        clearTimeout(timeoutId);
        if (options.signal?.aborted && !timedOut) throw chainStopped(context);
        const msg = error instanceof Error ? error.message : String(error);
        lastError = error instanceof Error ? error : new Error(msg);
        if (timedOut) {
          // Slow, not broken: asking it again spends the next model's time on
          // the same wait. The AbortError stays lastError, so a chain that
          // ends here still reads as a timeout to every caller.
          console.warn(`[${context}] ${model} attempt ${attempt + 1} failed: ${msg} (timed out after ${attemptMs} ms; not retried, next model)`);
          break;
        }
        console.warn(`[${context}] ${model} attempt ${attempt + 1} failed: ${msg}`);
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
      } finally {
        options.signal?.removeEventListener("abort", stop);
      }
    }
  }

  if (options.signal?.aborted) throw chainStopped(context);

  // Every model rate-limited → hand back the last 429 so callers keep their
  // existing retryable-error handling.
  if (lastRateLimited) return lastRateLimited;
  throw lastError ?? new Error(`${context}: all models failed`);
}

/** True when a chain call failed for want of time. docs/shared-notes.md#s13 */
export function chainRanOutOfTime(error: unknown): boolean {
  if (!(error instanceof Error) || error.name === "ChainStopped") return false;
  return error.name === "AbortError" || error.name === "TimeoutError" || /\babort|timed? ?out/i.test(error.message);
}

type GatewayReply = {
  choices?: Array<{
    finish_reason?: unknown;
    message?: { content?: unknown; tool_calls?: Array<{ function?: { name?: unknown; arguments?: unknown } }> };
  }>;
};

/** True when a 200 reply was cut off at its token cap (finish_reason "length"). */
export function replyWasCutOff(data: unknown): boolean {
  return (data as GatewayReply | null)?.choices?.[0]?.finish_reason === "length";
}

/** A reply's shape for a log line, never its words. docs/shared-notes.md#s14 */
export function describeReply(data: unknown): string {
  if (!data || typeof data !== "object") return `reply: ${data === null ? "null" : typeof data}`;
  const keys = Object.keys(data as Record<string, unknown>).filter((k) => /^[A-Za-z_][\w-]{0,40}$/.test(k)).slice(0, 8);
  const choices = (data as GatewayReply).choices;
  const choice = Array.isArray(choices) ? choices[0] : undefined;
  const message = choice?.message;
  const content = message?.content;
  const calls = Array.isArray(message?.tool_calls) ? message!.tool_calls! : [];
  const finish = typeof choice?.finish_reason === "string" && /^[a-z_]{1,30}$/.test(choice.finish_reason) ? choice.finish_reason : choice?.finish_reason === undefined ? "none" : "?";
  const called = calls.map((c) => {
    const name = typeof c?.function?.name === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(c.function.name) ? c.function.name : "?";
    const args = c?.function?.arguments;
    return `${name}: ${typeof args === "string" ? `${args.length} chars` : "no arguments"}`;
  });
  return [
    `keys=[${keys.join(",")}]`,
    `choices=${Array.isArray(choices) ? choices.length : "none"}`,
    `finish_reason=${finish}`,
    `content=${typeof content === "string" ? `${content.length} chars` : content === undefined || content === null ? "none" : typeof content}`,
    `tool_calls=${calls.length}${called.length ? ` (${called.join(", ")})` : ""}`,
  ].join(" ");
}

/** An error for a log line, without the text it read. docs/shared-notes.md#s15 */
export function describeError(error: unknown): string {
  if (error instanceof SyntaxError) {
    const at = /\bposition (\d+)/.exec(error.message)?.[1];
    if (at) return `SyntaxError at position ${at}`;
    return /\bend of (?:JSON )?input\b/i.test(error.message) ? "SyntaxError at the end of the input" : "SyntaxError";
  }
  if (error instanceof Error) return `${error.name}: ${error.message.slice(0, 120)}`;
  return typeof error;
}

/** What a usable-reply walk hands back: the caller's value, or a gateway refusal (429, 402) for its own handling. */
export type UsableReply<T> =
  | { ok: true; value: T; modelUsed: string }
  | { ok: false; response: Response; modelUsed: string };

export interface UsableReplyOptions<T> extends FallbackAIOptions {
  /** A 200 reply to what is delivered, or null to refuse it. docs/shared-notes.md#s16 */
  read: (data: unknown, modelUsed: string) => T | null | undefined;
}

/** The same chain, until a reply the caller can use. docs/shared-notes.md#s17 */
export async function callAIForUsableReply<T>(
  apiKey: string,
  options: UsableReplyOptions<T>,
): Promise<UsableReply<T>> {
  const { read, attemptTimeoutMs, ...chain } = options;
  const models = chain.models ?? DEFAULT_MODELS;
  const context = chain.context ?? 'AI call';
  const budgetMs = chain.deadlineMs ?? CHAIN_DEADLINE_MS;
  const startedAt = Date.now();
  const refused: string[] = [];
  for (let i = 0; i < models.length;) {
    const left = budgetMs - (Date.now() - startedAt);
    if (left < MIN_ATTEMPT_MS) {
      if (refused.length === 0) {
        throw Object.assign(new Error(`${context}: timed out before any model answered`), { name: "TimeoutError" });
      }
      break;
    }
    const { response, modelUsed } = await callAIWithModelFallback(apiKey, {
      ...chain,
      models: models.slice(i),
      deadlineMs: left,
      ...(i === 0 && attemptTimeoutMs !== undefined ? { attemptTimeoutMs } : {}),
    });
    if (!response.ok) return { ok: false, response, modelUsed };
    const data = await response.json().catch(() => null);
    const cutOff = replyWasCutOff(data);
    let value: T | null | undefined = null;
    if (!cutOff) {
      try {
        value = read(data, modelUsed);
      } catch {
        value = null;
      }
    }
    if (value !== null && value !== undefined) {
      if (refused.length) console.log(`[${context}] usable reply from ${modelUsed} after ${refused.length} refused`);
      return { ok: true, value, modelUsed };
    }
    const why = `${modelUsed} ${cutOff ? "was cut off at its token cap" : "gave no usable reply"} (${describeReply(data)})`;
    refused.push(why);
    console.warn(`[${context}] ${why}; asking the next model`);
    const at = models.indexOf(modelUsed);
    if (at < 0) break;
    i = at + 1;
  }
  throw new UnusableModelOutput(`${context}: no usable reply (${refused.join("; ")})`);
}

/** The gateway's streamed reply to content deltas. docs/shared-notes.md#s18 */
export function createGatewayDeltaReader(handlers: {
  onContent: (text: string) => void;
  onDone?: () => void;
  onBadLine?: (line: string) => void;
}): { push: (bytes: Uint8Array) => void; flush: () => void } {
  const decoder = new TextDecoder();
  let buffer = "";

  const handleLine = (raw: string) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (line === "" || line.startsWith(":") || !line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      handlers.onDone?.();
      return;
    }
    try {
      const parsed = JSON.parse(data);
      const content = parsed?.choices?.[0]?.delta?.content;
      if (typeof content === "string" && content) handlers.onContent(content);
    } catch {
      handlers.onBadLine?.(data.slice(0, 120));
    }
  };

  const drain = () => {
    let i: number;
    while ((i = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      handleLine(line);
    }
  };

  return {
    push(bytes: Uint8Array) {
      buffer += decoder.decode(bytes, { stream: true });
      drain();
    },
    flush() {
      buffer += decoder.decode();
      drain();
      if (buffer.trim()) handleLine(buffer);
      buffer = "";
    },
  };
}
