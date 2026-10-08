// deploy-stamp: 2026-10-08T12:00Z
// Weekly digest of industry-detection corrections. Fired by pg_cron
// (Mondays 09:15 UTC, x-email-cron from the vault -- 20261008125000).
// Aggregates detected→corrected pairs from the last 7 days and emails the
// owner — recurring pairs are candidates for new disambiguation rules and
// golden-test fixtures.
//
// THE LABELS ARE A STRANGER'S TEXT (register L10-18). log_industry_correction
// is callable with the publishable key, so both labels are whatever anyone
// typed (<= 50 characters, lower-cased and trimmed): '<a href=//x.tld>re-
// verify</a>' rendered as a live link in a mail from our own domain to the
// owner. Only pairs whose BOTH labels are industries the detector or the
// correction menu knows are printed, escaped anyway, and the number dropped is
// said out loud. And the run answers only the scheduler or our service role:
// it used to answer any POST, so anyone could trigger the owner's mail.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { INDUSTRY_KEYWORDS } from "../_shared/industry-detection.ts";
import { CORRECTION_MENU_INDUSTRIES } from "../_shared/correction-menu-industries.ts";
import { isScheduledCaller } from "../_shared/email-cron.ts";

const FN_BUILD = "industry-corrections-digest.2026-10-08.1";
const OWNER_EMAIL = Deno.env.get("OWNER_NOTIFY_EMAIL") ?? "resumeboostersupp@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};

/**
 * The labels a pair may carry: what the scan detected (the detector's
 * industries) and what the correction menu can send (its own list, mirrored
 * in _shared/correction-menu-industries.ts). Anything else was typed by
 * someone calling the RPC directly.
 */
export const KNOWN_INDUSTRIES: ReadonlySet<string> = new Set([
  ...Object.keys(INDUSTRY_KEYWORDS),
  ...CORRECTION_MENU_INDUSTRIES,
]);

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey, { auth: { persistSession: false } });
    if (!(await isScheduledCaller(req.headers, supabase, serviceKey))) {
      return json({ error: "The digest is for the scheduler only." }, 401);
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[CORRECTIONS-DIGEST] RESEND_API_KEY not configured; nothing sent");
      return json({ error: "RESEND_API_KEY not configured" }, 503);
    }

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
    const counted = ((stats ?? []) as StatRow[])
      .map((r) => ({
        detected: String(r.detected ?? r.original_industry ?? "unknown"),
        corrected: String(r.corrected ?? r.corrected_industry ?? "unknown"),
        corrections: Number(r.corrections ?? r.correction_count ?? 0),
      }))
      .filter((r) => Number.isFinite(r.corrections) && r.corrections > 0);
    const normalized = counted.filter((r) => KNOWN_INDUSTRIES.has(r.detected) && KNOWN_INDUSTRIES.has(r.corrected));
    const dropped = counted.length - normalized.length;
    if (dropped > 0) console.warn(`[CORRECTIONS-DIGEST] dropped ${dropped} pair(s) naming an industry nobody can pick`);

    if (normalized.length === 0) {
      console.log("[CORRECTIONS-DIGEST] No corrections this week — skipping email");
      return json({ sent: false, reason: "no_corrections", dropped });
    }

    const total = normalized.reduce((s, r) => s + r.corrections, 0);
    const rows = normalized
      .map((r) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(r.detected)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">→ ${escapeHtml(r.corrected)}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right"><b>${r.corrections}×</b></td></tr>`)
      .join("");

    const resend = new Resend(RESEND_API_KEY);
    const { error: sendErr } = await resend.emails.send({
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
          ${dropped > 0 ? `<p style="font-size:12px;color:#64748b">${dropped} pair${dropped === 1 ? "" : "s"} naming a label outside the known industry list ${dropped === 1 ? "was" : "were"} left out.</p>` : ""}
        </div>`,
    });
    if (sendErr) {
      console.error("[CORRECTIONS-DIGEST] send refused:", (sendErr as { message?: string }).message ?? sendErr);
      return json({ error: "send failed" }, 502);
    }

    console.log(`[CORRECTIONS-DIGEST] Sent digest: ${total} corrections across ${normalized.length} pairs`);
    return json({ sent: true, total, pairs: normalized.length, dropped });
  } catch (error) {
    console.error("[CORRECTIONS-DIGEST] Error:", error);
    return json({ error: "digest run failed" }, 500);
  }
});
