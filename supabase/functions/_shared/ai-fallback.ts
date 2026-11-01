// Model-fallback chain for PAID deliverables — a paying customer should never
// lose their generation to a transient model error. Tries each model in order:
//   - 5xx / dropped connection → one retry, then next model
//   - timeout → next model at once, never the same model again (S13-001)
//   - 429 on a model → advance to the NEXT model (a capacity limit on one
//     model shouldn't kill the delivery; if every model 429s, the last 429 is
//     returned so callers keep their existing "try again shortly" handling)
//   - 402 (credits exhausted) → return immediately; it hits every model alike
//   - other 4xx → next model (bad interaction with that model's API shape)
//   - the caller's signal aborted (a caller that passes options.signal) →
//     the chain stops at once and throws ChainStopped: no retry, no next model
// Derived from generate-cover-letter's proven in-house pattern, extracted so
// generate-freelance-boost and generate-interview-coach share one copy, with
// one deliberate change: 429 falls through to the next model instead of
// returning right away.
//
// Pure Deno/fetch, no imports — safe to import from any edge function.

const MAX_RETRIES = 1;
const REQUEST_TIMEOUT_MS = 55000;
const RETRY_DELAY_MS = 1000;
// THE WHOLE CHAIN'S CLOCK (register L5-11). Three models x two attempts x
// 55 s could run five minutes, far past the platform's 150-second limit, so a
// stalled gateway ended in the platform's 504 instead of this function's own
// retryable error. Each attempt now gets at most what is left of this budget.
// Exported so a caller that makes more than one chain call in a request (a
// draft, then its repair) can hold the whole request to the same 125 s.
export const CHAIN_DEADLINE_MS = 125_000;
const MIN_ATTEMPT_MS = 5_000;
// Gemini 2.5's thinking counts against max_tokens, and gpt-5's reasoning
// against max_completion_tokens (S12-055: a 3,000-token cap, thinking
// included, cut a paid reply in half; S10-009: 14 STAR answers in 9,000).
// 8,192 is Gemini's "medium" thinking budget. A caller sizes its cap as its
// largest legitimate reply, measured from what it asks for, plus this.
export const THINKING_TOKENS = 8_192;
// A MODEL THAT RAN OUT OF TIME IS NOT ASKED AGAIN (S13-001, S10-009). A
// timed-out attempt used to be caught like a dropped connection and retried
// on the same model: a slow gemini-2.5-pro was aborted at 55 s, asked again
// and aborted at 111 s, flash got the 14 s left of the budget and gpt-5-mini
// nothing, and the caller met an AbortError at 126 s. A timeout now goes to
// the next model with what is left. And the first model's attempts never run
// into the last FALLBACK_WINDOW_MS of the budget while another model follows:
// with the default chain the fallback has at least 40 s whenever the first
// model times out, even on the retry after a slow 5xx. A caller that raises
// attemptTimeoutMs past budget - 40 s gives the next model what is left.
const FALLBACK_WINDOW_MS = 40_000;

/**
 * The caller stopped the chain (options.signal): its reply is no longer
 * wanted. Named apart from an AbortError on purpose: callers answer a
 * timeout as retryable, and a stop is not a timeout.
 */
const chainStopped = (context: string) =>
  Object.assign(new Error(`${context}: stopped by the caller`), { name: "ChainStopped" });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A model answered, but with nothing a paid delivery can use (unparseable or
 * truncated JSON). Callers turn it into a retryable 5xx so the delivery stays
 * open for the retry sweep, instead of shipping an invented placeholder as a
 * successful delivery (register L5-12).
 */
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
  /**
   * Sent as max_completion_tokens to EVERY model, Google's included, instead
   * of maxTokens: the body generate-cover-letter and generate-premium-package
   * always sent from their own chains, kept byte for byte now that they walk
   * this one.
   */
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
  /**
   * The longest one attempt on the FIRST model may take, in ms (default 55 s,
   * as for every other model). A caller whose first model is slow on a big
   * reply sets it so the next model keeps a real window: with the default
   * 125 s budget, 80 s leaves the fallback 45 s. Never sent to the gateway.
   */
  attemptTimeoutMs?: number;
  /**
   * Stops the chain when it fires: the attempt in flight is aborted, nothing
   * is retried, no further model is asked, and the call throws ChainStopped.
   * For a caller that asks several calls at once and no longer needs this
   * one (analyze-resume's section calls once the core has failed). Never
   * sent to the gateway.
   */
  signal?: AbortSignal;
}

