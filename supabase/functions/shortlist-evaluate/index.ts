// deploy-stamp: 2026-10-09T09:00Z
// Shortlist evaluation: redact → score → persist the audit row.
//
// Compliance-critical properties (see COMPLIANCE.md):
// - JWT-verified (Supabase default): only authenticated employers can evaluate.
// - Proxy variables are stripped BEFORE the model sees any text; the list of
//   exclusions that fired is stored with the evaluation.
// - The model RECOMMENDS only: it returns a score, flags, signals and
//   questions. It cannot advance or reject anyone — those are human actions
//   recorded in shortlist_decisions by the app.
// - Every evaluation stores model/prompt version for reproducibility.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { redactForScoring, type RedactionConfig } from "../_shared/redaction.ts";
import { modelSpendGate } from "../_shared/model-spend-gate.ts";

// Provable from outside without a model call: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "shortlist-evaluate.2026-10-10.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};

const PROMPT_VERSION = "shortlist-v1";
const MODEL_ID = "google/gemini-2.5-flash";

// Any signed-in account can own a role, and signing up is free, so a sign-in
// is not a spending limit: an address allowance sized for an employer
// screening a batch, plus a function-wide ceiling (_shared/model-spend-gate.ts).
const SHORTLIST_LIMITS = { perAddress: 60, globalPerHour: 300 };
// The evaluation tool call is ~800 tokens; the rest is headroom for the
// model's thinking, which counts against the same cap.
const MAX_OUTPUT_TOKENS = 4000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // ── AuthN: resolve the employer from their JWT ──────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userErr } = await anonClient.auth.getUser();
    if (userErr || !user?.id) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const roleId: string | null = typeof body.roleId === "string" ? body.roleId : null;
    const resumeText: string = typeof body.resumeText === "string" ? body.resumeText.slice(0, 40000) : "";
    const fileName: string | null = typeof body.fileName === "string" ? body.fileName.slice(0, 200) : null;
    const jurisdiction: string = ["NYC", "IL", "CA", "EU", "OTHER"].includes(body.jurisdiction) ? body.jurisdiction : "OTHER";
    const redactionConfig: RedactionConfig = body.redactionConfig && typeof body.redactionConfig === "object" ? body.redactionConfig : {};
    const altReview = body.altReview === true;
    const json = (o: unknown, status = 200) =>
      new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (!roleId || (!altReview && resumeText.length < 100)) {
      return json({ error: "roleId and resumeText (100+ chars) required" }, 400);
    }

    // The role, read through the employer's own RLS: ownership, and the JD.
    // The JD scored is the role's stored text, never the body's: the audit row
    // records which version it was and the text itself (sweep S8-110).
    const { data: role } = await anonClient
      .from("shortlist_roles").select("id, jd_text, jd_version").eq("id", roleId).maybeSingle();
    if (!role) return json({ error: "Role not found" }, 404);
    const jdText = typeof role.jd_text === "string" ? role.jd_text.slice(0, 20000) : "";

    // Evaluations are written by the service role only (20261009111000); the
    // owner is the verified caller.
    const service = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    // Alternative review (ADA / accommodation) before any scoring: a record
    // with no score and its logged request, and no model call (sweep S8-111).
    if (altReview) {
      const { data: candidate, error } = await service.from("shortlist_candidates").insert({
        role_id: roleId, owner_id: user.id, file_name: fileName, jd_version: role.jd_version ?? 1, candidate_jurisdiction: jurisdiction,
      }).select().single();
      if (error || !candidate) return json({ error: "Could not record the alternative review" }, 500);
      const { error: logErr } = await service.from("shortlist_decisions").insert({
        candidate_id: candidate.id, owner_id: user.id, actor_email: user.email ?? null, action: "alt_review_requested",
        reason: "Routed to non-automated alternative review before any scoring (ADA / accommodation path)",
      });
      if (logErr) return json({ error: "Could not log the alternative review" }, 500);
      return json({ success: true, candidate, altReview: true });
    }
    if (jdText.length < 30) return json({ error: "The role's job description must be at least 30 characters" }, 400);

    // ── Proxy-variable exclusion BEFORE scoring ─────────────────────────────
    const { redacted, exclusionsApplied } = redactForScoring(resumeText, redactionConfig);

    // ── Score via the AI gateway ────────────────────────────────────────────
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "Scoring engine not configured" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // check_rate_limit is granted to the service role only, so the count runs
    // on the service client; the employer's reads stay on their RLS client.
    const refused = await modelSpendGate(service, req, "shortlist-evaluate", SHORTLIST_LIMITS, corsHeaders);
    if (refused) return refused;

    const systemPrompt = `You are an employment screening assistant that evaluates how well a REDACTED resume matches a job description. You assist a HUMAN reviewer — you never decide.

STRICT RULES:
- Evaluate ONLY job-related qualifications: skills, experience relevance, quantified outcomes, seniority fit, required certifications.
- The resume has protected-class proxies redacted ([REDACTED-*] and [CANDIDATE] markers). NEVER treat redaction markers as negative signals — they are neutral.
- NEVER consider or infer: age, sex/gender, race, ethnicity, national origin, religion, disability, family status, or any [REDACTED-*] content. Employment gaps and [REDACTED-ADA] content must not lower any score.
- Every signal you report must cite job-related evidence from the resume text.
- Flags must be job-related only (e.g. "JD requires PMP; not present") — never protected-class adjacent.

Return via the submit_evaluation tool.`;

    const userPrompt = `<job_description>\n${jdText}\n</job_description>\n\n<redacted_resume>\n${redacted}\n</redacted_resume>`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL_ID,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        tools: [{
          type: "function",
          function: {
            name: "submit_evaluation",
            description: "Submit the screening evaluation",
            parameters: {
              type: "object",
              properties: {
                matchScore: { type: "number", description: "0-100 job-related match score" },
                levelRead: { type: "string", description: "Seniority the resume reads as, in plain words" },
                signals: {
                  type: "array",
                  description: "3-6 job-related factors that drove the score, each citing resume evidence",
                  items: {
                    type: "object",
                    properties: {
                      factor: { type: "string" },
                      direction: { type: "string", description: "positive | negative | neutral" },
                      evidence: { type: "string", description: "Quoted or paraphrased from the resume" },
                    },
                    required: ["factor", "direction", "evidence"],
                  },
                },
                flags: {
                  type: "array",
                  description: "Job-related gaps vs the JD (missing required skills/certs). NEVER protected-class adjacent.",
                  items: { type: "string" },
                },
                interviewQuestions: {
                  type: "array",
                  description: "3 questions a human interviewer should ask to verify or probe, derived from this resume vs this JD",
                  items: { type: "string" },
                },
                parsedFields: {
                  type: "object",
                  description: "Structured job-related fields only",
                  properties: {
                    yearsRelevantExperience: { type: "string" },
                    topSkills: { type: "array", items: { type: "string" } },
                    certifications: { type: "array", items: { type: "string" } },
                  },
                },
              },
              required: ["matchScore", "levelRead", "signals", "flags", "interviewQuestions"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "submit_evaluation" } },
      }),
    });

    if (!aiRes.ok) {
      console.error("[SHORTLIST-EVALUATE] gateway error:", aiRes.status);
      return new Response(JSON.stringify({ error: "Scoring temporarily unavailable — try again shortly" }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const aiJson = await aiRes.json();
    let evaluation: Record<string, unknown> | null = null;
    try {
      evaluation = JSON.parse(aiJson.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments ?? "null");
    } catch { /* handled below */ }
    if (!evaluation || typeof evaluation.matchScore !== "number") {
      return new Response(JSON.stringify({ error: "Evaluation failed — no valid output" }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const score = Math.max(0, Math.min(100, Math.round(evaluation.matchScore as number)));

    // ── Persist the audit row (service role; the owner is the verified caller)
    const { data: candidate, error: insertErr } = await service
      .from("shortlist_candidates")
      .insert({
        role_id: roleId,
        owner_id: user.id,
        file_name: fileName,
        redacted_text: redacted,
        exclusions_applied: exclusionsApplied,
        parsed_fields: evaluation.parsedFields ?? null,
        score,
        flags: evaluation.flags ?? [],
        signals: evaluation.signals ?? [],
        interview_questions: evaluation.interviewQuestions ?? [],
        level_read: typeof evaluation.levelRead === "string" ? evaluation.levelRead.slice(0, 200) : null,
        model_version: `${MODEL_ID}/${PROMPT_VERSION}`,
        jd_version: role.jd_version ?? 1,
        jd_text_scored: jdText,
        candidate_jurisdiction: jurisdiction,
      })
      .select()
      .single();

    if (insertErr) {
      console.error("[SHORTLIST-EVALUATE] insert failed:", insertErr);
      return new Response(JSON.stringify({ error: "Evaluation stored failed" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, candidate }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[SHORTLIST-EVALUATE] Uncaught:", e);
    return new Response(JSON.stringify({ error: "Unexpected error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
