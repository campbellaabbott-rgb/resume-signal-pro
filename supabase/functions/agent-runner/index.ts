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
import { isSendableVendor, SENDABLE_VENDORS } from "../_shared/apply-automation.ts";
import { ENTITLEMENT_COLUMNS, entitledFromRows, isEntitled, normalizeEmail, rowIsEntitled } from "../_shared/agent-entitlement.ts";
import { nextRunStamp } from "../_shared/run-stamp.ts";
// The two reach rules live in _shared so a vitest suite can EXECUTE them.
// This file imports from https://deno.land, which the Node ESM loader refuses,
// so every test of it is a regex over its source — able to prove a line exists
// and never able to prove what it does. These two decide whether a subscriber
// sees a quarter of the board, which is worth more than a text match.
import { applyCategory, applyMaxAge } from "../_shared/mandate-reach.ts";

// Bumped whenever this function changes shape, so a 403 can say WHICH bundle
// refused — the difference between "the gate is live" and "the old open build
// is still deployed" is otherwise invisible from outside.
//
// .2 ADDS THE RUN STAMP, and exists because .1 did not get bumped when the
// stamp was added. Both builds then reported the same version, so "is the gate
// deployed" was answerable and "is the stamp writer deployed" was not — the
// same one-value-two-states fault this file's counters exist to remove,
// reintroduced in the version field one commit after fixing it elsewhere.
// Until the nightly cron fires, this string is the only thing that can tell
// the two bundles apart.
const BUILD_VERSION = "2026-08-03.2";

const MANDATES_PER_RUN = 200;      // safety cap; batches long before this matters
const CANDIDATES_PER_MANDATE = 400;
// A separate, smaller pull for vendors the worker can submit to unattended.
// Deliberately modest: it exists to guarantee representation in the pool, not
// to flood the queue with them at the expense of better-fitting jobs.
const SENDABLE_CANDIDATES = 120;
const LOOKBACK_HOURS = 36;         // overlap across runs; dedupe is the unique key
const MIN_FIT_PCT = 30;            // below this a pick would waste the user's morning

/**
 * REACH, which the mandate had no way to express.
 *
 * `max_age_days` — the runner takes postings whose FIRST_SEEN is inside a
 * 36-hour lookback, which is "new to the board" and not "new to the world". An
 * employer's feed routinely surfaces a role it posted five months ago, and the
 * agent queued it as today's find. Mirrors the board's own maxAgeDays exactly:
 * posted_at, 1..30, undated postings outside it.
 *
 * `include_uncategorised` — `.eq("category", …)` excluded the `other` bucket,
 * which held 162,800 of 590,808 postings on 2026-08-05. A category choice was
 * hiding 27.6% of the board and nothing said so.
 *
 * Both optional on the type, because this function must survive being deployed
 * before its migration — see the select fallback below.
 */
interface Reach {
  max_age_days?: number | null;
  include_uncategorised?: boolean | null;
}
interface MandateRow extends Reach {
  user_id: string; email: string; q: string; category: string; location: string;
  remote_only: boolean; salary_min: number | null; daily_count: number; resume_text: string;
  apply_mode: "review" | "auto";
}
/** One saved search. The profile stays on the mandate; only criteria live here. */
interface SearchRow extends Reach {
  id: number; user_id: string; label: string;
  q: string; category: string; location: string;
  remote_only: boolean; salary_min: number | null; daily_count: number;
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

