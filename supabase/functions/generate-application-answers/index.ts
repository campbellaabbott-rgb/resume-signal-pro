// deploy-stamp: 2026-07-24.2 — bump on ANY change to ../_shared/* that this
// function imports. The deploy only ships functions whose own directory
// changed, so a shared-module-only commit leaves this function running a stale
// bundled copy (confirmed twice on 2026-07-24 with the question classifier).
// Apply-agent brain: draft answers to a job application's screening questions,
// grounded STRICTLY in the candidate's resume. This is the moat vs. every blind
// mass-apply bot — it refuses to invent, exaggerate, or assume anything the resume
// doesn't support, so a candidate is never trapped defending a fabricated claim in
// a live interview.
//
// Two modes:
//   (1) REAL questions passed in (Greenhouse ?questions=true) — draft the
//       substantive ones; identity/uploads/demographics/work-auth/salary are
//       filtered out by the shared classifier and returned as "for you to complete".
//   (2) No structured questions — infer 3–6 LIKELY questions from the job
//       description (+ near-universal ones), clearly flagged as anticipated, for
//       every non-Greenhouse posting where the real form isn't exposed.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { callAIWithModelFallback, chainFrom } from "../_shared/ai-fallback.ts";
import { buildLanguageInstruction } from "../_shared/language-instruction.ts";
import { checkInputLimits } from "../_shared/input-limits.ts";
import { classifyQuestion, selectDraftable, roleGuidance, type AppQuestion } from "../_shared/application-questions.ts";
import { coverNotePrompt, validateCoverNote, COVER_NOTE_VERSION } from "../_shared/cover-note.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: allowed } = await supabase.rpc("check_rate_limit", { p_function: "generate-application-answers", p_ip: clientIp, p_max_requests: 30, p_window_minutes: 60 });
  if (!allowed) return json({ error: "Rate limit exceeded. Try again shortly." }, 429);

  try {
    const body = await req.json();
    const { resumeText, jobTitle, jobCompany, jobDescription, questions, language, jobCategory, experienceBand,
      mode, baseNote, candidateName } = body as {
      resumeText?: string; jobTitle?: string; jobCompany?: string; jobDescription?: string;
      questions?: AppQuestion[]; language?: string; jobCategory?: string; experienceBand?: string;
      mode?: string; baseNote?: string; candidateName?: string;
    };

    const limitError = checkInputLimits({ resumeText, jobDescription });
    if (limitError) return json({ error: limitError }, 400);
    if (!resumeText || resumeText.trim().length < 50) return json({ error: "Resume text is required." }, 400);

    // ── cover-note mode ──────────────────────────────────────────────────────
    // A different job from drafting screening answers, and it lives here rather
    // than in its own function for one reason: THE GATE TRAVELS WITH THE
    // GENERATOR. If validateCoverNote ran at the call site, a second caller
    // could invoke this and send an ungrounded note to an employer without ever
    // touching the check. Returning an already-validated note (or null) makes
    // that impossible by construction.
    if (mode === "cover-note") {
      const apiKeyCN = Deno.env.get("LOVABLE_API_KEY");
      if (!apiKeyCN) return json({ error: "AI is not configured." }, 500);

      const gateCtx = {
        resumeText, jobDescription, jobTitle, company: jobCompany,
        candidateName, baseNote: baseNote ?? "",
      };
      const { system, user } = coverNotePrompt({
        jobTitle: jobTitle ?? "", company: jobCompany ?? "",
        jobDescription, baseNote: baseNote ?? "", resumeText,
      });

      const messages: Array<{ role: string; content: string }> = [
        { role: "system", content: `${system}\n${buildLanguageInstruction(language)}` },
        { role: "user", content: user },
      ];

      // Two attempts at most. The repair round hands the model its OWN failures
      // rather than re-rolling blind — most rejections are one invented name or
      // one stray placeholder, which is a correctable mistake, not a hopeless
      // draft. Bounded at two because this runs per posting inside a batch that
      // already has a wall-clock budget.
      let lastIssues: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        const { response } = await callAIWithModelFallback(apiKeyCN, {
          messages, temperature: 0.4, maxTokens: 900,
          models: chainFrom("google/gemini-2.5-flash"),
          context: "COVER-NOTE",
        });
        if (!response.ok) {
          if (response.status === 429) return json({ error: "Busy — try again shortly." }, 429);
          if (response.status === 402) return json({ error: "AI credits exhausted." }, 402);
          return json({ error: "Couldn't draft a cover note right now." }, 502);
        }
        const r = await response.json();
        const draft = String(r?.choices?.[0]?.message?.content ?? "")
          .replace(/^```[a-z]*\n?|```$/g, "").trim();

        const verdict = validateCoverNote({ ...gateCtx, note: draft });
        if (verdict.ok) {
          console.log(`[COVER-NOTE] accepted on attempt ${attempt + 1}; ${verdict.note.length} chars`);
          return json({ note: verdict.note, issues: [], version: COVER_NOTE_VERSION });
        }
        lastIssues = verdict.issues;
        console.log(`[COVER-NOTE] attempt ${attempt + 1} rejected: ${verdict.issues.join(" | ")}`);
        messages.push({ role: "assistant", content: draft });
        messages.push({
          role: "user",
          content: `That draft was REJECTED for these reasons:\n${verdict.issues.map((i) => `- ${i}`).join("\n")}\n\nRewrite it so none of them apply. Remove any name, figure or claim you cannot ground in the RESUME, the candidate's OWN NOTE, or the JOB POSTING. Return ONLY the corrected note.`,
        });
      }

      // Null, not a degraded note. The caller sends the candidate's own words
      // instead — a generic note is a fine outcome; a false one is not.
      return json({ note: null, issues: lastIssues, version: COVER_NOTE_VERSION });
    }

    const hasExplicit = Array.isArray(questions) && questions.length > 0;
    const draftable = hasExplicit ? selectDraftable(questions).slice(0, 25) : [];
    const skipped = hasExplicit
      ? questions.map((q) => ({ question: q.label, class: classifyQuestion(q.label ?? "", q.type) })).filter((q) => q.class !== "draftable")
      : [];
    const inferred = !hasExplicit;

    if (inferred && (!jobDescription || jobDescription.trim().length < 80)) {
      return json({ error: "Provide the application's questions, or a fuller job description to infer likely ones." }, 400);
    }
    if (hasExplicit && draftable.length === 0) {
      return json({ answers: [], skipped, note: "No auto-draftable questions — the rest are yours to complete." });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return json({ error: "AI is not configured." }, 500);

    const langInstruction = buildLanguageInstruction(language);
    const groundingRules = `ABSOLUTE RULES — grounding is everything:
- Use ONLY facts present in the candidate's RESUME (and, for context, the JOB DESCRIPTION). Never invent, exaggerate, assume, or round up experience, metrics, employers, titles, tools, dates, or outcomes that are not in the resume.
- If the resume genuinely supports an answer, write a concise, specific, first-person reply that cites the candidate's REAL roles, achievements, and skills (paraphrase actual resume content). Set "supported": true.
- If the resume does NOT contain enough to answer truthfully, DO NOT fabricate. Set "supported": false, put a short honest scaffold in "answer" the candidate can complete, and in "note" say exactly what they must add. Flagging a gap always beats inventing a claim they cannot defend in an interview.
- GAP RULE: if the truthful answer is that the candidate LACKS the experience, skill, tool, certification, or qualification the question asks about (i.e. the honest reply is essentially "no" / "I don't have that"), treat it as a gap: keep the answer honest and never fabricated, but set "supported": false and in "note" tell the candidate how to strengthen it — the closest transferable experience from their resume to lean on, or that they should add it if they in fact have it. Never mark a missing qualification "supported": true.
- Keep answers tight and professional: 2–5 sentences unless the question implies otherwise. No clichés, no fluff, no fabricated numbers.
${roleGuidance(jobCategory, experienceBand)}
${langInstruction}`;

    const systemPrompt = inferred
      ? `You prepare a candidate for a job application whose exact questions are not available.

First, infer 3 to 6 screening questions this employer is LIKELY to ask for THIS role — drawn from the JOB DESCRIPTION (e.g. a stated travel/clearance/tooling requirement) plus near-universal ones ("Why do you want to work here?", "Why are you a fit for this role?"). Do NOT invent oddly specific questions.
Then draft a grounded answer to each.

${groundingRules}

Return STRICT JSON only:
{ "answers": [ { "question": "<likely question>", "answer": "<draft>", "supported": true|false, "note": "<empty if supported, else what to add>", "anticipated": true } ] }`
      : `You draft answers to a job application's screening questions.

${groundingRules}

Return STRICT JSON only:
{ "answers": [ { "question": "<verbatim question>", "answer": "<draft>", "supported": true|false, "note": "<empty if supported, else what the candidate must add>" } ] }`;

    const userPrompt = `JOB: ${jobTitle ?? "(unknown role)"}${jobCompany ? ` at ${jobCompany}` : ""}

JOB DESCRIPTION:
${(jobDescription ?? "").slice(0, 6000) || "(not provided)"}

CANDIDATE RESUME:
${resumeText.slice(0, 12000)}
${inferred ? "" : `\nQUESTIONS TO ANSWER (draft each, grounded strictly in the resume):\n${draftable.map((q, i) => `${i + 1}. ${q.label}`).join("\n")}`}`;

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
      .filter((a) => typeof a?.answer === "string" && a.answer.trim() && typeof a?.question === "string" && a.question.trim())
      .map((a) => ({
        question: String(a.question).trim(),
        answer: String(a.answer).trim(),
        supported: a.supported !== false,
        note: a.supported === false ? String(a.note ?? "Add specifics from your own experience.").trim() : "",
        anticipated: inferred,
      }))
      // In explicit mode, drop anything the model answered that we didn't ask
      // (or that we filtered as non-draftable). In inferred mode, keep its list.
      .filter((a) => inferred || draftLabels.has(a.question))
      .slice(0, 12);

    console.log(`[APPLICATION-ANSWERS] mode=${inferred ? "inferred" : "explicit"}; drafted ${answers.length}; ${answers.filter((a) => !a.supported).length} gaps; ${skipped.length} for candidate`);
    return json({ answers, skipped, inferred });
  } catch (e) {
    console.error("[APPLICATION-ANSWERS] error:", e);
    return json({ error: "Something went wrong drafting answers." }, 500);
  }
});
