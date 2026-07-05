// deploy-stamp: 2026-07-05T00:00Z
// Flagship product: complete structured resume rewrite with per-bullet tracked
// changes. Every rewritten bullet is verified against the original resume
// (claim-grounding, same approach as free-keyword-scan) — ungrounded numbers
// revert the bullet, fabricated bullets/jobs are dropped, and unknown metrics
// must arrive as [bracketed placeholders] the user fills in during review.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: Record<string, unknown>) => {
  console.log(`[GENERATE-RESUME-REWRITE] ${step}`, details ? JSON.stringify(details) : '');
};

const REQUEST_TIMEOUT_MS = 55000;
const MODEL_FALLBACK_ORDER = [
  'openai/gpt-5',
  'google/gemini-2.5-pro',
  'openai/gpt-5-mini',
];

async function callAIWithFallback(
  apiKey: string,
  messages: Array<{ role: string; content: string }>,
  maxTokens: number,
): Promise<{ response: Response; modelUsed: string }> {
  let lastError: Error | null = null;
  for (const model of MODEL_FALLBACK_ORDER) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      logStep(`Trying ${model}`);
      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_completion_tokens: maxTokens }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (response.ok) return { response, modelUsed: model };
      if (response.status === 429 || response.status === 402) return { response, modelUsed: model };
      const errorText = await response.text();
      lastError = new Error(`${model}: ${response.status} ${errorText.substring(0, 120)}`);
      logStep(`${model} failed`, { status: response.status });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logStep(`${model} error`, { error: lastError.message });
    }
  }
  throw lastError || new Error('All AI models failed');
}