// Default order: the paid-quality primary, then the same-family model the
// products originally shipped on (known-good output shape), then cross-provider.
export const DEFAULT_MODELS = [
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'openai/gpt-5-mini',
];

// Build a fallback chain that KEEPS a function's current primary model first (so
// its latency/quality profile is unchanged on the happy path) and appends
// cross-provider fallbacks for resilience, de-duped. Use when converting a
// single-model call site: chainFrom("google/gemini-2.5-flash-lite") preserves the
// fast primary, then falls back across family and provider only on failure.
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
  // The time the first model's attempts leave the next one: 40 s, or what a
  // budget that cannot hold a full first attempt plus 40 s has left after it.
  // A first attempt therefore always gets min(firstAttemptMs, budget), as it
  // did before; only a retry can meet this line.
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
          // OpenAI gpt-5-family models reject temperature and use
          // max_completion_tokens (see generate-cover-letter / -apply-package —
          // none send temperature or response_format to openai/*). Google
          // models take the standard params. Callers' JSON parsing already has
          // a regex fallback, so dropping response_format on the last-resort
          // leg is safe.
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

/**
 * True when a chain call failed for want of time: an attempt aborted on its
 * clock, or the budget spent before any model answered. Never true for a
 * caller's stop (ChainStopped), which is not a timeout.
 */
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

/**
 * WHAT A REPLY WAS, FOR A LOG LINE: its shape and lengths, never its words
 * (S13-064). "Unexpected response format" lines used to print the whole
 * reply, which for a résumé parser or a tailored résumé is the person's name,
 * email, phone and employers, into the function logs.
 */
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

/**
 * WHAT AN ERROR WAS, FOR A LOG LINE, WITHOUT THE TEXT IT WAS READING (recheck
 * of S13-064). V8's JSON.parse message quotes up to about ten characters
 * either side of where it failed (Unexpected token 'J', ...", "name": Jane
 * Doe, "... is not valid JSON), so the lines kept for a tool call whose
 * arguments did not parse still put a fragment of the person's résumé into
 * the function logs. A SyntaxError is named by its position only; any other
 * error by its name and message (a timeout, a refused request), which quote
 * no reply; anything else thrown by its type.
 */
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
  /**
   * Turns a 200 reply into what the caller delivers, or null when it cannot
   * be delivered (empty, unparseable, missing what was asked). A reply cut
   * off at its token cap is refused before this is asked.
   */
  read: (data: unknown, modelUsed: string) => T | null | undefined;
}

/**
 * A 200 IS NOT A DELIVERY (S10-009, S13-065). callAIWithModelFallback hands
 * back the first 200, whatever it holds: a reply cut off at its token cap
 * (the thinking spent it), an empty message or JSON that does not parse
 * counted as success, and the caller failed with no fallback. This walks the
 * same chain and asks the NEXT model, with what is left of the budget,
 * whenever the reply is cut off (finish_reason "length") or `read` refuses
 * it. The first model keeps the caller's attemptTimeoutMs; every later one
 * gets the chain's own. A gateway refusal (429 on every model, 402) comes
 * back as { ok: false } exactly as callAIWithModelFallback returns it; a
 * timeout or a caller's stop is thrown as it throws them. When every model
 * that answered was refused, or the budget is spent after a refused reply,
 * it throws UnusableModelOutput.
 */
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

/**
 * READS THE GATEWAY'S STREAMED REPLY (OpenAI-style SSE) INTO CONTENT DELTAS.
 *
 * Network chunks do not respect line boundaries. generate-cover-letter-stream
 * decoded each chunk on its own and split it on newlines with no carry-over,
 * so a `data:` line cut across two reads failed to parse in its first half,
 * lost its prefix in its second, and both halves were dropped: paid cover
 * letters arrived with words missing (register L5-04). Multibyte characters
 * cut across reads broke the same way. generate-premium-package-stream had
 * the carry-over, but put an unparseable COMPLETE line back on the buffer,
 * where the newline loop took it straight out again: a synchronous infinite
 * loop on one malformed line (register L5-19).
 *
 * Here: bytes are decoded with { stream: true }, only complete lines are
 * handled, the remainder waits for the next read, and a complete line that
 * does not parse is reported and dropped, never re-queued. flush() handles
 * the last line when the stream ends without a trailing newline.
 */
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
