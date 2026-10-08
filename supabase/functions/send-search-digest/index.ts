// deploy-stamp: 2026-10-04T22:00Z
// Feature 4 — weekly saved-search digest. Each opted-in saved search gets an
// email counting how many NEW postings match it since the search's last
// digest, with the freshest handful listed and a link back to the live board.
// Opt-in only (user_job_searches.digest_opt_in); HMAC unsubscribe like the
// market pulse. Trigger on a schedule: POST /send-search-digest {"action":"send"}.
//
// THE BATCH ANSWERS THE SCHEDULER AND OUR SERVICE ROLE, NOBODY ELSE
// (2026-10-04). It answered any POST, selected the due searches, and stamped
// each one only after its awaited send, so N concurrent posts mailed every
// opted-in user N times (and ran N board searches per saved search). The cron
// now sends x-email-cron (_shared/email-cron.ts), and the searches are CLAIMED
// by search_digest_claim_batch, which stamps them in the statement that
// chooses them (FOR UPDATE SKIP LOCKED): a second run in flight gets a
// disjoint set or nothing. A search that is skipped for a passing reason (no
// address, a transient empty list, a failed send) gives its claim back, so it
// is retried next run exactly as before.
import { Resend } from "https://esm.sh/resend@2.0.0";
import { computeFit } from "../_shared/fit-score.ts";
// A saved search replayed on a cadence is OUR call on a REAL user's query —
// neither candidate demand nor monitoring, so it gets its own caller value
// rather than being flattened into either. See _shared/search-caller.ts.
import { searchCallerHeader } from "../_shared/search-caller.ts";
// The board counts anonymous reads per address; this proves the digest's
// read is ours, not a browser's, and grants nothing else.
import { boardReaderHeader } from "../_shared/board-reader-key.ts";
import { isScheduledCaller } from "../_shared/email-cron.ts";
import { sameSecret } from "../_shared/service-caller.ts";
import { oneClickHeaders, oneClickUrl, redirectToConfirm, unsubscribeParams, unsubscribePageUrl } from "../_shared/unsubscribe-link.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Provable from outside without sending anything: every response, the CORS
// preflight included, carries this in x-fn-build.
const FN_BUILD = "send-search-digest.2026-10-08.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "x-fn-build": FN_BUILD,
};
const SITE_URL = "https://resumebooster.work";
// Per-search cadence floors. The old single 6-day gate meant "watch this
// company" and threshold alerts couldn't email faster than weekly on a board
// that re-verifies feeds every 10-15 minutes. daily = a 20-hour floor (one
// email a day, drift-proof against cron jitter); weekly keeps the old rhythm.
// These floors live in search_digest_claim_batch (20261004100000), where the
// claim is atomic: daily = 20 hours, anything else = 6 days.
const CLAIM_BATCH = 400;
/** Rows read per search: the window's newest, deduped against what was already mailed. */
const CANDIDATES = 60;

/**
 * The board's answer for THIS window, or null. The digest asks for newSince
 * (posted_at OR first_seen after the last send, register L10-02) and the board
 * echoes the window it applied; an answer without the echo came from a bundle
 * that ignored the key, and would mail an unwindowed search as "new".
 */
function windowAnswer(j: unknown, since: string): unknown {
  if (!j || typeof j !== "object") return null;
  const echoed = (j as { newSince?: unknown }).newSince;
  if (typeof echoed !== "string" || Date.parse(echoed) !== Date.parse(since)) return null;
  return j;
}

function escapeHtml(text: string | number | undefined | null): string {
  if (text === undefined || text === null) return "";
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function hmacToken(id: string): Promise<string> {
  const secret = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "digest-secret";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id.toLowerCase()));
  return Array.from(new Uint8Array(sig)).slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Every field the board can filter on must be represented here: the digest
// promises "matches for THIS search", so any param the query carries but the
// digest drops widens the email past what the user saw. country, workMode and
// the freshness window were missing — a US-only alert mailed worldwide roles
// (bug sweep 2026-07-26).
type SearchParams = {
  q?: string; category?: string; includeUncategorised?: boolean; location?: string;
  remote?: boolean; workMode?: string; company?: string; experience?: string;
  country?: string; salaryFloor?: number; maxAgeDays?: number; sendableOnly?: boolean;
  salaryCeiling?: number; payBasis?: string; hasStatedPay?: boolean;
  includeUnstatedPay?: boolean; maxYears?: number; department?: string; vendor?: string;
  employmentType?: string; excludeAgencies?: boolean;
};

