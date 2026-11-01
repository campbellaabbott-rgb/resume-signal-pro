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
const CHAIN_DEADLINE_MS = 125_000;
const MIN_ATTEMPT_MS = 5_000;
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
                  ...(options.maxTokens !== undefined ? { max_completion_tokens: options.maxTokens } : {}),
                  ...(options.tools ? { tools: options.tools } : {}),
                  ...(options.toolChoice ? { tool_choice: options.toolChoice } : {}),
                }
              : {
                  model,
                  messages: options.messages,
                  ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
                  ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
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
