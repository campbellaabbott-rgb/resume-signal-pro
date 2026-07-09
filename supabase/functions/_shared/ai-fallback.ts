// Model-fallback chain for PAID deliverables — a paying customer should never
// lose their generation to a transient model error. Tries each model in order:
//   - 5xx / network / timeout → one retry, then next model
//   - 429 on a model → advance to the NEXT model (a capacity limit on one
//     model shouldn't kill the delivery; if every model 429s, the last 429 is
//     returned so callers keep their existing "try again shortly" handling)
//   - 402 (credits exhausted) → return immediately; it hits every model alike
//   - other 4xx → next model (bad interaction with that model's API shape)
// Derived from generate-cover-letter's proven in-house pattern, extracted so
// generate-freelance-boost and generate-interview-coach share one copy, with
// one deliberate change: 429 falls through to the next model instead of
// returning right away.
//
// Pure Deno/fetch, no imports — safe to import from any edge function.

const MAX_RETRIES = 1;
const REQUEST_TIMEOUT_MS = 55000;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FallbackAIOptions {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonResponse?: boolean;
  /** Override the default chain (pro → flash → gpt-5-mini). */
  models?: string[];
  /** Label for log lines, e.g. "FREELANCE-BOOST". */
  context?: string;
}

// Default order: the paid-quality primary, then the same-family model the
// products originally shipped on (known-good output shape), then cross-provider.
const DEFAULT_MODELS = [
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'openai/gpt-5-mini',
];

export async function callAIWithModelFallback(
  apiKey: string,
  options: FallbackAIOptions,
): Promise<{ response: Response; modelUsed: string }> {
  const models = options.models ?? DEFAULT_MODELS;
  const context = options.context ?? 'AI call';
  let lastError: Error | null = null;
  let lastRateLimited: { response: Response; modelUsed: string } | null = null;

  for (const model of models) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages: options.messages,
            ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
            ...(options.maxTokens !== undefined ? { max_tokens: options.maxTokens } : {}),
            ...(options.jsonResponse ? { response_format: { type: 'json_object' } } : {}),
          }),
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
        const msg = error instanceof Error ? error.message : String(error);
        console.warn(`[${context}] ${model} attempt ${attempt + 1} failed: ${msg}`);
        lastError = error instanceof Error ? error : new Error(msg);
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
      }
    }
  }

  // Every model rate-limited → hand back the last 429 so callers keep their
  // existing retryable-error handling.
  if (lastRateLimited) return lastRateLimited;
  throw lastError ?? new Error(`${context}: all models failed`);
}