function boardUrl(p: SearchParams): string {
  const qs = new URLSearchParams();
  if (p.q) qs.set("q", p.q);
  if (p.location) qs.set("location", p.location);
  if (p.remote) qs.set("remote", "1");
  if (p.workMode) qs.set("mode", p.workMode);
  if (p.company) qs.set("company", p.company);
  if (p.category) qs.set("category", p.category);
  if (p.experience) qs.set("experience", p.experience);
  if (p.country) qs.set("country", p.country);
  if (p.salaryFloor) qs.set("salaryFloor", String(p.salaryFloor));
  // Board URL spellings, verbatim from Jobs.tsx's initial.get sync — statedPay
  // and inclUnstatedPay are flags ("1"), fresh is the freshness window's name.
  if (p.category && p.includeUncategorised) qs.set("inclUncat", "1");
  if (p.sendableOnly) qs.set("agentOnly", "1");
  if (p.maxAgeDays) qs.set("fresh", String(p.maxAgeDays));
  if (p.salaryCeiling) qs.set("salaryCeiling", String(p.salaryCeiling));
  if (p.payBasis) qs.set("payBasis", p.payBasis);
  if (p.hasStatedPay) qs.set("statedPay", "1");
  if (p.includeUnstatedPay) qs.set("inclUnstatedPay", "1");
  if (p.maxYears) qs.set("maxYears", String(p.maxYears));
  if (p.department) qs.set("department", p.department);
  if (p.vendor) qs.set("vendor", p.vendor);
  if (p.employmentType) qs.set("etype", p.employmentType);
  if (p.excludeAgencies) qs.set("noAgencies", "1");
  const s = qs.toString();
  return `${SITE_URL}/jobs${s ? `?${s}` : ""}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  // ── Unsubscribe — turns digest_opt_in off (_shared/unsubscribe-link.ts) ──
  // A GET (the link in every digest already sent, and every mail scanner that
  // follows it) changes nothing and opens the confirm page; only a POST -- the
  // page's button, or the mail client's RFC 8058 one-click -- unsubscribes.
  const url = new URL(req.url);
  if (req.method === "GET" && url.searchParams.get("action") === "unsubscribe") {
    return redirectToConfirm("search-digest", { id: url.searchParams.get("id") ?? "", token: url.searchParams.get("token") ?? "" });
  }
  if (req.method === "POST") {
    const un = await unsubscribeParams(req, url);
    if (un) {
      const id = un.id ?? "";
      const token = un.token ?? "";
      if (!/^[0-9a-f-]{36}$/i.test(id) || !sameSecret(token, await hmacToken(id))) {
        return new Response(JSON.stringify({ error: "invalid unsubscribe link" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const { error: unErr } = await supabase.from("user_job_searches").update({ digest_opt_in: false }).eq("id", id);
      if (unErr) {
        console.error("[SEARCH-DIGEST] unsubscribe failed:", unErr.message);
        return new Response(JSON.stringify({ error: "could not unsubscribe right now" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ unsubscribed: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
  }

  try {
    const body = await req.json().catch(() => ({}));
    if (body.action !== "send") {
      return new Response(JSON.stringify({ error: "POST { action: 'send' }" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!(await isScheduledCaller(req.headers, supabase, serviceKey))) {
      return new Response(JSON.stringify({ error: "The batch send is for the scheduler only." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const resend = new Resend(RESEND_API_KEY);
    const boardBase = `${Deno.env.get("SUPABASE_URL")}/functions/v1/job-board`;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const readerProof = await boardReaderHeader(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    // THE CLAIM IS THE SELECTION. Each row comes back already stamped (its
    // own cadence decided in SQL), with the stamp it had before, which is the
    // "new since" window and what a give-back restores.
    const { data: claimed, error } = await supabase.rpc("search_digest_claim_batch", { p_limit: CLAIM_BATCH });
    if (error) throw error;
    const searches = ((claimed ?? []) as Array<{
      sd_id: string; sd_user_id: string; sd_name: string; sd_params: unknown;
      sd_prev_sent_at: string | null; sd_fit_threshold: number | null; sd_cadence: string | null;
    }>).map((r) => ({
      id: r.sd_id, user_id: r.sd_user_id, name: r.sd_name, params: r.sd_params,
      digest_last_sent_at: r.sd_prev_sent_at, fit_threshold: r.sd_fit_threshold, digest_cadence: r.sd_cadence,
    }));
    /** Hand a claim back: the search is due again next run, as if never claimed. */
    const giveBack = (s: { id: string; digest_last_sent_at: string | null }) =>
      supabase.from("user_job_searches").update({ digest_last_sent_at: s.digest_last_sent_at }).eq("id", s.id);

    // Suppressed addresses (global unsubscribes) are honored too.
    const { data: suppressedRows } = await supabase.from("suppressed_emails").select("email");
    const suppressed = new Set((suppressedRows ?? []).map((r) => (r.email as string).toLowerCase()));

    let sent = 0, skipped = 0;
    for (const s of searches ?? []) {
      const p = (s.params ?? {}) as SearchParams;
      const since = (s.digest_last_sent_at as string | null) ?? new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

      // Resolve the recipient email (service-role admin lookup by user_id).
      const { data: userRes } = await supabase.auth.admin.getUserById(s.user_id as string);
      const email = userRes?.user?.email?.toLowerCase();
      if (!email || suppressed.has(email)) { await giveBack(s); skipped++; continue; }

      // Count NEW matches since last digest, and pull the freshest few.
      const callBoard = (extra: Record<string, unknown>) =>
        fetch(boardBase, {
          method: "POST",
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json", ...searchCallerHeader("digest"), ...readerProof },
          // EVERY field the board can filter on, or the digest mails a wider
          // search than the one saved. The seven that were hand-list-dropped
          // (ceiling, basis, stated-pay, unstated widening, years, department,
          // vendor) plus the two silent omissions (includeUncategorised,
          // sendableOnly) all ride now; the save-side toast stopped naming
          // them as left out in the same change.
          body: JSON.stringify({
            action: "list",
            q: p.q || undefined,
            category: p.category || undefined,
            includeUncategorised: p.includeUncategorised || undefined,
            location: p.location || undefined,
            remote: p.remote || undefined,
            workMode: p.workMode || undefined,
            companies: p.company ? [p.company] : undefined,
            experience: p.experience || undefined,
            country: p.country || undefined,
            salaryFloor: p.salaryFloor || undefined,
            maxAgeDays: p.maxAgeDays || undefined,
            sendableOnly: p.sendableOnly || undefined,
            salaryCeiling: p.salaryCeiling || undefined,
            payBasis: p.payBasis || undefined,
            hasStatedPay: p.hasStatedPay || undefined,
            includeUnstatedPay: p.includeUnstatedPay || undefined,
            maxYears: p.maxYears || undefined,
            department: p.department || undefined,
            vendor: p.vendor || undefined,
            employmentType: p.employmentType || undefined,
            // The agency opt-out rides the digest the day it is savable, or
            // the alert mails postings the saved screen hid.
            excludeAgencies: p.excludeAgencies || undefined,
            includeFacets: false,
            ...extra,
          }),
        }).then((r) => (r.ok ? r.json() : null)).then((j) => windowAnswer(j, since)).catch(() => null);

      // AN ANSWER THAT IS NOT A NUMBER IS NOT ZERO (register L10-03). A failed
      // or timed-out board call, a {total:null, countUnavailable:true} answer,
      // or an answer from a bundle that did not apply the window all used to
      // read as "nothing new", and the claim's advanced stamp then deleted that
      // window's matches for good. Each now gives the claim back.
      const countRes = await callBoard({ countOnly: true, newSince: since });
      const rawNew = (countRes as { total?: unknown } | null)?.total;
      if (typeof rawNew !== "number" || !Number.isFinite(rawNew)) {
        console.error(`[SEARCH-DIGEST] board count unavailable for search ${s.id}; claim given back`);
        await giveBack(s); skipped++; continue;
      }
      // The board caps counting for speed (count_jobs_capped, 2026-07-25), so a
      // broad saved search comes back as exactly the cap with countCapped set.
      // Rendering that bare would email "10,000 new openings" as though it were
      // exact when the real figure is higher — so the copy says "10,000+".
      const rawCapped = (countRes as { countCapped?: boolean } | null)?.countCapped === true;
      if (rawNew === 0) {
        // Nothing new: the claim's stamp advances the window, as the old
        // explicit stamp here did.
        skipped++;
        continue;
      }
      /** Postings this search already mailed (search_digest_sent, 30 days), or null when unreadable. */
      const alreadySent = async (ids: string[]): Promise<Set<string> | null> => {
        if (!ids.length) return new Set();
        const { data, error: sentErr } = await supabase.from("search_digest_sent").select("posting_id").eq("search_id", s.id).in("posting_id", ids);
        if (sentErr) { console.error("[SEARCH-DIGEST] sent-id read failed:", sentErr.message); return null; }
        return new Set((data ?? []).map((r: { posting_id: string }) => r.posting_id));
      };

      // Fit-threshold alerts: when the saved search has a fit_threshold, score the
      // new postings against the user's latest résumé and only alert on ones that
      // actually clear the bar — so the email is "3 strong matches for you", not
      // "40 new postings". Falls back to the plain digest if no résumé is on file.
      const threshold = Number((s as { fit_threshold?: number }).fit_threshold) || 0;
      let jobs: Array<{ id?: string; company: string; title: string; location: string; applyUrl: string; fit?: number; postedAt?: string | null }>;
      let newCount: number;
      let countIsLowerBound = false;
      let strongMode = false;
      /** What this mail counts as sent, recorded only after the send succeeds. */
      let mailedIds: string[] = [];

      let resumeText = "";
      if (threshold > 0) {
        // The account's PINNED matching résumé wins (explicit choice); latest
        // scan stays the fallback — same resolution order as the board.
        const { data: prof } = await supabase
          .from("user_profiles").select("matching_scan_id, matching_resume_text")
          .eq("user_id", s.user_id).maybeSingle();
        resumeText = ((prof?.matching_resume_text as string | null) ?? "").trim();
        if (resumeText.length < 100 && prof?.matching_scan_id) {
          const { data: pinned } = await supabase
            .from("user_scans").select("resume_text").eq("id", prof.matching_scan_id).maybeSingle();
          resumeText = ((pinned?.resume_text as string | null) ?? "").trim();
        }
        if (resumeText.length < 100) {
          const { data: scanRow } = await supabase
            .from("user_scans").select("resume_text")
            .eq("user_id", s.user_id).not("resume_text", "is", null)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();
          resumeText = ((scanRow?.resume_text as string | null) ?? "").trim();
        }
      }

      if (threshold > 0 && resumeText.length >= 100) {
        strongMode = true;
        const candRes = await callBoard({ limit: CANDIDATES, offset: 0, newSince: since });
        const candJobs = (candRes as { jobs?: unknown } | null)?.jobs;
        if (!Array.isArray(candJobs)) { await giveBack(s); skipped++; continue; }
        const sentBefore = await alreadySent(candJobs.map((j: { id?: string }) => j.id).filter((x): x is string => !!x));
        if (!sentBefore) { await giveBack(s); skipped++; continue; }
        const cand = (candJobs as Array<{ id: string; company: string; title: string; location: string; applyUrl: string }>)
          .filter((j) => !sentBefore.has(j.id));
        const ids = cand.map((j) => j.id).filter(Boolean);
        const descById = new Map<string, string>();
        if (ids.length > 0) {
          const { data: descRows } = await supabase.from("job_board_postings").select("id, description").in("id", ids);
          for (const r of descRows ?? []) descById.set(r.id as string, ((r.description as string | null) ?? ""));
        }
        const passing = cand
          .map((j) => {
            const d = descById.get(j.id) ?? "";
            if (d.length < 150) return null;
            const f = computeFit(d, resumeText, 40);
            return typeof f.pct === "number" && f.pct >= threshold ? { ...j, fit: f.pct } : null;
          })
          .filter((x): x is { id: string; company: string; title: string; location: string; applyUrl: string; fit: number } => x !== null)
          .sort((a, b) => b.fit - a.fit);
        if (passing.length === 0) {
          // Nothing cleared the bar this window — don't email; the claim's
          // stamp advances the window.
          skipped++;
          continue;
        }
        newCount = passing.length;
        jobs = passing.slice(0, 5);
        mailedIds = passing.map((j) => j.id);
      } else {
        // The list's window is the count's — the headline says "new since we
        // last checked", so the rows below it must actually BE that.
        const listRes = await callBoard({ limit: CANDIDATES, offset: 0, newSince: since });
        const listJobs = (listRes as { jobs?: unknown } | null)?.jobs;
        if (!Array.isArray(listJobs) || listJobs.length === 0) { await giveBack(s); skipped++; continue; } // count said new but no list (transient) — retry next run, claim handed back
        const all = listJobs as Array<{ id?: string; company: string; title: string; location: string; applyUrl: string; postedAt?: string | null }>;
        const sentBefore = await alreadySent(all.map((j) => j.id).filter((x): x is string => !!x));
        if (!sentBefore) { await giveBack(s); skipped++; continue; }
        const fresh = all.filter((j) => !j.id || !sentBefore.has(j.id));
        // Everything in the window was mailed before (a re-dated posting, a
        // reset discovery date): nothing new, and the claim's stamp advances.
        if (fresh.length === 0) { skipped++; continue; }
        // Counted, never guessed: when the list held the whole window the
        // number is the fresh rows; otherwise the board's count less the rows
        // proven already mailed, still marked "+" if the board capped it.
        const sawAll = rawNew <= all.length;
        newCount = sawAll ? fresh.length : rawNew - (all.length - fresh.length);
        countIsLowerBound = !sawAll && rawCapped;
        jobs = fresh.slice(0, 5);
        mailedIds = fresh.map((j) => j.id).filter((x): x is string => !!x);
      }

      const token = await hmacToken(s.id as string);
      // "10,000+" when the board could only tell us "at least this many".
      const shownCount = countIsLowerBound ? `${newCount.toLocaleString()}+` : String(newCount);
      const unsubParams = { id: s.id as string, token };
      const unsubUrl = unsubscribePageUrl("search-digest", unsubParams);
      const unsubHeaders = oneClickHeaders(oneClickUrl(Deno.env.get("SUPABASE_URL") ?? "", "send-search-digest", unsubParams));
      const viewUrl = `${boardUrl(p)}${boardUrl(p).includes("?") ? "&" : "?"}utm_source=email&utm_medium=search_digest`;

      const fmtPosted = (iso?: string | null) => {
        if (!iso) return "";
        const d = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));
        return d === 0 ? "posted today" : d === 1 ? "posted yesterday" : `posted ${d}d ago`;
      };
      const rows = jobs.map((j) => {
        // Deep-link to OUR posting page (fit scan, live verify, prep answers
        // all live there); the bare ATS exit is the fallback for rows the
        // board can't resolve.
        const rowUrl = j.id
          ? `${SITE_URL}/jobs?job=${encodeURIComponent(j.id)}&utm_source=email&utm_medium=search_digest`
          : j.applyUrl;
        return `
        <tr><td style="padding:10px 0;border-bottom:1px solid #eef2f7">
          <div style="font-size:14px;font-weight:600;color:#0f172a"><a href="${escapeHtml(rowUrl)}" style="color:#0f172a;text-decoration:none">${escapeHtml(j.title)}</a></div>
          <div style="font-size:12px;color:#64748b">${escapeHtml(j.company)}${j.location ? " · " + escapeHtml(j.location) : ""}${j.postedAt ? ` · ${escapeHtml(fmtPosted(j.postedAt))}` : ""}${typeof j.fit === "number" ? ` · <span style="color:#16a34a;font-weight:600">${escapeHtml(j.fit)}% match</span>` : ""}</div>
        </td><td style="padding:10px 0;border-bottom:1px solid #eef2f7;text-align:right;vertical-align:middle">
          <a href="${escapeHtml(rowUrl)}" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:600">View&nbsp;→</a>
        </td></tr>`;
      }).join("");

      const html = `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="text-align:center;padding:0 0 14px">
      <span style="font-size:17px;font-weight:800;color:#0f172a">Resume <span style="color:#2563eb">Booster</span></span>
      <div style="font-size:11px;color:#94a3b8;margin-top:2px">Saved search · ${escapeHtml(s.name as string)}</div>
    </div>
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px">
      <p style="font-size:15px;color:#0f172a;margin:0 0 4px"><b>${escapeHtml(shownCount)}</b> new ${strongMode ? (newCount === 1 ? "match for you" : "matches for you") : (newCount === 1 ? "opening" : "openings")} since we last checked</p>
      <p style="font-size:13px;color:#64748b;margin:0 0 16px">${strongMode ? `that clear your fit bar for` : `matching`} “${escapeHtml(s.name as string)}”, pulled from companies' official job boards.</p>
      <table style="width:100%;border-collapse:collapse">${rows}</table>
      <div style="text-align:center;margin:20px 0 4px">
        <a href="${escapeHtml(viewUrl)}" style="display:inline-block;background:#2563eb;color:#fff;font-size:14px;font-weight:700;padding:11px 22px;border-radius:10px;text-decoration:none">See all ${escapeHtml(shownCount)} on the board</a>
      </div>
      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:10px 0 0">Tip: <a href="${SITE_URL}" style="color:#2563eb;text-decoration:none">scan your resume</a> against any posting before you apply.</p>
    </div>
    <p style="font-size:11px;color:#94a3b8;text-align:center;margin:14px 0 0">
      You turned on the digest for this saved search. <a href="${escapeHtml(unsubUrl)}" style="color:#94a3b8">Turn it off</a>.
    </p>
  </div>
</body></html>`;

      try {
        const CATEGORY_LABELS: Record<string, string> = {
          engineering: "engineering", data_ai: "data & AI", design: "design", product: "product",
          marketing: "marketing", sales: "sales", customer: "customer", finance: "finance",
          legal: "legal", people_hr: "people & HR", operations: "operations", healthcare: "healthcare",
          science: "science", education: "education", hospitality_retail: "retail & hospitality",
          security: "security", admin: "admin", other: "job",
        };
        const catLabel = p.category ? (CATEGORY_LABELS[p.category] ?? "job") : (p.q || "job");
        // First-ever send on a daily-cadence search = the user clicked "Alert
        // me when this exists" (or watch-company) and this is the moment it
        // exists. Say that, plainly — it's the single most awaited email the
        // board sends.
        const firstMatch = !s.digest_last_sent_at && String((s as { digest_cadence?: string }).digest_cadence ?? "") === "daily";
        const subject = firstMatch
          ? `We found it: ${shownCount} ${newCount === 1 ? "match" : "matches"} for “${s.name}”`
          : strongMode
            ? `${shownCount} new strong ${newCount === 1 ? "match" : "matches"} for you — ${s.name}`
            : `${shownCount} new ${catLabel} ${newCount === 1 ? "match" : "matches"} — ${s.name}`;
        const { error: sendErr } = await resend.emails.send({ from: "Resume Booster <reports@resumebooster.work>", to: email, subject, html, headers: unsubHeaders });
        if (sendErr) throw new Error(String((sendErr as { message?: string }).message ?? "send refused"));
        sent++;
        // Remembered so a re-dated or re-discovered posting is not mailed
        // twice; a failed record costs at most one repeat, never a lost mail.
        if (mailedIds.length) {
          const { error: recErr } = await supabase.rpc("search_digest_record_sent", { p_search_id: s.id, p_posting_ids: mailedIds });
          if (recErr) console.error("[SEARCH-DIGEST] sent-id record failed:", recErr.message);
        }
      } catch (e) {
        // A failed send gives its claim back, so the next run retries it.
        console.error("[SEARCH-DIGEST] send failed:", e instanceof Error ? e.message : e);
        await giveBack(s);
        skipped++;
      }
    }
    return new Response(JSON.stringify({ ok: true, sent, skipped, considered: (searches ?? []).length }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[SEARCH-DIGEST] error:", e instanceof Error ? e.message : e);
    return new Response(JSON.stringify({ error: "digest run failed" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
