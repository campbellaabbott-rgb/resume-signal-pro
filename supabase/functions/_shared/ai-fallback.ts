














const MAX_RETRIES = 1;
const REQUEST_TIMEOUT_MS = 55000;
const RETRY_DELAY_MS = 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface FallbackAIOptions {
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  jsonResponse?: boolean;
  
  tools?: unknown[];
  
  toolChoice?: unknown;
  
  models?: string[];
  
  context?: string;
}



const DEFAULT_MODELS = [
  'google/gemini-2.5-pro',
  'google/gemini-2.5-flash',
  'openai/gpt-5-mini',
];






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
          
          console.error(`[${context}] 402 credits exhausted on ${model}`);
          return { response, modelUsed: model };
        }

        if (response.status === 429) {
          
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

  
  
  if (lastRateLimited) return lastRateLimited;
  throw lastError ?? new Error(`${context}: all models failed`);
}
