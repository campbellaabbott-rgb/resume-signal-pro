// Per-application job-posting fit: which recognized keywords from a posting
// appear in the resume version that was sent. Fully deterministic — the
// "dictionary" is the scanner's own detection tables, so a term only counts
// when it's both (a) in the posting and (b) a term the engine actually knows.
// No AI call, so it's fast, free, and always explainable.

import { computeFit } from "../_shared/fit-score.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const jobPosting = typeof body.jobPosting === "string" ? body.jobPosting.slice(0, 20000) : "";
    const resumeText = typeof body.resumeText === "string" ? body.resumeText.slice(0, 50000) : "";
    if (jobPosting.trim().length < 100 || resumeText.trim().length < 100) {
      return new Response(JSON.stringify({ error: "jobPosting and resumeText (each 100+ chars) are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Cheap but real rate limit — deterministic compute, still not a free-for-all.
    const clientIp = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: allowed } = await supabase.rpc("check_rate_limit", {
      p_function: "application-fit", p_ip: clientIp, p_max_requests: 60, p_window_minutes: 1440,
    });
    if (allowed === false) {
      return new Response(JSON.stringify({ error: "Daily fit-check limit reached.", rateLimited: true }), {
        status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { pct, matched, missing, totalRecognized } = computeFit(jobPosting, resumeText);

    return new Response(JSON.stringify({
      success: true,
      data: {
        pct,
        matched,
        missing,
        totalRecognized,
        method: "Deterministic: terms from the posting that our detection engine recognizes, checked verbatim against the resume version. No AI, fully reproducible.",
      },
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("[APPLICATION-FIT] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
