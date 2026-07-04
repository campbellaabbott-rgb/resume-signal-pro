// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[TEST-AI-FALLBACK] ${step}`, details ? JSON.stringify(details) : '');
};

// Retry and fallback configuration - same as production
const MAX_RETRIES = 1;
const REQUEST_TIMEOUT_MS = 30000; // Shorter for testing
const RETRY_DELAY_MS = 1000;

// Model fallback order - same as production
const MODEL_FALLBACK_ORDER = [
  'openai/gpt-5',
  'google/gemini-2.5-pro',
  'openai/gpt-5-mini',
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

interface AIRequestOptions {
  messages: Array<{ role: string; content: string }>;
  max_completion_tokens?: number;
}

interface FallbackTestResult {
  model: string;
  success: boolean;
  responseTime: number;
  error?: string;
  statusCode?: number;
}

async function testSingleModel(
  apiKey: string,
  model: string,
  options: AIRequestOptions
): Promise<FallbackTestResult> {
  const startTime = Date.now();
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    
    logStep(`Testing model: ${model}`);
    
    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: options.messages,
        max_completion_tokens: options.max_completion_tokens,
      }),
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;
    
    if (response.ok) {
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      logStep(`Model ${model} succeeded`, { responseTime, contentLength: content.length });
      
      return {
        model,
        success: true,
        responseTime,
        statusCode: response.status,
      };
    }
    
    const errorText = await response.text();
    logStep(`Model ${model} failed`, { status: response.status, error: errorText });
    
    return {
      model,
      success: false,
      responseTime,
      statusCode: response.status,
      error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`,
    };
    
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep(`Model ${model} error`, { error: errorMessage, responseTime });
    
    return {
      model,
      success: false,
      responseTime,
      error: errorMessage,
    };
  }
}

async function callAIWithFallback(
  apiKey: string,
  options: AIRequestOptions,
  context: string = 'AI call'
): Promise<{ response: Response; modelUsed: string; fallbacksAttempted: string[] }> {
  const fallbacksAttempted: string[] = [];
  let lastError: Error | null = null;
  
  for (const model of MODEL_FALLBACK_ORDER) {
    fallbacksAttempted.push(model);
    
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
        
        logStep(`${context} - trying ${model}`, { attempt: attempt + 1, model });
        
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: options.messages,
            max_completion_tokens: options.max_completion_tokens,
          }),
          signal: controller.signal,
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          logStep(`${context} - succeeded with ${model}`);
          return { response, modelUsed: model, fallbacksAttempted };
        }
        
        if (response.status === 429 || response.status === 402) {
          return { response, modelUsed: model, fallbacksAttempted };
        }
        
        if (response.status >= 400 && response.status < 500) {
          logStep(`${context} - client error, trying next model`, { status: response.status, model });
          break;
        }
        
        if (response.status >= 500) {
          logStep(`${context} - server error`, { status: response.status, model });
          if (attempt < MAX_RETRIES) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }
          break;
        }
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logStep(`${context} - error with ${model}`, { error: errorMessage });
        lastError = error instanceof Error ? error : new Error(errorMessage);
        
        if (attempt < MAX_RETRIES) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        break;
      }
    }
    logStep(`${context} - ${model} failed, trying next model`);
  }
  
  throw lastError || new Error('All AI models failed');
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { mode = 'quick' } = await req.json().catch(() => ({ mode: 'quick' }));
    
    logStep("Starting AI fallback test", { mode });

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "LOVABLE_API_KEY not configured",
          fallbackConfig: MODEL_FALLBACK_ORDER 
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const testMessages = [
      { role: "system", content: "You are a helpful assistant. Respond briefly." },
      { role: "user", content: "Say 'AI fallback test successful' and nothing else." }
    ];

    if (mode === 'all') {
      // Test all models individually
      logStep("Testing all models individually");
      const results: FallbackTestResult[] = [];
      
      for (const model of MODEL_FALLBACK_ORDER) {
        const result = await testSingleModel(apiKey, model, {
          messages: testMessages,
          max_completion_tokens: 50,
        });
        results.push(result);
      }
      
      const successfulModels = results.filter(r => r.success);
      const failedModels = results.filter(r => !r.success);
      
      logStep("All models test complete", { 
        total: results.length,
        successful: successfulModels.length,
        failed: failedModels.length 
      });
      
      return new Response(
        JSON.stringify({ 
          success: successfulModels.length > 0,
          mode: 'all',
          fallbackConfig: MODEL_FALLBACK_ORDER,
          results,
          summary: {
            totalModels: results.length,
            successfulModels: successfulModels.length,
            failedModels: failedModels.length,
            fastestModel: successfulModels.sort((a, b) => a.responseTime - b.responseTime)[0]?.model || null,
            averageResponseTime: successfulModels.length > 0 
              ? Math.round(successfulModels.reduce((acc, r) => acc + r.responseTime, 0) / successfulModels.length)
              : null,
          }
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Quick mode: test fallback chain as it would work in production
    logStep("Testing fallback chain (production behavior)");
    const startTime = Date.now();
    
    const { response, modelUsed, fallbacksAttempted } = await callAIWithFallback(
      apiKey,
      {
        messages: testMessages,
        max_completion_tokens: 50,
      },
      'Fallback test'
    );

    const totalTime = Date.now() - startTime;

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ 
          success: false,
          mode: 'quick',
          fallbackConfig: MODEL_FALLBACK_ORDER,
          fallbacksAttempted,
          modelUsed,
          error: `All models failed. Last error: HTTP ${response.status}`,
          totalTime,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content || '';

    logStep("Fallback test complete", { 
      modelUsed, 
      fallbacksAttempted, 
      totalTime,
      contentLength: content.length 
    });

    return new Response(
      JSON.stringify({ 
        success: true,
        mode: 'quick',
        fallbackConfig: MODEL_FALLBACK_ORDER,
        fallbacksAttempted,
        modelUsed,
        usedFallback: fallbacksAttempted.length > 1,
        totalTime,
        response: content,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[TEST-AI-FALLBACK] Error:", errorMessage);
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        fallbackConfig: MODEL_FALLBACK_ORDER,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
