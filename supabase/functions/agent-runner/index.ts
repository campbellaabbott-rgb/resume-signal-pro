// Morning Queue overnight runner. Cron hits this daily (06:10 UTC). For every
// ACTIVE, ENTITLED mandate it:
//   1. scans postings that are genuinely NEW to the board (first_seen inside
//      the lookback) and match the mandate's filters,
//   2. scores each against the user's resume snapshot (shared computeFit),
//   3. triages with the platform's own company intelligence: companies whose
//      takedowns are mostly re-listings are SKIPPED (churn machinery), and
//      companies with genuine-tenure fills get a boost + a visible reason,
//   4. queues the top daily_count picks with structured reasons the UI
//      localizes ({k:'fit'|'fills'|'fresh'|'salary', ...}),
//   5. records an honest run summary (scanned/picked/skipped) on the mandate.
//
// The agent NEVER submits anywhere. It prepares and explains; the human sends.
// Reasons are machine-readable data, not baked prose — same honesty rule as
// every stat on the platform: nothing claimed that the data can't back.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { computeFit } from "../_shared/fit-score.ts";

const MANDATES_PER_RUN = 200;      // safety cap; batches long before this matters
const CANDIDATES_PER_MANDATE = 400;
const LOOKBACK_HOURS = 36;         // overlap across runs; dedupe is the unique key
const MIN_FIT_PCT = 30;            // below this a pick would waste the user's morning

interface MandateRow {
  user_id: string; email: string; q: string; category: string; location: string;
  remote_only: boolean; salary_min: number | null; daily_count: number; resume_text: string;
}
interface PostingRow {
  id: string; title: string; company: string; company_token: string; location: string;
  apply_url: string; salary: string | null; category: string; posted_at: string | null;
  first_seen: string; remote: boolean; description: string | null; salary_min_annual: number | null;
}
interface HealthRow { company_token: string; closed_90d: number; superseded_90d: number }