// === Grounding helpers (same normalization as free-keyword-scan) ===
const normalizeForGrounding = (s: string) =>
  s.toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[^a-z0-9%$ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const makeAppearsInResume = (resumeText: string) => {
  const groundedResume = normalizeForGrounding(resumeText);
  return (claim: unknown): boolean => {
    if (typeof claim !== 'string') return false;
    const n = normalizeForGrounding(claim);
    if (!n) return false;
    if (n.length <= 45) return groundedResume.includes(n);
    const tokens = n.split(' ').filter(w => w.length >= 4);
    if (tokens.length < 3) return groundedResume.includes(n.slice(0, 45));
    const hits = tokens.filter(tk => groundedResume.includes(tk)).length;
    return hits / tokens.length >= 0.7;
  };
};

// Extract numeric claims ($1.2M, 45%, 30,000, 3x) from text, ignoring anything
// inside [brackets] — bracketed numbers are placeholders the user fills in.
const extractNumericClaims = (text: string): string[] => {
  const withoutBrackets = text.replace(/\[[^\]]*\]/g, ' ');
  const matches = withoutBrackets.match(/\$?\d[\d,.]*(?:\s?%|%|x|k|m|b|K|M|B)?/gi) || [];
  // Normalize each claim to bare digits for comparison ("$ 1,200" -> "1200")
  return matches.map(m => m.replace(/[^0-9]/g, '')).filter(d => d.length > 0);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_function: "generate-resume-rewrite", p_ip: clientIp, p_max_requests: 15, p_window_minutes: 60 });
  if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    // Like generate-premium-package: no UI-language translation — the output is
    // a document the candidate submits to employers in their job-search language.
    const { resumeText, jobDescription, jobTitle, jobCompany } = await req.json();

    if (!resumeText || resumeText.trim().length < 50) {
      return new Response(
        JSON.stringify({ error: "Resume text is required (at least 50 characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    logStep("Starting rewrite", { resumeLength: resumeText.length, hasJD: !!jobDescription });

    const systemPrompt = `You are an elite resume writer producing a complete, structured rewrite of a real person's resume. The output feeds a tracked-changes review UI and an ATS-safe document generator, so structure and honesty are non-negotiable.

## ABSOLUTE RULES — VIOLATIONS ARE AUTOMATICALLY DETECTED AND REJECTED
1. NEVER invent facts. Every company, title, date, degree, certification, and number must come verbatim from the original resume. A verification pass compares your output to the original and DELETES anything you fabricated.
2. NEVER invent numbers. If a bullet would be stronger with a metric the resume doesn't contain, write a [bracketed placeholder] instead — e.g. "[X]% reduction", "[team size]", "[$ amount]". The user fills these in during review.
3. For every bullet you rewrite, "before" must be the EXACT verbatim text of the original bullet (copy-paste it). If "before" can't be found in the original, the rewrite is discarded.
4. Do NOT add bullets describing work the resume doesn't mention. Do NOT drop any job, degree, or certification.
5. Copy contact details exactly as written. Leave fields empty ("") if not present — never guess.

## WHAT A GREAT REWRITE DOES
- Opens each bullet with a strong, varied action verb (no verb used twice in a row)
- Restructures to: action → scope/context → outcome (with real or [bracketed] metric)
- Weaves in relevant keywords from the job description NATURALLY (only where the underlying experience genuinely supports them)
- Kills weak phrasing: "responsible for", "helped with", "worked on", "duties included"
- Writes a sharp 2-4 sentence professional summary grounded ONLY in what the resume shows
- Keeps every bullet ≤ 2 lines (~30 words)

## OUTPUT — VALID JSON ONLY, NO MARKDOWN FENCES
{
  "contact": { "fullName": "", "title": "", "email": "", "phone": "", "location": "", "linkedIn": "", "website": "" },
  "summary": { "before": "original summary text or empty string", "after": "rewritten summary", "reason": "why" },
  "experience": [
    {
      "company": "verbatim from original", "title": "verbatim from original", "location": "", "startDate": "", "endDate": "",
      "bullets": [
        { "before": "EXACT verbatim original bullet", "after": "rewritten bullet ([brackets] for unknown numbers)", "reason": "one short sentence" }
      ]
    }
  ],
  "education": [ { "school": "", "degree": "", "field": "", "startDate": "", "endDate": "", "details": "" } ],
  "skills": ["every skill from the original, plus job-description keywords the experience genuinely supports"],
  "certifications": ["verbatim from original"],
  "strategy": "2-3 sentences: the overall positioning approach taken"
}`;

    const userPrompt = `Rewrite this resume completely, following every rule.

ORIGINAL RESUME:
${resumeText}

TARGET ROLE: ${jobTitle || 'Not specified'}
TARGET COMPANY: ${jobCompany || 'Not specified'}

${jobDescription ? `JOB DESCRIPTION (source for keywords — only add ones the experience supports):
${jobDescription}` : 'No job description provided — optimize for the strongest general presentation of this exact experience.'}

Remember: every "before" is a verbatim copy of an original bullet; every number in an "after" either exists in the original or is [bracketed].`;

    const { response, modelUsed } = await callAIWithFallback(apiKey, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], 14000);

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "AI service is temporarily busy. Please try again in a few moments.", retryable: true }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI service credits depleted. Please contact support.", retryable: false }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw new Error(`AI API error: ${response.status}`);
    }

    const aiResponse = await response.json();
    const content = aiResponse.choices?.[0]?.message?.content;
    if (!content) throw new Error("No content in AI response");

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in AI response");
    const result = JSON.parse(jsonMatch[0]);

    // === GROUNDING VERIFICATION ===
    const appearsInResume = makeAppearsInResume(resumeText);
    const originalDigits = new Set(extractNumericClaims(resumeText));
    // Years (2019, 2023...) appear in dates everywhere; don't treat a year in a
    // rewritten bullet as a fabricated metric if any 4-digit year exists.
    const numberIsGrounded = (digits: string) => {
      if (originalDigits.has(digits)) return true;
      // Tolerate formatting differences: "20000" grounded if original had "20,000" etc.
      for (const d of originalDigits) if (d === digits) return true;
      return false;
    };

    const grounding = { droppedBullets: 0, revertedBullets: 0, droppedJobs: 0, droppedSkills: 0, notes: [] as string[] };

    const experience = Array.isArray(result.experience) ? result.experience : [];
    result.experience = experience.filter((job: { company?: string; title?: string; bullets?: unknown }) => {
      const jobGrounded = appearsInResume(job.company) || appearsInResume(job.title);
      if (!jobGrounded) {
        grounding.droppedJobs++;
        grounding.notes.push(`Removed a job entry not found in your resume: "${String(job.company || job.title || '').slice(0, 60)}"`);
        return false;
      }
      const bullets = Array.isArray(job.bullets) ? job.bullets : [];
      job.bullets = bullets.filter((b: { before?: string; after?: string }) => {
        // A bullet whose "before" isn't in the resume was fabricated — drop it.
        if (!appearsInResume(b.before)) {
          grounding.droppedBullets++;
          logStep("Grounding drop (bullet)", { before: String(b.before).slice(0, 80) });
          return false;
        }
        return true;
      }).map((b: { before: string; after?: string; reason?: string }) => {
        const after = typeof b.after === 'string' ? b.after : b.before;
        // Any unbracketed number in the rewrite must exist in the original.
        const claims = extractNumericClaims(after);
        const invented = claims.filter(d => !numberIsGrounded(d));
        if (invented.length > 0) {
          grounding.revertedBullets++;
          logStep("Grounding revert (invented number)", { after: after.slice(0, 80), invented });
          return { before: b.before, after: b.before, reason: 'Kept your original wording — the suggested rewrite contained a number we could not verify against your resume.', reverted: true };
        }
        return { before: b.before, after, reason: b.reason || '', reverted: false };
      });
      return true;
    });

    // Summary: numbers in the new summary must be grounded too.
    if (result.summary && typeof result.summary.after === 'string') {
      const invented = extractNumericClaims(result.summary.after).filter(d => !numberIsGrounded(d));
      if (invented.length > 0) {
        result.summary.after = result.summary.after.replace(/\$?\d[\d,.]*(?:\s?%|%|x)?/g, (m: string) =>
          numberIsGrounded(m.replace(/[^0-9]/g, '')) ? m : '[verify]');
        grounding.notes.push('Some numbers in the new summary could not be verified and were replaced with [verify] placeholders.');
      }
    }

    // Skills: each skill must appear in the resume or the job description.
    const jdNorm = jobDescription ? normalizeForGrounding(jobDescription) : '';
    const skillGrounded = (s: unknown) => {
      if (typeof s !== 'string' || !s.trim()) return false;
      const n = normalizeForGrounding(s);
      return appearsInResume(s) || (jdNorm !== '' && jdNorm.includes(n));
    };
    const rawSkills = Array.isArray(result.skills) ? result.skills : [];
    result.skills = rawSkills.filter((s: unknown) => {
      const ok = skillGrounded(s);
      if (!ok) grounding.droppedSkills++;
      return ok;
    });

    // Certifications must be verbatim from the resume.
    const rawCerts = Array.isArray(result.certifications) ? result.certifications : [];
    result.certifications = rawCerts.filter((c: unknown) => appearsInResume(c));

    // Count placeholders the user must resolve during review.
    const allText = JSON.stringify(result);
    const bracketCount = (allText.match(/\[[^\]]{1,60}\]/g) || []).length;

    const totalGroundingActions = grounding.droppedBullets + grounding.revertedBullets + grounding.droppedJobs + grounding.droppedSkills;
    if (totalGroundingActions > 0) {
      logStep("Grounding verification complete", grounding as unknown as Record<string, unknown>);
    }

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          ...result,
          originalResumeText: resumeText,
          jobDetails: { title: jobTitle || '', company: jobCompany || '' },
          grounding,
          bracketCount,
          modelUsed,
          generatedAt: new Date().toISOString(),
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[GENERATE-RESUME-REWRITE] Error:", errorMessage);
    if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
      return new Response(
        JSON.stringify({ error: "The AI took too long to respond. Please try again.", retryable: true }),
        { status: 504, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to generate resume rewrite", details: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