  // AUTHENTICATED. This was open to anyone.
  //
  // A POST with an empty body scanned the board, scored every candidate posting
  // against every subscriber's résumé, and wrote queue rows — hundreds of
  // database reads and the fit scorer over each one, on demand, from anywhere.
  // It leaks nothing (the response is counts), so this is a cost and abuse hole
  // rather than a data one, but "free to trigger, expensive to serve" is the
  // shape of an outage someone else gets to schedule for us.
  //
  // Same gate as apply-agent, deliberately: env key or the vault-held
  // maintenance key, and the vault is only consulted when a key was actually
  // presented, so an unauthenticated caller is refused without touching the
  // database and cannot be used to make refusal expensive.
  const presented = req.headers.get("x-maintenance-key") ?? "";
  const envKey = Deno.env.get("AGENT_MAINTENANCE_KEY") ?? "";
  let authorized = envKey !== "" && presented === envKey;
  if (!authorized && presented) {
    const { data: matches } = await client.rpc("agent_maintenance_key_matches", { p_key: presented });
    authorized = matches === true;
  }
  if (!authorized) {
    // The refusal carries the build version and nothing else — never whether a
    // key exists, never how long one should be. Same as apply-agent: enough to
    // tell "the new bundle refused me" from "the old bundle has no gate", which
    // is the only question worth answering to an unauthenticated caller.
    console.warn("[AGENT-RUNNER] refused an unauthenticated call");
    return json({ error: "unauthorized", version: BUILD_VERSION }, 403);
  }

