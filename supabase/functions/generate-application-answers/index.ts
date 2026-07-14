// Apply-agent brain: draft answers to a job application's screening questions,
// grounded STRICTLY in the candidate's resume. This is the moat vs. every blind
// mass-apply bot — it refuses to invent, exaggerate, or assume anything the resume
// doesn't support, so a candidate is never trapped defending a fabricated claim in
// a live interview. Questions that shouldn't be auto-answered (identity, uploads,
// demographics, work-authorization/salary/status facts) are filtered out upstream
// by the shared classifier and returned as "for you to complete".
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAIWithModelFallback, chainFrom } from "../_shared/ai-fallback.ts";
import { buildLanguageInstruction } from "../_shared/language-instruction.ts";
import { checkInputLimits } from "../_shared/input-limits.ts";
import { classifyQuestion, selectDraftable, type AppQuestion } from "../_shared/application-questions.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Per-IP throttle: this is an LLM endpoint and must not be loopable to burn
  // credits (mirrors the other public generators).
  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_function: "generate-application-answers", p_ip: clientIp, p_max_requests: 30, p_window_minutes: 60 });
  if (!allowed) return json({ error: "Rate limit exceeded. Try again shortly." }, 429);

  try {
    const body = await req.json();
    const { resumeText, jobTitle, jobCompany, jobDescription, questions, language } = body as {
      resumeText?: string; jobTitle?: string; jobCompany?: string; jobDescription?: string;
      questions?: AppQuestion[]; language?: string;
    };

    const limitError = checkInputLimits({ resumeText, jobDescription });
    if (limitError) return json({ error: limitError }, 400);
    if (!resumeText || resumeText.trim().length < 50) return json({ error: "Resume text is required." }, 400);
    if (!Array.isArray(questions) || questions.length === 0) return json({ error: "No questions provided." }, 400);

    // Only substantive free-text questions get a grounded draft. Everything else is
    // returned to the candidate to complete (never auto-answered).
    const draftable = selectDraftable(questions).slice(0, 25);
    const skipped = questions
      .map((q) => ({ question: q.label, class: classifyQuestion(q.label ?? "", q.type) }))
      .filter((q) => q.class !== "draftable");

    if (draftable.length === 0) {
      return json({ answers: [], skipped, note: "No auto-draftable questions — the rest are yours to complete." });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "AI is not configured." }, 500);

    const langInstruction = buildLanguageInstruction(language);
    const systemPrompt = `You draft answers to job-application screening questions for a candidate.

ABSOLUTE RULES — grounding is everything:
- Use ONLY facts present in the candidate's RESUME (and, for context, the JOB DESCRIPTION). Never invent, exaggerate, assume, or round up experience, metrics, employers, titles, tools, dates, or outcomes that are not in the resume.
- If the resume genuinely supports an answer, write a concise, specific, first-person reply that cites the candidate's REAL roles, achievements, and skills (paraphrase actual resume content). Set "supported": true.
- If the resume does NOT contain enough to answer truthfully (e.g. the question asks about experience the resume does not show), DO NOT fabricate. Set "supported": false, put a short honest scaffold in "answer" that the candidate can complete, and in "note" say exactly what the candidate must add. It is far better to flag a gap than to invent a claim they cannot defend in an interview.
- Keep answers tight and professional: 2–5 sentences unless the question implies otherwise. No clichés, no fluff, no fabricated numbers.
${langInstruction}

Return STRICT JSON only:
{ "answers": [ { "question": "<verbatim question>", "answer": "<draft>", "supported": true|false, "note": "<empty if supported, else what the candidate must add>" } ] }`;

    const userPrompt = `JOB: ${jobTitle ?? "(unknown role)"}${jobCompany ? ` at ${jobCompany}` : ""}

JOB DESCRIPTION:
${(jobDescription ?? "").slice(0, 6000) || "(not provided)"}

CANDIDATE RESUME:
${resumeText.slice(0, 12000)}

QUESTIONS TO ANSWER (draft each, grounded strictly in the resume):
${draftable.map((q, i) => `${i + 1}. ${q.label}`).join("\n")}`;

    const { response } = await callAIWithModelFallback(apiKey, {
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.3,
      maxTokens: 3500,
      jsonResponse: true,
      models: chainFrom("google/gemini-2.5-flash"),
      context: "APPLICATION-ANSWERS",
    });

    if (!response.ok) {
      if (response.status === 429) return json({ error: "Busy — try again shortly." }, 429);
      if (response.status === 402) return json({ error: "AI credits exhausted." }, 402);
      return json({ error: "Couldn't draft answers right now." }, 502);
    }

    const result = await response.json();
    const content: string = result?.choices?.[0]?.message?.content ?? "";
    let parsed: { answers?: Array<{ question?: string; answer?: string; supported?: boolean; note?: string }> } = {};
    try { parsed = JSON.parse(content); }
    catch { try { parsed = JSON.parse(content.match(/\{[\s\S]*\}/)?.[0] ?? "{}"); } catch { parsed = {}; } }

    const draftLabels = new Set(draftable.map((q) => (q.label ?? "").trim()));
    const answers = (parsed.answers ?? [])
      .filter((a) => typeof a?.answer === "string" && a.answer.trim())
      .map((a) => ({
        question: String(a.question ?? "").trim(),
        answer: String(a.answer).trim(),
        supported: a.supported !== false, // default to true only if the model said so
        note: a.supported === false ? String(a.note ?? "Add specifics from your own experience.").trim() : "",
      }))
      // Guard against the model answering something we didn't ask (or a filtered question).
      .filter((a) => a.question && draftLabels.has(a.question));

    console.log(`[APPLICATION-ANSWERS] drafted ${answers.length}/${draftable.length}; ${answers.filter((a) => !a.supported).length} flagged as gaps; ${skipped.length} left for the candidate`);
    return json({ answers, skipped });
  } catch (e) {
    console.error("[APPLICATION-ANSWERS] error:", e);
    return json({ error: "Something went wrong drafting answers." }, 500);
  }
});