serve(async (req) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const client = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  const startedAt = Date.now();

  // Queue hygiene first: unactioned picks older than 48h expire (the cron
  // retention job also does this; doing it here keeps a manual run honest).
  await client.from("agent_queue")
    .update({ status: "expired", decided_at: new Date().toISOString() })
    .eq("status", "ready")
    .lt("created_at", new Date(Date.now() - 48 * 3600_000).toISOString());

  // Active mandates with a usable resume, joined to the entitlement cache.
  const { data: mandates, error: mErr } = await client
    .from("agent_mandates")
    .select("user_id, email, q, category, location, remote_only, salary_min, daily_count, resume_text")
    .eq("active", true)
    .limit(MANDATES_PER_RUN);
  if (mErr) return json({ error: mErr.message }, 500);

  // The account UI promises "the apply agent now matches against this
  // résumé" when a user pins one — honor it: prefer the profile's CURRENT
  // matching resume over the mandate's creation-time snapshot (audit
  // 2026-07-25: the snapshot was frozen forever and no UI path refreshed it).
  const userIds = [...new Set((mandates ?? []).map((m) => m.user_id).filter(Boolean))];
  const pinnedByUser = new Map<string, string>();
  if (userIds.length) {
    const { data: profs } = await client
      .from("user_profiles")
      .select("user_id, matching_resume_text")
      .in("user_id", userIds);
    for (const p of (profs ?? []) as Array<{ user_id: string; matching_resume_text: string | null }>) {
      if (p.matching_resume_text && p.matching_resume_text.trim().length >= 100) pinnedByUser.set(p.user_id, p.matching_resume_text);
    }
  }

  const emails = [...new Set((mandates ?? []).map((m) => m.email).filter(Boolean))];
  const entitled = new Set<string>();
  if (emails.length) {
    const { data: subs } = await client
      .from("agent_subscribers")
      .select("email, status, current_period_end")
      .in("email", emails);
    for (const s of (subs ?? []) as Array<{ email: string; status: string; current_period_end: string | null }>) {
      const periodOk = !s.current_period_end || new Date(s.current_period_end).getTime() > Date.now();
      if ((s.status === "active" || s.status === "trialing") && periodOk) entitled.add(s.email);
    }
  }

  const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
  let processed = 0, totalPicked = 0;

  for (const m of (mandates ?? []) as MandateRow[]) {
    if (!entitled.has(m.email)) continue;
    if ((m.resume_text ?? "").trim().length < 100) continue;
    processed++;

    // Candidate postings: genuinely new to the board, mandate filters applied
    // in SQL, newest-stated first so freshness wins ties before scoring.
    let qb = client
      .from("job_board_postings")
      .select("id, title, company, company_token, location, apply_url, salary, category, posted_at, first_seen, remote, description, salary_min_annual")
      .gt("first_seen", sinceIso)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(CANDIDATES_PER_MANDATE);
    if (m.category) qb = qb.eq("category", m.category);
    if (m.remote_only) qb = qb.eq("remote", true);
    if (m.location) qb = qb.ilike("location", `%${m.location}%`);
    if (m.q) qb = qb.ilike("title", `%${m.q}%`);
    if (m.salary_min != null) qb = qb.gte("salary_min_annual", m.salary_min);
    const { data: cands, error: cErr } = await qb;
    if (cErr || !cands?.length) {
      await client.from("agent_mandates").update({
        last_run_at: new Date().toISOString(),
        last_run_summary: { scanned: 0, picked: 0, skipped_churn: 0, skipped_lowfit: 0 },
        updated_at: new Date().toISOString(),
      }).eq("user_id", m.user_id);
      continue;
    }

    // Company intelligence for triage — one batched RPC.
    const tokens = [...new Set((cands as PostingRow[]).map((c) => c.company_token))];
    const healthByToken = new Map<string, HealthRow>();
    try {
      const { data: health } = await client.rpc("get_company_hiring_health", { p_tokens: tokens });
      for (const h of (health ?? []) as HealthRow[]) healthByToken.set(h.company_token, h);
    } catch (_) { /* triage still works on fit alone */ }

    let skippedChurn = 0, skippedLowfit = 0;
    const scored: Array<{ c: PostingRow; fit: number; reasons: unknown[] }> = [];
    for (const c of cands as PostingRow[]) {
      const h = healthByToken.get(c.company_token);
      // Churn disqualifier — the same rule Explore and the lander badge use.
      if (h && (h.superseded_90d ?? 0) > (h.closed_90d ?? 0) && (h.superseded_90d ?? 0) >= 10) {
        skippedChurn++;
        continue;
      }
      const postingText = `${c.title}\n${(c.description ?? "").slice(0, 6000)}`;
      const fit = computeFit(postingText, pinnedByUser.get(m.user_id) ?? m.resume_text);
      if (fit.pct == null || fit.pct < MIN_FIT_PCT) { skippedLowfit++; continue; }

      const reasons: unknown[] = [{ k: "fit", pct: fit.pct, top: fit.matched.slice(0, 3) }];
      if (h && (h.closed_90d ?? 0) >= 3) reasons.push({ k: "fills", n: h.closed_90d });
      if (c.posted_at) {
        const days = Math.max(0, Math.floor((Date.now() - new Date(c.posted_at).getTime()) / 86400_000));
        if (days <= 7) reasons.push({ k: "fresh", days });
      }
      if (m.salary_min != null && c.salary_min_annual != null) reasons.push({ k: "salary" });
      // Ranking: fit first, genuine-filler boost breaks ties.
      const rank = fit.pct + ((h && (h.closed_90d ?? 0) >= 3) ? 8 : 0);
      scored.push({ c, fit: fit.pct, reasons: [...reasons, { k: "_rank", v: rank }] });
    }
    scored.sort((a, b) =>
      ((b.reasons.at(-1) as { v: number }).v) - ((a.reasons.at(-1) as { v: number }).v));

    const picks = scored.slice(0, Math.max(1, Math.min(m.daily_count, 10)));
    if (picks.length) {
      const rows = picks.map(({ c, fit, reasons }) => ({
        user_id: m.user_id,
        posting_id: c.id,
        title: c.title.slice(0, 300),
        company: c.company,
        company_token: c.company_token,
        location: c.location ?? "",
        apply_url: c.apply_url,
        salary: c.salary ?? "",
        category: c.category ?? "other",
        posted_at: c.posted_at,
        fit_pct: fit,
        reasons: reasons.filter((r) => (r as { k: string }).k !== "_rank"),
        status: "ready",
      }));
      // Dedupe on (user_id, posting_id): re-runs and overlapping lookbacks no-op.
      const { error: insErr } = await client.from("agent_queue")
        .upsert(rows, { onConflict: "user_id,posting_id", ignoreDuplicates: true });
      if (insErr) console.warn(`[AGENT-RUNNER] insert failed for ${m.user_id}:`, insErr.message?.slice(0, 150));
      else totalPicked += rows.length;
    }

    await client.from("agent_mandates").update({
      last_run_at: new Date().toISOString(),
      last_run_summary: {
        scanned: cands.length,
        picked: picks.length,
        skipped_churn: skippedChurn,
        skipped_lowfit: skippedLowfit,
      },
      updated_at: new Date().toISOString(),
    }).eq("user_id", m.user_id);
  }

  return json({ ok: true, mandates: processed, picked: totalPicked, ms: Date.now() - startedAt });
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