  // WHO ASKED. The cron sends {"source":"cron"}; a hand invocation sends {}.
  // Conflating them is what made "has the SCHEDULE ever run" unanswerable for
  // apply-agent until 20260802140000 — a manual run proves the function works
  // and proves nothing at all about the schedule.
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is a hand run */ }
  const trigger = body?.source === "cron" ? "cron" : "manual";

  // Queue hygiene first: unactioned picks older than 48h expire (the cron
  // retention job also does this; doing it here keeps a manual run honest).
  await client.from("agent_queue")
    .update({ status: "expired", decided_at: new Date().toISOString() })
    .eq("status", "ready")
    .lt("created_at", new Date(Date.now() - 48 * 3600_000).toISOString());

  // Active mandates with a usable resume, joined to the entitlement cache.
  //
  // TWO SELECTS, AND THE SECOND ONE IS THE POINT. PostgREST rejects the whole
  // query with a 400 when a named column does not exist, so adding
  // max_age_days/include_uncategorised to this list makes the nightly run fail
  // COMPLETELY in the window between this bundle deploying and its migration
  // applying. That window is real here — the frontend deploys fast and
  // migrations only apply through an active session — and a runner that stops
  // finding anyone jobs is a worse outcome than a feature arriving late.
  //
  // So the extended select is attempted and the legacy one is the fallback. The
  // new fields are optional on the type and every read of them treats absent as
  // "not set", which is exactly the pre-migration behaviour.
  const MANDATE_COLS = "user_id, email, q, category, location, remote_only, salary_min, daily_count, resume_text, apply_mode";
  const readMandates = async (cols: string) => await client
    .from("agent_mandates").select(cols).eq("active", true).limit(MANDATES_PER_RUN);

  let mRes = await readMandates(`${MANDATE_COLS}, max_age_days, include_uncategorised`);
  if (mRes.error) {
    console.warn(`[AGENT-RUNNER] reach columns unavailable, running without them: ${mRes.error.message?.slice(0, 120)}`);
    mRes = await readMandates(MANDATE_COLS);
  }
  if (mRes.error) return json({ error: mRes.error.message }, 500);
  const mandates = (mRes.data ?? []) as unknown as MandateRow[];

  // ROWS THAT EXIST BUT ARE SWITCHED OFF. The `active` filter above means a
  // zero result still spans two states — nobody has ever set up a mandate, and
  // somebody set one up and turned it off. Those need opposite responses from
  // a human ("create one" vs "yours is paused"), so counting only the filtered
  // set reproduces, one level down, exactly the ambiguity these counters were
  // added to remove. agent_mandates holds one row per subscriber, so an exact
  // count is cheap. (Exact, never estimated — an estimate here would be a
  // number that looks like a fact and is not one.)
  //
  // AND THE COUNT'S OWN FAILURE IS NOT ZERO. Written first as
  // `mandates_total: totalMandates ?? 0`, which reports a failed count and an
  // empty table with the same digit — the exact defect this whole block exists
  // to remove, reintroduced by the code removing it. A number that cannot fail
  // visibly is not evidence. On error the field is null, never 0.
  const { count: totalMandates, error: cErr } = await client
    .from("agent_mandates")
    .select("user_id", { count: "exact", head: true });

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

  // This check was already correct. It is routed through the shared predicate
  // anyway, so that "what does entitled mean" has exactly one answer in the
  // codebase — the two functions that got it wrong got it wrong by writing a
  // fourth version of this loop.
  const emails = [...new Set((mandates ?? []).map((m) => normalizeEmail(m.email)).filter(Boolean))];
  let entitled = new Set<string>();
  if (emails.length) {
    const { data: subs } = await client
      .from("agent_subscribers")
      .select(ENTITLEMENT_COLUMNS)
      .in("email", emails);
    entitled = entitledFromRows(subs);
  }

  // SAVED SEARCHES — many per candidate.
  //
  // agent_mandates is `user_id PRIMARY KEY`, so it could hold exactly one set
  // of criteria. A real job hunt is not one: "Product Manager, NYC, >=140k" and
  // "Program Manager, remote, >=120k" are different searches with different
  // floors. The criteria now live in agent_searches; the PROFILE stays on the
  // mandate, because two copies of "are you authorised to work" that can
  // disagree is worse than the limitation being lifted.
  //
  // A missing table is treated as "no searches", not as an error, so this
  // function is safe to deploy before or after its migration.
  const searchesByUser = new Map<string, SearchRow[]>();
  if (userIds.length) {
    const SEARCH_COLS = "id, user_id, label, q, category, location, remote_only, salary_min, daily_count";
    // Same two-step as the mandates select above, and for the same reason: a
    // 400 on an unknown column here would be swallowed by the `error` branch
    // below and read as "this user has no searches" — every subscriber's agent
    // silently falling back to their single mandate, which is the failure that
    // looks exactly like working software.
    const readSearches = async (cols: string) => await client
      .from("agent_searches").select(cols).eq("active", true).in("user_id", userIds);

    let sRes = await readSearches(`${SEARCH_COLS}, max_age_days, include_uncategorised`);
    if (sRes.error) sRes = await readSearches(SEARCH_COLS);
    if (sRes.error) {
      console.warn(`[AGENT-RUNNER] agent_searches unavailable, using mandate criteria: ${sRes.error.message?.slice(0, 120)}`);
    } else {
      for (const s of (sRes.data ?? []) as unknown as SearchRow[]) {
        const list = searchesByUser.get(s.user_id) ?? [];
        list.push(s);
        searchesByUser.set(s.user_id, list);
      }
    }
  }

  const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 3600_000).toISOString();
  let processed = 0, totalPicked = 0;
  // WHY THESE COUNTERS EXIST. This function reported `mandates: 0` for four
  // different states — no mandate rows at all, rows that failed the entitlement
  // check, rows whose résumé was too short, and rows that ran and picked
  // nothing. One number for four states is not a measurement, and it sent two
  // separate investigations looking for a subscription problem when the honest
  // answer might simply have been "nobody has created a mandate".
  let skippedUnentitled = 0, skippedNoResume = 0;

  // GATE PER USER, THEN FAN OUT PER SEARCH.
  //
  // The two checks below are facts about a PERSON — are they entitled, do they
  // have a usable résumé — not about a search. Running them inside the
  // per-search loop would count one unentitled subscriber three times and make
  // skipped_unentitled a number of searches pretending to be a number of
  // people. That is the same "one number for two things" fault the counters
  // themselves were added to remove.
  const eligible: MandateRow[] = [];
  for (const m of (mandates ?? []) as MandateRow[]) {
    if (!isEntitled(entitled, m.email)) { skippedUnentitled++; continue; }
    if ((m.resume_text ?? "").trim().length < 100) { skippedNoResume++; continue; }
    eligible.push(m);
  }
  processed = eligible.length;

  // Each saved search becomes its own run row, carrying the user's profile with
  // that search's criteria. The loop body below is unchanged: a run row has the
  // same field names a mandate had, so `m.q` and friends keep working.
  //
  // FALLBACK IS DELIBERATE. If agent_searches is missing (function deployed
  // ahead of its migration) or a user has no rows yet, the mandate's own
  // columns are used. An agent that silently stops finding jobs because a table
  // is not there yet is worse than one that keeps doing what it did yesterday.
  type RunRow = MandateRow & { search_id: number; search_label: string };
  const runRows: RunRow[] = [];
  for (const m of eligible) {
    const list = searchesByUser.get(m.user_id) ?? [];
    if (list.length) {
      for (const s of list) {
        runRows.push({
          ...m,
          q: s.q, category: s.category, location: s.location,
          remote_only: s.remote_only, salary_min: s.salary_min,
          daily_count: s.daily_count,
          // Reach is per SEARCH, not per person: "anything posted this week" and
          // "anything at all" are different searches, and taking the mandate's
          // value here would make one of them wrong.
          max_age_days: s.max_age_days, include_uncategorised: s.include_uncategorised,
          search_id: s.id, search_label: s.label,
        });
      }
    } else {
      runRows.push({ ...m, search_id: 0, search_label: "My search" });
    }
  }

  // STAMP THE SEARCH THAT RAN, NOT THE USER.
  //
  // Both summary writes targeted agent_mandates by user_id. With several
  // searches per candidate that is last-writer-wins: three searches run, three
  // summaries are written to the same row, and the two that finished first are
  // erased. "Why did my Product Manager search find nothing" then has no
  // answer, because only the last search's numbers survived.
  //
  // search_id 0 means the fallback path (no agent_searches rows yet), where the
  // mandate IS the search and the old behaviour is still correct.
  const stampRun = async (r: RunRow, summary: Record<string, number>) => {
    const now = new Date().toISOString();
    if (r.search_id > 0) {
      await client.from("agent_searches").update({
        last_run_at: now, last_run_summary: summary, updated_at: now,
      }).eq("id", r.search_id);
    } else {
      await client.from("agent_mandates").update({
        last_run_at: now, last_run_summary: summary, updated_at: now,
      }).eq("user_id", r.user_id);
    }
  };

  for (const m of runRows) {

    // Candidate postings: genuinely new to the board, mandate filters applied
    // in SQL, newest-stated first so freshness wins ties before scoring.
    let qb = client
      .from("job_board_postings")
      .select("id, title, company, company_token, location, apply_url, salary, category, posted_at, first_seen, remote, description, salary_min_annual")
      .gt("first_seen", sinceIso)
      .order("posted_at", { ascending: false, nullsFirst: false })
      .limit(CANDIDATES_PER_MANDATE);
    // CATEGORY, AND THE QUARTER OF THE BOARD IT USED TO REMOVE. `other` held
    // 162,800 of 590,808 postings on 2026-08-05 — it is where a posting lands
    // when the classifier could not place its title, not a junk drawer — and
    // `.eq()` excluded every one of them the moment somebody picked a field.
    // Opt-in, so an existing mandate returns exactly what it returned before.
    qb = applyCategory(qb, m);
    if (m.remote_only) qb = qb.eq("remote", true);
    // Multi-term: one mandate can now name several roles and several places.
    const locTerms = splitTerms(m.location);
    const qTerms = splitTerms(m.q);
    if (locTerms.length) qb = qb.or(orIlike("location", locTerms));
    if (qTerms.length) qb = qb.or(orIlike("title", qTerms));
    if (m.salary_min != null) qb = qb.gte("salary_min_annual", m.salary_min);
    // STATED AGE, not discovery age. `first_seen > sinceIso` above means new to
    // THE BOARD; a feed can surface a role posted five months ago and it would
    // arrive as today's find. Same column and same clamp as the board's own
    // maxAgeDays, so the two surfaces cannot disagree about one posting.
    qb = applyMaxAge(qb, m);
    const { data: cands0, error: cErr } = await qb;

    // A SECOND, narrower pull for auto mode — only the vendors the worker can
    // actually finish.
    //
    // Without this the sendable boost is close to cosmetic. Those vendors are
    // 5.3% of the board (measured 2026-08-03; this comment said 3.4% and a
    // sibling said 2%, both from when three adapters existed — job-board's
    // `sendable` block now computes it live so it cannot drift again), so a
    // 400-row window ordered by date holds maybe a
    // dozen of them before the fit floor, and whether any survive is luck. The
    // boost can only prefer what is already in the pool; this puts them there.
    //
    // Same mandate filters, so it widens the pool without loosening anyone's
    // criteria — and everything still goes through the identical fit floor and
    // scoring below. Merged and deduped by id, so a posting caught by both
    // queries is scored once.
    let cands = cands0 ?? [];
    if (m.apply_mode === "auto") {
      let sb2 = client
        .from("job_board_postings")
        .select("id, title, company, company_token, location, apply_url, salary, category, posted_at, first_seen, remote, description, salary_min_annual")
        .gt("first_seen", sinceIso)
        .or(SENDABLE_VENDORS.map((v) => `id.like.${v}:*`).join(","))
        .order("posted_at", { ascending: false, nullsFirst: false })
        .limit(SENDABLE_CANDIDATES);
      // THE SECOND CALL SITE. The multi-term change shipped one commit ago with
      // a note that this file turns a mandate into a query in TWO places and
      // that patching only the obvious one leaves the feature working in the
      // main path and silently absent in the other. Same two filters, same
      // helpers, and the test counts both call sites.
      sb2 = applyCategory(sb2, m);
      if (m.remote_only) sb2 = sb2.eq("remote", true);
      const locTerms2 = splitTerms(m.location);
      const qTerms2 = splitTerms(m.q);
      if (locTerms2.length) sb2 = sb2.or(orIlike("location", locTerms2));
      if (qTerms2.length) sb2 = sb2.or(orIlike("title", qTerms2));
      if (m.salary_min != null) sb2 = sb2.gte("salary_min_annual", m.salary_min);
      sb2 = applyMaxAge(sb2, m);
      const { data: sendableCands } = await sb2;
      if (sendableCands?.length) {
        const seen = new Set(cands.map((c) => (c as PostingRow).id));
        for (const c of sendableCands as PostingRow[]) if (!seen.has(c.id)) cands.push(c);
      }
    }

    if (cErr || !cands?.length) {
      await stampRun(m, { scanned: 0, picked: 0, skipped_churn: 0, skipped_lowfit: 0 });
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
      // Can the worker finish this one without the candidate? Four vendors
      // have an adapter — 5.3% of the board, measured, not asserted — so for
      // somebody in auto mode the queue is still mostly jobs the agent hands
      // back. The ceiling is bot protection on every other vendor, documented
      // per-vendor in worker/RECON.md, not a gap in our adapter coverage.
      const sendable = isSendableVendor(c.id);
      if (sendable) reasons.push({ k: "sendable" });

      // Ranking: fit first, then two small boosts.
      //
      // SENDABLE_BOOST is deliberately smaller than a meaningful fit gap. It can
      // only reorder postings already within 6 points of each other, so a
      // clearly better match still wins — and everything being ranked has
      // already cleared MIN_FIT_PCT, so this is a preference among jobs that all
      // qualified, never a promotion of a worse one.
      //
      // It applies ONLY in auto mode. Somebody who reviews and submits their own
      // applications gets no benefit from the vendor being drivable, and
      // reordering their queue by it would be showing them worse jobs for a
      // reason that does not apply to them.
      const SENDABLE_BOOST = 6;
      const rank = fit.pct
        + ((h && (h.closed_90d ?? 0) >= 3) ? 8 : 0)
        + (sendable && m.apply_mode === "auto" ? SENDABLE_BOOST : 0);
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
        // WHICH SEARCH FOUND THIS. agent_searches.label exists so a candidate
        // can tell a queue of eight jobs drawn from three searches apart; the
        // migration that introduced it said so and did not wire it through.
        // search_id 0 is the pre-migration fallback path, where there is no
        // search row to point at.
        search_id: m.search_id > 0 ? m.search_id : null,
        // Denormalised: after a search is deleted the pick survives (ON DELETE
        // SET NULL) and "Product Manager, NYC" is still the true answer to
        // where it came from, which a join could no longer give.
        search_label: m.search_label ?? "",
      }));
      // Dedupe on (user_id, posting_id): re-runs and overlapping lookbacks no-op.
      const { error: insErr } = await client.from("agent_queue")
        .upsert(rows, { onConflict: "user_id,posting_id", ignoreDuplicates: true });
      if (insErr) console.warn(`[AGENT-RUNNER] insert failed for ${m.user_id}:`, insErr.message?.slice(0, 150));
      else totalPicked += rows.length;
    }

    await stampRun(m, {
      scanned: cands.length,
      picked: picks.length,
      skipped_churn: skippedChurn,
      skipped_lowfit: skippedLowfit,
    });
  }

  // STAMP THE RUN, so "did the schedule fire?" is answerable.
  //
  // This function is now gated, and its cron is the only caller that holds the
  // key. That makes a silent cron failure indistinguishable from a quiet night
  // — agent-runner wrote no stamp, so the first symptom of a broken schedule
  // would have been a subscriber noticing an empty morning queue. Gating a
  // function whose caller cannot be observed is how a fix becomes an outage
  // nobody attributes to the fix.
  //
  // Same shape and same table as apply-agent's stamp, so job-board's anon
  // `status` action can surface it without a service key. trigger comes from
  // the body: the cron sends {"source":"cron"}, a hand invocation does not, and
  // conflating the two is what made "has the schedule ever run" unanswerable
  // for apply-agent until 20260802140000.
  try {
    const { data: prevRow } = await client
      .from("job_board_meta").select("v").eq("k", "agent_runner_run").maybeSingle();
    const nowIso = new Date().toISOString();
    await client.from("job_board_meta").upsert({
      k: "agent_runner_run",
      v: nextRunStamp(prevRow?.v, {
        trigger, now: nowIso, buildVersion: BUILD_VERSION,
        mandates: processed,
        prepared: runRows.length,
        released: totalPicked,
        ms: Date.now() - startedAt,
      }),
      updated_at: nowIso,
    }, { onConflict: "k" });
  } catch (e) {
    // Never fail the run over its own bookkeeping.
    console.warn(`[AGENT-RUNNER] run stamp failed: ${String(e).slice(0, 120)}`);
  }

  return json({
    ok: true,
    mandates: processed,
    picked: totalPicked,
    // `found` is the ACTIVE row count before any skip; `mandates_total` is
    // every row regardless of the active flag. Read them together:
    //   total 0                      nobody has created a mandate
    //   total > 0, found 0           every mandate is switched off
    //   found > 0, mandates 0        all were dropped — the two counters below
    //                                say which gate did it
    found: (mandates ?? []).length,
    // null means THE COUNT FAILED — not "no rows". Read mandates_total_error.
    mandates_total: cErr ? null : (totalMandates ?? 0),
    mandates_total_error: cErr?.message ?? null,
    skipped_unentitled: skippedUnentitled,
    skipped_no_resume: skippedNoResume,
    // `mandates` counts PEOPLE the agent ran for; `searches` counts the saved
    // searches it ran across them. Reporting only one of these makes a user
    // with four searches indistinguishable from four users with one — and the
    // number that matters when picks look low is usually the other one.
    searches: runRows.length,
    ms: Date.now() - startedAt,
  });
});

/**
 * MANY ROLES, MANY PLACES — out of the two single-value fields we already have.
 *
 * A mandate stored one title fragment and one location, so "product manager OR
 * programme manager" and "London OR Manchester" were simply not expressible;
 * people had to pick one and lose the rest of their search.
 *
 * Commas separate them. No migration and no new columns, which matters more
 * than tidiness here: a value with no comma splits to a single-element list and
 * produces EXACTLY the query it produced before, so every mandate that already
 * exists keeps behaving identically without being touched or migrated.
 *
 * Commas are stripped from each term rather than escaped. PostgREST's `or()`
 * takes a comma-delimited string, so a comma surviving inside a value would be
 * read as a separator and silently widen somebody's search to terms they never
 * typed — a filter that quietly matches MORE than asked is worse than one that
 * errors.
 */
export function splitTerms(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((t) => t.replace(/[,()*]/g, " ").trim())
    .filter((t) => t.length > 0)
    .slice(0, 12);   // a bounded OR; nobody searches 50 titles, and the URL has limits
}

/** `col ILIKE %a%` OR `col ILIKE %b%` … for PostgREST's or() syntax. */
export function orIlike(col: string, terms: string[]): string {
  return terms.map((t) => `${col}.ilike.*${t}*`).join(",");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
