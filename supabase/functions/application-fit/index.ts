// Per-application job-posting fit: which recognized keywords from a posting
// appear in the resume version that was sent. Fully deterministic — the
// "dictionary" is the scanner's own detection tables, so a term only counts
// when it's both (a) in the posting and (b) a term the engine actually knows.
// No AI call, so it's fast, free, and always explainable.

import { INDUSTRY_KEYWORDS } from "../free-keyword-scan/industry-detection.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Flatten the detection tables once per isolate: every keyword, cert, and
// title the engine recognizes, lowercase, 3+ chars (short tokens like "or"
// false-positive too easily; real short terms like SQL/AWS survive as-is).
const DICTIONARY: string[] = (() => {
  const set = new Set<string>();
  for (const data of Object.values(INDUSTRY_KEYWORDS)) {
    for (const list of [data.primary, data.secondary, data.certifications, data.titles]) {
      for (const term of list) {
        const t = term.toLowerCase().trim();
        if (t.length >= 3) set.add(t);
      }
    }
  }
  // Longest first so "project management" wins before "project"
  return [...set].sort((a, b) => b.length - a.length);
})();

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const containsTerm = (haystack: string, term: string) =>
  new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i").test(haystack);

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

    const postingLower = jobPosting.toLowerCase();
    const resumeLower = resumeText.toLowerCase();

    // Terms the posting asks for (that the engine recognizes), longest-first;
    // once a longer phrase matches, its sub-terms are skipped to avoid
    // double-counting ("project management" also containing "management").
    const postingTerms: string[] = [];
    for (const term of DICTIONARY) {
      if (postingTerms.length >= 60) break;
      if (postingTerms.some((p) => p.includes(term))) continue;
      if (containsTerm(postingLower, term)) postingTerms.push(term);
    }

    const matched = postingTerms.filter((t) => containsTerm(resumeLower, t));
    const missing = postingTerms.filter((t) => !containsTerm(resumeLower, t));
    const pct = postingTerms.length === 0 ? null : Math.round((matched.length / postingTerms.length) * 100);

    return new Response(JSON.stringify({
      success: true,
      data: {
        pct,
        matched,
        missing,
        totalRecognized: postingTerms.length,
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
