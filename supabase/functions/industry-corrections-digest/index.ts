// deploy-stamp: 2026-07-04T18:44Z
// Weekly digest of industry-detection corrections. Fired by pg_cron
// (Mondays 09:15 UTC). Aggregates detected→corrected pairs from the last 7
// days and emails the owner — recurring pairs are candidates for new
// disambiguation rules and golden-test fixtures.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const OWNER_EMAIL = Deno.env.get("OWNER_NOTIFY_EMAIL") ?? "resumeboostersupp@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { auth: { persistSession: false } },
    );

    // Param name must match the CURRENT function signature (p_days). The
    // 2026-07-07 digest went out as "NaN corrections / undefined→undefined"
    // because this call used p_days_back and matched a stale function
    // returning different column names — CREATE OR REPLACE can't rename a
    // parameter, so the old signature had survived every "fix" migration.
    // Migration 20260708090000 drops-and-recreates; the mapping below is
    // additionally defensive against BOTH known column sets so a stale DB
    // can never produce a garbage email again.
    const { data: stats, error } = await supabase.rpc("get_industry_correction_stats", { p_days: 7 });
    if (error) throw error;

    type StatRow = {
      detected?: string; corrected?: string; corrections?: number | string;
      original_industry?: string; corrected_industry?: string; correction_count?: number | string;
    };
    const normalized = ((stats ?? []) as StatRow[])
      .map((r) => ({
        detected: r.detected ?? r.original_industry ?? "unknown",
        corrected: r.corrected ?? r.corrected_industry ?? "unknown",
        corrections: Number(r.corrections ?? r.correction_count ?? 0),
      }))
      .filter((r) => Number.isFinite(r.corrections) && r.corrections > 0);

    if (normalized.length === 0) {
      console.log("[CORRECTIONS-DIGEST] No corrections this week — skipping email");
      return new Response(JSON.stringify({ sent: false, reason: "no_corrections" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const total = normalized.reduce((s, r) => s + r.corrections, 0);
    const rows = normalized
      .map((r) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${r.detected}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">→ ${r.corrected}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right"><b>${r.corrections}×</b></td></tr>`)
      .join("");

    const resend = new Resend(RESEND_API_KEY);
    await resend.emails.send({
      from: "Resume Booster <reports@resumebooster.work>",
      to: [OWNER_EMAIL],
      subject: `Industry detection: ${total} correction${total === 1 ? "" : "s"} this week`,
      html: `
        <div style="font-family:sans-serif;max-width:560px">
          <h2>Weekly industry-correction digest</h2>
          <p>Users overrode the detected industry <b>${total}</b> time${total === 1 ? "" : "s"} in the last 7 days. Pairs appearing repeatedly are detection blind spots — each is a candidate for a new disambiguation rule and a golden-test fixture.</p>
          <table style="border-collapse:collapse;width:100%">
            <tr><th style="text-align:left;padding:6px 12px">Detected</th><th style="text-align:left;padding:6px 12px">Corrected to</th><th style="text-align:right;padding:6px 12px">Count</th></tr>
            ${rows}
          </table>
        </div>`,
    });

    console.log(`[CORRECTIONS-DIGEST] Sent digest: ${total} corrections across ${normalized.length} pairs`);
    return new Response(JSON.stringify({ sent: true, total, pairs: normalized.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("[CORRECTIONS-DIGEST] Error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
