import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MODEL_FALLBACK_ORDER = [
  'google/gemini-2.5-pro',
  'openai/gpt-5',
  'openai/gpt-5-mini',
];

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function callAI(apiKey: string, messages: Array<{ role: string; content: string }>) {
  let lastError: Error | null = null;
  for (const model of MODEL_FALLBACK_ORDER) {
    for (let attempt = 0; attempt <= 1; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 50000);
        const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages, response_format: { type: "json_object" } }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (response.ok) return { response, model };
        if (response.status === 429 || response.status === 402) return { response, model };
        if (response.status >= 400 && response.status < 500) break;
        if (attempt < 1) { await sleep(1000); continue; }
        break;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (attempt < 1) { await sleep(1000); continue; }
        break;
      }
    }
  }
  throw lastError || new Error('All AI models failed');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

  const [{ data: allowed }, body] = await Promise.all([
    supabase.rpc("check_rate_limit", { p_function: "analyze-linkedin-profile", p_ip: clientIp, p_max_requests: 10, p_window_minutes: 60 }),
    req.json()
  ]);
  if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const { resumeText, linkedinText, industry, resumeAtsScore } = body;

  if (!resumeText || !linkedinText) {
    return new Response(JSON.stringify({ error: 'resumeText and linkedinText are required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return new Response(JSON.stringify({ error: 'AI service not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const systemPrompt = `You are an expert career coach who analyzes LinkedIn profiles alongside resumes to give candidates a complete picture of their professional presence.

You will receive a resume and a LinkedIn profile export. Your job is to:
1. Analyze the LinkedIn profile quality on its own merits
2. Identify inconsistencies between the two (title mismatches, date gaps, missing roles)
3. Find resume content that should be added to LinkedIn
4. Give LinkedIn-specific optimization advice (headline, About section, skills)

Return a JSON object with EXACTLY this structure:
{
  "linkedinScore": <number 0-100>,
  "linkedinGrade": <"A"|"B"|"C"|"D"|"F">,
  "headline": {
    "current": <string — the actual headline from LinkedIn or "Not found">,
    "score": <number 0-100>,
    "issues": [<string>],
    "suggestion": <string — a specific improved headline, max 220 chars>
  },
  "about": {
    "wordCount": <number>,
    "score": <number 0-100>,
    "issues": [<string>],
    "suggestion": <string — a specific improved first 2-3 sentences of the About section>
  },
  "consistencyIssues": [
    {
      "type": <"title_mismatch"|"date_mismatch"|"missing_role"|"missing_from_linkedin"|"missing_from_resume">,
      "description": <string — specific and actionable>,
      "severity": <"high"|"medium"|"low">
    }
  ],
  "missingFromLinkedIn": [<string — specific resume bullets or achievements not reflected on LinkedIn, max 4>],
  "linkedinTips": [<string — specific, actionable LinkedIn optimization tips, 3-5 items>],
  "profileCompleteness": {
    "score": <number 0-100>,
    "missing": [<string — e.g. "Profile photo", "Custom URL", "Featured section", "Skills section"]
  }
}`;

  const userPrompt = `Analyze this resume and LinkedIn profile together.

DETECTED INDUSTRY: ${industry || 'general'}
RESUME ATS SCORE: ${resumeAtsScore || 'unknown'}

<resume>
${resumeText.substring(0, 8000)}
</resume>

<linkedin_profile>
${linkedinText.substring(0, 8000)}
</linkedin_profile>

Identify:
1. Inconsistencies between the two (job titles, dates, companies, achievements)
2. Strong resume bullets that should appear on LinkedIn but don't
3. LinkedIn-specific weaknesses (weak headline, missing About, skills gaps)
4. A specific improved headline and About section opening

Return valid JSON only.`;

  try {
    console.log("[ANALYZE-LINKEDIN] Starting analysis");
    const { response, model } = await callAI(apiKey, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ]);

    if (!response.ok) {
      const status = response.status;
      if (status === 429) return new Response(JSON.stringify({ error: "AI service busy. Please try again shortly.", retryable: true }), { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ error: "AI analysis failed" }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) return new Response(JSON.stringify({ error: "Empty AI response" }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    let analysis;
    try {
      analysis = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return new Response(JSON.stringify({ error: "Invalid AI response format" }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      analysis = JSON.parse(match[0]);
    }

    console.log("[ANALYZE-LINKEDIN] Analysis complete, model:", model);
    return new Response(JSON.stringify({ success: true, ...analysis, modelUsed: model }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[ANALYZE-LINKEDIN] Error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
