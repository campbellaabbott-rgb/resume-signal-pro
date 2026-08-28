// deploy-stamp: 2026-07-04T18:44Z
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Test resume for heartbeat checks
const TEST_RESUME = `John Smith
Software Engineer | john.smith@email.com | (555) 123-4567

PROFESSIONAL SUMMARY
Experienced software engineer with 5+ years developing scalable web applications.

EXPERIENCE
Senior Software Engineer, Tech Corp - 2020-Present
- Developed microservices architecture serving 1M+ daily users
- Led team of 4 engineers to deliver features 20% faster
- Reduced API latency by 40% through optimization

Software Engineer, StartupXYZ - 2018-2020
- Built React frontend with 95% test coverage
- Implemented CI/CD pipeline reducing deploy time by 60%

EDUCATION
BS Computer Science, State University, 2018

SKILLS
JavaScript, TypeScript, React, Node.js, Python, AWS, Docker, PostgreSQL`;

// Thresholds for health determination
const HEALTHY_RESPONSE_TIME_MS = 30000; // 30s
const DEGRADED_RESPONSE_TIME_MS = 60000; // 60s
const AI_MODEL = 'google/gemini-2.5-flash';

interface HealthCheckResult {
  name: string;
  passed: boolean;
  responseTimeMs?: number;
  error?: string;
}

// Analytics RPCs that aggregate over the whole ~570k-row postings table are slow
// while the sweeps write to it (measured 2026-07-26: the status action awaiting
// two of them took 17-19s). The heartbeat awaited six, one after another, which
// is how a run of entirely-passing checks reached 83s and then degraded ITSELF
// on a "High latency" rule — an alert about nothing, which is how alerting dies.
//
// Two of the six (ghost stats, date coverage) can't finish inside their own 20s
// statement_timeout at all, so they now come from the cron-built stats_cache
// instead. The remaining four are fired concurrently and bounded by this helper:
// a stat that can't be computed in time yields no data, and its check is
// recorded in `skipped` — reported as unmeasured, never as passing.
/**
 * A DEADLINE MISS AND AN EMPTY ANSWER MUST NOT LOOK THE SAME.
 *
 * This resolved `{ data: null }` for a timeout, for a rejection AND for a
 * genuinely empty result — so every consumer's `if (row)` guard skipped in
 * silence and the check simply VANISHED from the payload. No entry in `checks`,
 * no entry in `skipped`. The surrounding try/catch could not help: this never
 * throws, by construction.
 *
 * That is the same shape as the semantic tier returning [] on a deadline, and it
 * matters more here — this endpoint IS the monitoring. A check that disappears
 * reads exactly like a check that passed.
 *
 * `timedOut` distinguishes them. Callers record a skip with a reason rather than
 * dropping the check.
 */
async function rpcWithin<T>(
  p: PromiseLike<{ data: T | null }>,
  ms = 6_000,
): Promise<{ data: T | null; timedOut?: boolean; failed?: boolean }> {
  return await Promise.race([
    Promise.resolve(p).then((r) => r as { data: T | null }, () => ({ data: null, failed: true })),
    new Promise<{ data: null; timedOut: true }>((res) => setTimeout(() => res({ data: null, timedOut: true }), ms)),
  ]);
}

/** Reason string for a check whose RPC never answered, or "" when it did. */
function unanswered(r: { timedOut?: boolean; failed?: boolean }, fn: string, ms: number): string {
  if (r.timedOut) return `${fn} exceeded its ${ms}ms deadline — check not evaluated`;
  if (r.failed) return `${fn} failed — check not evaluated`;
  return "";
}

/**
 * WHICH BUNDLE ANSWERED — the one thing this endpoint could not say.
 *
 * Added 2026-08-07 after a deploy where the frontend half of a commit went
 * live and this function's half did not. The symptom was a heartbeat still
 * reporting `healthy` under a stalled stats cache, and distinguishing "the fix
 * did not deploy" from "the fix has a bug" took six probes and a read of every
 * assignment to overallStatus — because the response carried nothing that
 * identified the code behind it.
 *
 * Every other function here carries this marker for exactly that reason. The
 * health endpoint was the one without it, which is the wrong one to omit: it
 * is the endpoint you consult when you already suspect something is wrong.
 *
 * BUMP ON EVERY DEPLOY of this function.
 */
const BUILD_VERSION = "2026-08-27.3";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const checks: HealthCheckResult[] = [];
  let overallStatus = 'healthy';
  let errorMessage: string | null = null;

  // A check that cannot be evaluated must SAY SO, not disappear. Several checks
  // sit inside `try { ... } catch {}` around a stats RPC, and when that RPC
  // errored the check silently vanished from the payload — on 2026-07-26 four
  // checks (including the filter contract) were absent from a response that
  // read "15 checks, all passing", which is the most flattering possible way to
  // report that we had stopped looking. Absence is indistinguishable from
  // health to every consumer of this endpoint.
  //
  // So unevaluated checks are recorded here and surfaced as `skipped`. They
  // deliberately do NOT fail the run — a transient stats hiccup is not an
  // outage, and crying wolf is what this whole pass is fixing — but they are
  // never again invisible.
  const skipped: Array<{ name: string; reason: string }> = [];
  const skip = (name: string, reason: string) => { skipped.push({ name, reason }); };

  // Initialize Supabase
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  
  if (!supabaseUrl || !supabaseServiceKey) {
    return new Response(
      JSON.stringify({ error: 'Supabase not configured' }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // Check 1: Database connectivity
    const dbStart = Date.now();
    try {
      const { error } = await supabase.from('daily_scan_stats').select('date').limit(1);
      checks.push({
        name: 'database',
        passed: !error,
        responseTimeMs: Date.now() - dbStart,
        error: error?.message
      });
      if (error) {
        overallStatus = 'degraded';
        errorMessage = `Database: ${error.message}`;
      }
    } catch (e) {
      checks.push({
        name: 'database',
        passed: false,
        responseTimeMs: Date.now() - dbStart,
        error: e instanceof Error ? e.message : 'Unknown error'
      });
      overallStatus = 'down';
      errorMessage = `Database: ${e instanceof Error ? e.message : 'Unknown'}`;
    }

    // Check 2: AI Gateway availability with actual scan
    const aiStart = Date.now();
    try {
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
      if (!LOVABLE_API_KEY) {
        throw new Error('LOVABLE_API_KEY not configured');
      }

      // Make a lightweight AI call to verify gateway is responsive
      const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: AI_MODEL,
          messages: [
            { 
              role: "system", 
              content: "You are a resume analyzer. Respond with a JSON object containing: industry (string), atsScore (number 0-100)." 
            },
            { 
              role: "user", 
              content: `Analyze this resume briefly:\n\n${TEST_RESUME.substring(0, 500)}\n\nRespond only with JSON.` 
            }
          ],
          max_tokens: 100,
          temperature: 0
        }),
      });

      const aiTime = Date.now() - aiStart;
      
      if (!aiResponse.ok) {
        const errorBody = await aiResponse.text();
        throw new Error(`AI Gateway error ${aiResponse.status}: ${errorBody.substring(0, 100)}`);
      }

      const aiResult = await aiResponse.json();
      const hasContent = aiResult.choices?.[0]?.message?.content;
      
      checks.push({
        name: 'ai_gateway',
        passed: !!hasContent,
        responseTimeMs: aiTime,
        error: hasContent ? undefined : 'No content in response'
      });

      if (!hasContent) {
        overallStatus = 'degraded';
        errorMessage = errorMessage || 'AI Gateway: No content in response';
      }
    } catch (e) {
      const aiTime = Date.now() - aiStart;
      checks.push({
        name: 'ai_gateway',
        passed: false,
        responseTimeMs: aiTime,
        error: e instanceof Error ? e.message : 'Unknown error'
      });
      overallStatus = 'down';
      errorMessage = errorMessage || `AI Gateway: ${e instanceof Error ? e.message : 'Unknown'}`;
    }

    // Check 3: Cache system
    const cacheStart = Date.now();
    try {
      const { error } = await supabase.rpc('get_cached_response', {
        p_cache_key: 'heartbeat_test_key',
        p_function_name: 'scan-heartbeat'
      });
      
      checks.push({
        name: 'cache_system',
        passed: !error,
        responseTimeMs: Date.now() - cacheStart,
        error: error?.message
      });
      
      if (error) {
        // Cache error is not critical
        if (overallStatus === 'healthy') overallStatus = 'degraded';
      }
    } catch (e) {
      checks.push({
        name: 'cache_system',
        passed: false,
        responseTimeMs: Date.now() - cacheStart,
        error: e instanceof Error ? e.message : 'Unknown error'
      });
    }

    // Check 4: Metrics logging system
    const metricsStart = Date.now();
    try {
      const { error } = await supabase.from('scan_metrics').select('id').limit(1);
      checks.push({
        name: 'metrics_system',
        passed: !error,
        responseTimeMs: Date.now() - metricsStart,
        error: error?.message
      });
    } catch (e) {
      checks.push({
        name: 'metrics_system',
        passed: false,
        responseTimeMs: Date.now() - metricsStart,
        error: e instanceof Error ? e.message : 'Unknown error'
      });
    }

    // Check 5: job-board refresh liveness. The board serves stale data
    // gracefully, so a wedged refresh pipeline is invisible to every other
    // check — this is what would have caught the 2026-07-12 death loop
    // (WORKER_RESOURCE_LIMIT re-running the same slice for an hour) before
    // a human noticed. The tiered refresh writes refresh_progress on every
    // slice (~every 30-60s while healthy); 45 minutes of silence means the
    // pipeline is down, not merely slow.
    const boardStart = Date.now();
    try {
      // Six of the checks below read whole-table analytics RPCs over the ~570k-row
      // postings table. Awaited one at a time they COST one at a time, and that
      // sum — not any single slow query — is what pushed a run of entirely-passing
      // checks to 77s and tripped the 60s "High latency" rule on itself.
      //
      // They are independent reads, so fire them all HERE, concurrently, and let
      // each check below await the one it needs. The block then costs the slowest
      // RPC (~6s worst case) instead of the sum of all six (~36s), while every
      // check keeps its original position, its original data, and the original
      // overallStatus/errorMessage precedence — this changes WHEN the queries run,
      // never what any check concludes.
      //
      // Each promise is already deadline-bounded and already catches, so a slow or
      // unmigrated RPC resolves to { data: null } and its check skips silently
      // rather than delaying — or failing — anything else.
      //
      // The deadline is deliberately GENEROUS (10s, vs the 2.5s the same queries
      // get on the user-facing status path). A timed-out RPC costs us the check,
      // and a heartbeat that runs fast by quietly checking less is the same lie in
      // the other direction. Concurrency is what buys the patience: ten seconds of
      // overlap is still under a third of the 30s healthy budget, where six
      // sequential 10s waits would be a minute on their own. Running them together
      // is also cheaper for Postgres, not dearer — they all scan the same postings
      // table, so concurrent seq-scans share physical reads instead of repeating them.
      const RPC_MS = 10_000;
      const freshnessP = rpcWithin(supabase.rpc('get_freshness_stats'), RPC_MS);
      const storageP = rpcWithin(supabase.rpc('get_storage_footprint'), RPC_MS);
      const staleBoardsP = rpcWithin(supabase.rpc('get_stale_board_count'), RPC_MS);
      // Read LIVE, unlike the ghost stats below, because this one no longer
      // aggregates: since the rollup precompute it reads a single row and
      // measures 0.27-1.35s (three calls, 2026-08-08) against the 20s that
      // made it unreadable before. The note below about not reading these
      // live is still correct for get_ghost_job_index_stats and no longer
      // correct for this one.
      const dateCovP = rpcWithin(supabase.rpc('get_date_coverage'), RPC_MS);
      const dbSizeP = rpcWithin(supabase.rpc('get_db_size_stats'), RPC_MS);
      // THE PLAN SIZE IS OPERATOR STATE, NOT A CONSTANT. Both disk checks
      // hard-coded 8GB and kept alarming at "90%" for weeks after the disk was
      // widened to 12GB — a monitor crying wolf about a limit that no longer
      // existed. The row is seeded by 20260827220000 and updated by hand when
      // the tier changes; a missing row falls back to 8 so a fresh environment
      // still alarms early rather than never.
      const planDiskP = supabase
        .from('job_board_meta').select('v').eq('k', 'plan_disk_gb').maybeSingle();

      // ghost-index stats and per-vendor date coverage are NOT read live here.
      // Both carry `SET statement_timeout = '20s'` and both exceed it against
      // the ~570k-row postings table, so each call burned the full 20s and then
      // threw — which the surrounding `catch { /* RPC not applied yet */ }`
      // swallowed, deleting the check. That comment was true when written and
      // is not any more: the RPCs exist, they just can't finish. Two aborted
      // 20s queries plus a third (stale-board count) is ~60s of the 82.6s this
      // endpoint was measured taking while reporting everything green.
      //
      // The project already solved this: refresh_stats_cache() precomputes both
      // under cron — its own migration notes the combined compute is ~35s, which
      // is precisely why no request path should be running it — and parks the
      // result in job_board_meta. Reading that row is a single indexed lookup.
      // The heartbeat is a monitor; it should observe the numbers the platform
      // publishes, not recompute them more expensively than the pages do.
      const statsCacheP = supabase
        .from('job_board_meta').select('v, updated_at').eq('k', 'stats_cache').maybeSingle();

      // /pay-transparency is served entirely from this row — the two aggregates
      // behind it (14.9s and 4.8s, measured) are cron-only, so a stalled refresh
      // does not slow the page down, it makes the page publish old numbers with
      // no outward sign. Same class as stats_cache, and until now nothing
      // watched it: the public page could sit on a week-old measurement while
      // this endpoint reported healthy.
      const transparencyCacheP = supabase
        .from('job_board_meta').select('updated_at').eq('k', 'transparency_cache').maybeSingle();

      const { data: prog, error } = await supabase
        .from('job_board_meta')
        .select('updated_at')
        .eq('k', 'refresh_progress')
        .maybeSingle();
      const ageMin = prog ? Math.round((Date.now() - new Date(prog.updated_at).getTime()) / 60000) : null;
      const stalled = error != null || ageMin === null || ageMin > 45;
      checks.push({
        name: 'job_board_refresh',
        passed: !stalled,
        responseTimeMs: Date.now() - boardStart,
        error: stalled ? (error?.message ?? `no refresh slice for ${ageMin ?? '∞'} min — postings going stale; check job-board function logs for WORKER_RESOURCE_LIMIT`) : undefined,
      });
      if (stalled) {
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || `Job board refresh stalled (${ageMin ?? 'no meta'} min since last slice)`;
        // Self-heal: an independent third recovery path beyond the two refresh
        // crons. On a detected stall, deliver a refresh kick from here. Short
        // timeout — we only need to RESTART a dead pipeline, not await the slice;
        // the slice lock no-ops the kick if a slice/chain is already running, and
        // the refresh self-chains once started. Best-effort; we still alert.
        try {
          const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
          const ac = new AbortController();
          const to = setTimeout(() => ac.abort(), 2500);
          await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/job-board`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${svc}`, apikey: svc },
            body: JSON.stringify({ action: 'refresh' }),
            signal: ac.signal,
          }).catch(() => {});
          clearTimeout(to);
          console.log('[HEARTBEAT] job-board refresh stalled — fired self-heal kick');
        } catch { /* best-effort recovery; the alert above still fires */ }
      }

      // Freshness SLA: the slice check above proves the pipeline is MOVING,
      // but not that the whole catalog is actually fresh. The cold tail is
      // fully re-verified once per rotation; if that rotation hasn't
      // completed within the SLA, cold-tail postings are going stale even
      // though slices keep ticking. This measures freshness directly.
      const { data: rot, error: rotErr } = await supabase
        .from('job_board_meta').select('v, updated_at').eq('k', 'cold_rotation').maybeSingle();
      const rotV = (rot?.v ?? {}) as { completedAt?: string; coldBoards?: number };
      const rotAgeMin = rot ? Math.round((Date.now() - new Date(rotV.completedAt ?? rot.updated_at).getTime()) / 60000) : null;
      // The SLA scales with the catalog. Wall-time-safe slices cap re-verification
      // throughput at ~one 80-board hop/min (measured ~0.95 min/hop in production),
      // so an honestly larger board takes proportionally longer to fully re-verify —
      // that is growth, not staleness. Alert only when the wrap runs well past what
      // the catalog size can explain (a genuine stall: wedged pipeline, mass board
      // death, or a dead cron). Users are separately protected from stale listings
      // by the airtight 30-day read cap and live verify-on-apply, so a longer honest
      // rotation is a freshness nuance, never a stale board.
      const coldBoards = typeof rotV.coldBoards === 'number' && rotV.coldBoards > 0 ? rotV.coldBoards : 8700;
      // THE 0.95 MIN/HOP CONSTANT WAS A HOPE, NOT A MEASUREMENT. At 31.5k cold
      // boards it promised a 375-min wrap and a 525-min SLA — while the
      // measured healthy rotation rate (46 boards/min, the benchmark the
      // fast-lane incident itself established) takes ~685 min. A HEALTHY
      // rotation breached the SLA structurally, so this check sat red for
      // weeks and taught people to ignore it — the same disease as the disk
      // alarm that divided by a plan we are not on.
      //
      // The SLA is anchored on what the LAST rotation measurably took
      // (wrapMin, stamped by the wrap writer since board .41): 1.5x the last
      // real duration flags a genuine slowdown. The old formula remains only
      // as the fallback until one measured duration exists. Two backstops keep
      // measurement from normalizing decay: the floor never drops below the
      // formula's own expectation (a fast board stays held to at least that),
      // and a hard 24h ceiling means no history of slow wraps can ever excuse
      // a rotation slower than daily — the absolute promise the 30-day window
      // and verify-on-apply do not cover on their own.
      // The fallback's per-hop constant is the MEASURED benchmark now, not the
      // 0.95-min hope: 46 cold boards/min was measured twice (the fast-lane
      // incident, and re-confirmed 2026-08-27 at 52.6/min in a pure cold-phase
      // window). With the old constant the no-measurement fallback promised a
      // 525-min SLA against healthy 685-960-min wraps — so any pass that
      // failed to stamp wrapMin (first wrap, or a failed pre-wrap read, which
      // the writer now logs) rearmed the structurally-red alarm this change
      // exists to kill.
      const expectedWrapMin = Math.ceil(coldBoards / 46);
      const lastWrapMin = typeof (rotV as { wrapMin?: number }).wrapMin === 'number' && (rotV as { wrapMin?: number }).wrapMin! > 0
        ? (rotV as { wrapMin?: number }).wrapMin!
        : null;
      const slaBasis = lastWrapMin !== null ? Math.ceil(lastWrapMin * 1.5) : Math.ceil(expectedWrapMin * 1.5);
      // max() keeps the benchmark expectation as a FLOOR: one freakishly fast
      // wrap must not ratchet the SLA down and then alarm on the next normal
      // one. min() keeps the daily ceiling: no history of slow wraps excuses
      // slower-than-daily.
      const COLD_ROTATION_SLA_MIN = Math.min(1440, Math.max(120, Math.ceil(expectedWrapMin * 1.5), slaBasis));
      const rotStale = rotAgeMin !== null && rotAgeMin > COLD_ROTATION_SLA_MIN;
      // AN UNREADABLE ROTATION IS NOT A FRESH ONE. `rotAgeMin` is null whenever
      // the cold_rotation row is missing or the read failed, and `rotStale` was
      // therefore false — so the check reported PASSED on exactly the two states
      // it exists to catch. A monitor that cannot fail is not a monitor: this is
      // the same shape as the alert thresholds that read a 0% success rate as
      // 100%. Unknown is reported as unknown.
      const rotUnknown = !!rotErr || rot === null;
      checks.push({
        name: 'job_board_freshness',
        passed: !rotStale && !rotUnknown,
        responseTimeMs: 0,
        error: rotUnknown
          ? `cold_rotation state unreadable (${rotErr?.message?.slice(0, 120) ?? 'row absent'}) — freshness cannot be evaluated`
          : rotStale ? `cold-tail last fully re-verified ${rotAgeMin} min ago (SLA ${COLD_ROTATION_SLA_MIN}, ${lastWrapMin !== null ? `1.5x the last measured wrap of ${lastWrapMin} min` : 'formula fallback — no measured wrap yet'}) — long-tail postings may be stale; check for failing boards or too-slow rotation` : undefined,
      });
      if (rotUnknown) {
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || 'Job board freshness cannot be evaluated (cold_rotation unreadable)';
      }
      if (rotStale) {
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || `Job board cold-tail freshness behind SLA (${rotAgeMin} min)`;
      }

      // Honest-claim guard: the adaptive rotation SLA above scales with the
      // catalog, so it FOLLOWS slow drift instead of flagging it (rotation
      // slipped 1h→3h across rung 3 with zero alarms). The public claim is
      // fixed — "every feed re-verified within a few hours" — so this check is
      // an ABSOLUTE bound on the measured stamp-age distribution: P95 past 5h
      // means the published claim is about to be false. Skips silently until
      // the freshness-stats migration lands.
      // AN UNWATCHED PUBLIC CLAIM IS AN INCIDENT, NOT A SKIP. This used to skip
      // silently when the RPC returned nothing, on the reasoning that the
      // freshness-stats migration might not have landed yet. That reasoning
      // expired the day the migration landed, and on 2026-08-06 the skip path
      // started firing permanently for a completely different reason — the RPC
      // had grown past its own 20s statement timeout, so it failed on EVERY
      // call. The check vanished from the heartbeat output entirely and nothing
      // was watching the published "re-verified within a few hours" claim. The
      // one thing a monitor must never do quietly is stop monitoring.
      try {
        const fRes = await freshnessP;
        const fWhy = unanswered(fRes, 'get_freshness_stats', RPC_MS);
        if (fWhy) skip('job_board_board_freshness', fWhy);
        const { data: fRows } = fRes;
        const f = Array.isArray(fRows) ? (fRows[0] as { boards?: number; p50_min?: number; p95_min?: number } | undefined) : undefined;
        if (!f || typeof f.p95_min !== 'number') {
          // withDeadline collapses timeout, error and empty into { data: null },
          // so the cause can't be named here — say what IS known, which is that
          // the measurement is missing and the claim is therefore unwatched.
          checks.push({
            name: 'job_board_freshness_claim',
            passed: false,
            responseTimeMs: 0,
            error: 'get_freshness_stats returned no usable measurement (timed out, errored, or empty) — the published freshness promise is currently UNWATCHED; check the job-board-stats-rollup cron',
          });
          if (overallStatus === 'healthy') overallStatus = 'degraded';
          errorMessage = errorMessage || 'Board freshness claim unwatched (get_freshness_stats unavailable)';
        } else if ((f.boards ?? 0) <= 1000) {
          skip('job_board_freshness_claim', `only ${f.boards ?? 0} stamped boards — too thin a sample to judge the published claim`);
        }
        if (f && typeof f.p95_min === 'number' && (f.boards ?? 0) > 1000) {
          // MIRRORS THE PUBLISHED COPY, and moves when it moves. The copy used
          // to promise "most feeds re-verified within a few hours"; the
          // measured median reached 5.6h and P95 13.6h, so the sentence was
          // false and this check was permanently red about it. The copy now
          // promises around-the-clock rotation with the live median/P95
          // PUBLISHED on the Ghost Job Index — so the bounds here guard that
          // promise: the median must stay a same-day number (several passes a
          // day) and no feed's P95 may exceed daily. If the public sentence
          // ever names a number again, these constants move with it — the
          // claim-drift rule.
          const CLAIM_MEDIAN_MIN = 480;  // "rotates around the clock" — median at least ~3x/day
          const CLAIM_P95_MIN = 1440;    // absolute: no tail slower than daily
          const claimBreach = f.p95_min > CLAIM_P95_MIN ||
            (typeof f.p50_min === 'number' && f.p50_min > CLAIM_MEDIAN_MIN);
          checks.push({
            name: 'job_board_freshness_claim',
            passed: !claimBreach,
            responseTimeMs: 0,
            error: claimBreach
              ? `measured re-verification median ${Math.round(f.p50_min ?? 0)}m / P95 ${(f.p95_min / 60).toFixed(1)}h — outside the published "around the clock" promise (median bound ${CLAIM_MEDIAN_MIN}m, P95 bound ${CLAIM_P95_MIN}m); raise rotation throughput or fix failing slices`
              : undefined,
          });
          if (claimBreach) {
            if (overallStatus === 'healthy') overallStatus = 'degraded';
            errorMessage = errorMessage || `Board freshness P95 ${(f.p95_min / 60).toFixed(1)}h exceeds the published claim`;
          }
        }
      } catch (e) {
        // Same rule on the throw path: unreachable stats mean the claim is
        // unwatched, and that has to be visible.
        checks.push({
          name: 'job_board_freshness_claim',
          passed: false,
          responseTimeMs: 0,
          error: `get_freshness_stats unavailable (${e instanceof Error ? e.message : 'unknown error'}) — the published freshness promise is currently UNWATCHED`,
        });
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || 'Board freshness claim unwatched (get_freshness_stats unavailable)';
      }

      // Ground-truth accuracy: the daily audit samples ~100 served postings and
      // confirms each live at the vendor source. A dip below threshold means the
      // pipeline is serving dead listings RIGHT NOW — the one failure users feel
      // most and every other check can miss.
      const { data: audit } = await supabase
        .from('job_board_meta').select('v, updated_at').eq('k', 'audit').maybeSingle();
      if (audit) {
        const aV = (audit.v ?? {}) as { accuracyPct?: number | null; live?: number; gone?: number; at?: string; byVendor?: Record<string, { sampled?: number; live?: number; gone?: number; accuracyPct?: number | null }> };
        const auditAgeH = Math.round((Date.now() - new Date(audit.updated_at).getTime()) / 3600_000);
        // Per-vendor floor: the stratified audit samples every vendor, so one
        // broken vendor can't hide inside a healthy blended number. A vendor
        // with a real sample below 80% is an incident even at 99% overall.
        //
        // "Real sample" means DECIDED probes (live+gone), not drawn ids, and at
        // least MIN_VENDOR_DECIDED of them. The old gate was `sampled >= 5`,
        // which the stratified draw clears with 6 — and at 6, two dead listings
        // read as 66.7% and paged. That fired on 2026-08-06 for workday and the
        // cause was our own probe, not the vendor. The audit now re-draws any
        // vendor that looks low, so a vendor under the floor on a full sample is
        // a real break; one that never got deepened is not evidence yet.
        //
        // Known gap, accepted: a vendor whose ENTIRE corpus is smaller than this
        // can never reach the threshold and so can never page on its own. Every
        // vendor currently on the board carries thousands of postings, and the
        // 97% overall SLA still covers them, so the alternative — a floor that
        // fires on single-digit samples — costs more than it catches.
        const MIN_VENDOR_DECIDED = 20;
        const badVendors = Object.entries(aV.byVendor ?? {})
          .filter(([, b]) => ((b.live ?? 0) + (b.gone ?? 0)) >= MIN_VENDOR_DECIDED && typeof b.accuracyPct === 'number' && b.accuracyPct < 80)
          .map(([v, b]) => `${v} ${b.accuracyPct}% of ${(b.live ?? 0) + (b.gone ?? 0)}`);
        const lowOverall = typeof aV.accuracyPct === 'number' && aV.accuracyPct < 97;
        const lowAccuracy = lowOverall || badVendors.length > 0;
        const auditStale = auditAgeH > 48;
        checks.push({
          name: 'job_board_accuracy',
          passed: !lowAccuracy && !auditStale,
          responseTimeMs: 0,
          error: lowAccuracy
            ? (badVendors.length > 0
                ? `ground-truth audit: vendor(s) below the 80% floor — ${badVendors.join(', ')} (overall ${aV.accuracyPct}%) — that vendor is serving dead listings; check its feed/fetcher`
                : `ground-truth audit: only ${aV.accuracyPct}% of sampled postings confirmed live at the source (${aV.live}/${(aV.live ?? 0) + (aV.gone ?? 0)}) — the board is serving dead listings; check refresh/prune`)
            : auditStale ? `ground-truth audit hasn't run in ${auditAgeH}h — accuracy unmeasured; check the job-board-audit cron` : undefined,
        });
        if (lowAccuracy || auditStale) {
          if (overallStatus === 'healthy') overallStatus = 'degraded';
          // Name the breach that actually fired. This line read "Board accuracy
          // 97.8% (below 97% SLA)" on 2026-08-06 — self-contradictory, because a
          // per-vendor breach was being reported in the overall-SLA's words, and
          // that summary is what the alert email leads with.
          errorMessage = errorMessage || (
            lowOverall ? `Board accuracy ${aV.accuracyPct}% (below 97% SLA)`
              : badVendors.length > 0 ? `Board accuracy: vendor(s) below the 80% floor — ${badVendors.join(', ')} (overall ${aV.accuracyPct}%)`
              : 'Board accuracy audit stale');
        }
      }

      // Published-stat plausibility: the Ghost Job Index's headline median once
      // collapsed to 2.8d because it measured OUR discovery age, not the
      // company's stated post date — a user spotted it before we did. With a
      // 30-day cap, a stated-date median outside 4-25d means a basis or
      // ingestion skew; a stated-date coverage collapse means a vendor parser
      // stopped extracting dates. Catch both before the public page does.
      // One read serves both cache-backed checks below. Staleness is treated as
      // absence: the cron refresh is hourly, so a row older than 3h means the
      // numbers no longer describe the board and judging them would be worse
      // than not judging at all — we skip loudly instead of alerting on stale
      // inputs (and the skip reason names the stall, which is the real fault).
      const { data: scRow } = await statsCacheP;
      const scAgeMin = scRow ? Math.round((Date.now() - new Date(scRow.updated_at).getTime()) / 60000) : null;
      const scFresh = scAgeMin !== null && scAgeMin <= 180;
      const statsCache = (scFresh ? (scRow?.v ?? null) : null) as
        | { ghost_stats?: Record<string, unknown>; date_coverage?: Array<Record<string, unknown>> }
        | null;
      const scWhy = scRow === null || scRow === undefined
        ? 'stats_cache row missing — refresh_stats_cache() has never run'
        : `stats_cache is ${scAgeMin} min old (hourly cron; 180 min bound) — the refresh-stats-cache job looks stalled`;

      // A SKIP THAT NEVER ENDS IS NOT A HICCUP.
      //
      // Skips deliberately do not fail the run — see the note beside `skip`:
      // an hourly job missing a tick or two is normal and crying wolf is worse
      // than silence. That reasoning holds for a transient stall and breaks
      // completely for a permanent one.
      //
      // MEASURED 2026-08-07: stats_cache was 6,163 minutes old — 4.3 days, 34x
      // the bound — because get_ghost_job_index_stats() had begun timing out
      // (57014 at 60s, reproduced live) as the corpus grew past 590k postings.
      // Two checks had therefore been blind for four days while this endpoint
      // reported `healthy`, and the skip reason said "looks stalled" the whole
      // time. Nobody was lied to by a wrong number; they were lied to by a
      // green light over an instrument that had stopped reading.
      //
      // WAS 720 (12 hours = four missed refreshes). Lived through its first
      // real stall 2026-08-12: stats_cache sat dead for SIX HOURS — 17:12 to
      // 01:12 — and this endpoint reported healthy the entire time, because six
      // hours is "still just a hiccup" under a 12-hour bar. The scheduler
      // stalled twice that same day. A watchdog that stays green through a
      // six-hour outage of the thing it watches is a green light over a stopped
      // instrument, which is the exact failure the comment above records.
      //
      // 240, not 180: the freshness bound elsewhere in this endpoint is 180
      // minutes, and a degrade threshold EQUAL to the freshness bound alarms
      // on a cache that is merely at the stale edge — the existing hiccup
      // test (`toBeGreaterThan(180)`) exists precisely to block that. Four
      // hours = three consecutive missed hourly refreshes: past any hiccup,
      // and it would have caught the six-hour stall at hour four instead of
      // never.
      const SC_STALL_DEGRADE_MIN = 240;
      if (scAgeMin === null || scAgeMin > SC_STALL_DEGRADE_MIN) {
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage
          ?? `${scWhy} — two board checks have been unevaluated for ${scAgeMin === null ? 'as long as this row has been missing' : `${Math.round(scAgeMin / 60)}h`}`;
      }

      // The page names its own measurement time now, so a stale cache is
      // honest rather than a lie. It is still a stalled job, and the bound is
      // the same 240 minutes stats_cache uses — four missed hourly ticks, one
      // number for both caches rather than two to keep in step.
      try {
        const tcRes = await transparencyCacheP;
        const tcRow = tcRes.data as { updated_at?: string } | null;
        const tcAgeMin = tcRow?.updated_at
          ? Math.round((Date.now() - new Date(tcRow.updated_at).getTime()) / 60000)
          : null;
        if (tcRes.error) {
          skip('job_board_transparency_cache', tcRes.error.message);
        } else if (tcAgeMin === null) {
          skip('job_board_transparency_cache', 'transparency_cache row missing — refresh_transparency_cache() has never run');
        } else {
          const tcStale = tcAgeMin > SC_STALL_DEGRADE_MIN;
          checks.push({
            name: 'job_board_transparency_cache',
            passed: !tcStale,
            responseTimeMs: 0,
            error: tcStale
              ? `transparency_cache is ${tcAgeMin} min old (hourly cron at :37; ${SC_STALL_DEGRADE_MIN} min bound) — /pay-transparency is publishing a ${Math.round(tcAgeMin / 60)}h-old measurement`
              : undefined,
          });
          if (tcStale) {
            if (overallStatus === 'healthy') overallStatus = 'degraded';
            errorMessage = errorMessage ?? `transparency-cache-hourly looks stalled: ${tcAgeMin} min since the last refresh`;
          }
        }
      } catch (e) {
        skip('job_board_transparency_cache', e instanceof Error ? e.message : 'unreadable transparency_cache');
      }

      try {
        const g = (statsCache?.ghost_stats ?? null) as
          { median_days_open?: number; posted_coverage_pct?: number } | null;
        if (!g) skip('job_board_stat_plausibility', scWhy);
        if (g && typeof g.median_days_open === 'number') {
          const implausibleMedian = g.median_days_open < 4 || g.median_days_open > 25;
          const coverageCollapse = typeof g.posted_coverage_pct === 'number' && g.posted_coverage_pct < 50;
          checks.push({
            name: 'job_board_stat_plausibility',
            passed: !implausibleMedian && !coverageCollapse,
            responseTimeMs: 0,
            error: implausibleMedian
              ? `Ghost Index median posting age is ${g.median_days_open}d — implausible under the 30-day cap; check the median's date basis and recent ingestion`
              : coverageCollapse ? `only ${g.posted_coverage_pct}% of postings carry a company-stated post date (was ~77%) — a vendor date parser likely regressed` : undefined,
          });
          if (implausibleMedian || coverageCollapse) {
            if (overallStatus === 'healthy') overallStatus = 'degraded';
            errorMessage = errorMessage || `Ghost Index stat plausibility: median ${g.median_days_open}d, stated-date coverage ${g.posted_coverage_pct ?? '?'}%`;
          }
        } else if (g) {
          skip('job_board_stat_plausibility', 'stats_cache holds no median_days_open — get_ghost_job_index_stats returned nothing on the last cron run');
        }
      } catch (e) {
        skip('job_board_stat_plausibility', e instanceof Error ? e.message : 'unreadable stats_cache');
      }

      // Label integrity: the daily audit cross-checks our experience_band and
      // remote labels against each posting's own text. A contradiction rate
      // above 15% means the detector is mislabeling a filterable field — users
      // filter on claims the postings themselves dispute. Requires a MEANINGFUL
      // sample per band: the 300-row audit only lands ~10-15 entry-band rows,
      // and at n=11 one posting swings the rate 9 points — so a band must have
      // ≥30 checked AND ≥5 absolute contradictions before its rate can flag,
      // or the check fires on pure sampling noise (2/11 = 18% is not a signal).
      if (audit) {
        const la = ((audit.v ?? {}) as { labelAudit?: { entryChecked?: number; entryContradicted?: number; remoteChecked?: number; remoteContradicted?: number } }).labelAudit;
        if (la) {
          const MIN_BAND = 30, MIN_HITS = 5, RATE = 0.15;
          const bandBad = (checked?: number, hits?: number) =>
            (checked ?? 0) >= MIN_BAND && (hits ?? 0) >= MIN_HITS && (hits ?? 0) / (checked ?? 1) > RATE;
          const entryBad = bandBad(la.entryChecked, la.entryContradicted);
          const remoteBad = bandBad(la.remoteChecked, la.remoteContradicted);
          const bad = entryBad || remoteBad;
          // Only emit the check when at least one band had a judgeable sample,
          // so a thin-sample day is silent rather than a spurious pass/fail.
          if ((la.entryChecked ?? 0) >= MIN_BAND || (la.remoteChecked ?? 0) >= MIN_BAND) {
            const entryPct = Math.round(100 * (la.entryContradicted ?? 0) / Math.max(la.entryChecked ?? 1, 1));
            const remotePct = Math.round(100 * (la.remoteContradicted ?? 0) / Math.max(la.remoteChecked ?? 1, 1));
            checks.push({
              name: 'job_board_label_integrity',
              passed: !bad,
              responseTimeMs: 0,
              error: bad
                ? `label audit: entry ${entryPct}% (${la.entryContradicted}/${la.entryChecked}) state 3+ years, remote ${remotePct}% (${la.remoteContradicted}/${la.remoteChecked}) state on-site — tighten the detector; demotions only patch sampled rows`
                : undefined,
            });
            if (bad && overallStatus === 'healthy') {
              overallStatus = 'degraded';
              errorMessage = errorMessage || 'Board label integrity: contradiction rate above 15%';
            }
          }
        }
      }

      // One resolution of the plan row for both disk checks. Clamped to a sane
      // range: a fat-fingered 0 or 1200 in the meta row must not disable the
      // one alarm that catches out-of-disk.
      const planDiskGb = (() => {
        let val: number | null = null;
        return async (): Promise<number> => {
          if (val !== null) return val;
          try {
            const { data } = await planDiskP;
            const gb = Number((data?.v as { gb?: number } | null)?.gb);
            val = Number.isFinite(gb) && gb >= 1 && gb <= 512 ? gb : 8;
          } catch { val = 8; }
          return val;
        };
      })();

      // Storage headroom: the scale program pushes the corpus past 300k
      // postings on the plan disk. Alert at 75% database usage — the one
      // failure mode that takes every feature down at once is out-of-disk.
      try {
        const sfRes = await storageP;
        const sfWhy = unanswered(sfRes, 'get_storage_footprint', RPC_MS);
        if (sfWhy) skip('job_board_storage', sfWhy);
        const { data: sf } = sfRes;
        const row = Array.isArray(sf) ? sf[0] : sf;
        if (row && typeof row.db_bytes === 'number') {
          const planGb = await planDiskGb();
          const usedPct = Math.round(100 * row.db_bytes / (planGb * 1024 ** 3));
          const tight = usedPct >= 75;
          checks.push({
            name: 'job_board_storage',
            passed: !tight,
            responseTimeMs: 0,
            error: tight
              ? `database at ${usedPct}% of the ${planGb}GB plan (postings ${Math.round(row.postings_bytes / 1024 ** 2)}MB, closures ${Math.round(row.closures_bytes / 1024 ** 2)}MB) — upgrade the plan or lower the corpus governor before ingest stalls`
              : undefined,
          });
          if (tight && overallStatus === 'healthy') {
            overallStatus = 'degraded';
            errorMessage = errorMessage || `Database storage at ${usedPct}% of plan`;
          }
        }
      } catch (e) {
        skip('job_board_storage', e instanceof Error ? e.message : 'get_storage_footprint unavailable');
      }

      // Per-vendor date-parser canary: a vendor whose stated-date coverage
      // collapses means its date mapping regressed (the Lever evergreen bug
      // was found by hand; this catches the next one).
      //
      // TWO POPULATIONS, TWO QUESTIONS. This check used to exempt bamboohr,
      // rippling, pinpoint and workday outright, reasoning that their feeds
      // carry no dates so a low percentage is expected rather than broken.
      // That is true of the FEED and false of the POSTING: bamboohr and
      // rippling are dated after ingest by the posted-date backfill, from
      // their detail endpoints. So the vendors whose dates depend entirely on
      // that sweep were the only ones nothing watched — and on 2026-08-08
      // bamboohr sat at 23% dated (34,211 undated) and rippling at 19%
      // (10,121) with every check green, because a day of board merges
      // outran a sweep that re-arms weekly.
      //
      // Feed-dated vendors are still judged on percentage: a collapse means a
      // parser regressed. Backfill-dated vendors are judged on BACKLOG SIZE
      // instead, which is the thing that actually goes wrong for them — the
      // sweep falling behind intake. Percentage would be the wrong test there:
      // it is expected to sag right after a merge and to recover, and it says
      // nothing about how many postings are affected.
      //
      // pinpoint stays exempt and that is now a verified fact rather than an
      // assumption: its postings.json was inspected on 2026-08-08 and carries
      // no created/published field of any kind, so its 6,110 undated rows are
      // honest and no sweep can fix them.
      const BACKFILL_DATED = ['bamboohr', 'rippling', 'greenhouse'];
      const FEED_UNDATED = ['pinpoint', 'workday'];
      // Backlog that should trigger the growth re-arm in job-board, with room
      // for it to act before this complains. The sweep re-arms at +5,000 above
      // its post-sweep floor; alarming at 25,000 means several missed re-arms,
      // not one busy afternoon.
      const BACKLOG_ALARM = 25_000;
      //
      // READ FROM THE ROLLUP, NOT FROM stats_cache. This check was wired to
      // stats_cache, and on the very deploy that added the backlog alarm it
      // did not run at all: stats_cache had been frozen for 7,651 minutes
      // (5.3 days) while the rollup behind get_date_coverage was current to
      // the half-hour. So the alarm built to notice the dating sweep falling
      // behind was itself unwatched, for the oldest reason in this codebase —
      // it was reading an instrument that had stopped.
      //
      // The rollup is the same data the sweep's own re-arm reads, which is the
      // point: the alarm and the mechanism it watches now agree on a source.
      // stats_cache stays as the fallback, so a rollup outage degrades to the
      // previous behaviour rather than to nothing.
      try {
        const covRes = await dateCovP;
        const covWhy = unanswered(covRes, 'get_date_coverage', RPC_MS);
        if (covWhy) skip('job_board_date_coverage', covWhy);
        const { data: covLive } = covRes;
        const cov = (Array.isArray(covLive) && covLive.length > 0)
          ? covLive as Array<Record<string, unknown>>
          : (statsCache?.date_coverage ?? null);
        if (!Array.isArray(cov) || cov.length === 0) skip('job_board_date_coverage', cov ? 'date_coverage is empty in both the rollup and stats_cache' : scWhy);
        if (Array.isArray(cov) && cov.length > 0) {
          const rows = cov as Array<{ source: string; total: number; dated: number }>;
          const broken = rows
            .filter((r) => !BACKFILL_DATED.includes(r.source) && !FEED_UNDATED.includes(r.source) && Number(r.total) >= 1000)
            .map((r) => ({ source: r.source, pct: Math.round(100 * Number(r.dated) / Math.max(Number(r.total), 1)) }))
            .filter((r) => r.pct < 50);
          const backlog = rows
            .filter((r) => BACKFILL_DATED.includes(r.source))
            .reduce((n, r) => n + Math.max(0, Number(r.total) - Number(r.dated)), 0);
          const behind = backlog >= BACKLOG_ALARM;
          const reasons = [
            ...broken.map((b) => `${b.source} ${b.pct}%`),
            ...(behind ? [`posted-date backfill ${backlog.toLocaleString()} rows behind`] : []),
          ];
          checks.push({
            name: 'job_board_date_coverage',
            passed: reasons.length === 0,
            responseTimeMs: 0,
            error: reasons.length
              ? `date coverage: ${reasons.join(', ')} — a percentage collapse means that vendor's date mapping regressed; a backfill backlog means postings are served with no stated age at all`
              : undefined,
          });
          if (reasons.length && overallStatus === 'healthy') {
            overallStatus = 'degraded';
            errorMessage = errorMessage || `Vendor date coverage: ${[...broken.map((b) => b.source), ...(behind ? ['backfill backlog'] : [])].join(', ')}`;
          }
        }
      } catch (e) {
        skip('job_board_date_coverage', e instanceof Error ? e.message : 'unreadable stats_cache');
      }

      // Verification ceiling: boards that still hold live postings but weren't
      // re-verified in 24h — a widening count means a cursor/selection gap the
      // 48h sweep is about to start deleting around.
      try {
        const staleRes = await staleBoardsP;
        const staleWhy = unanswered(staleRes, 'get_stale_board_count', RPC_MS);
        if (staleWhy) skip('job_board_stale_boards', staleWhy);
        const { data: staleCount } = staleRes;
        if (typeof staleCount === 'number') {
          // Bootstrap guard: right after the verifications table ships, EVERY board
          // is unstamped (~10k) until the rotation stamps them over ~3h — that's
          // day-zero, not a gap. Total-pipeline death is owned by the refresh/
          // freshness checks above, so skipping the near-full-catalog case is safe.
          const bootstrapping = staleCount > 8000;
          const tooMany = !bootstrapping && staleCount > 300; // transient stragglers are normal; a wide gap is not
          checks.push({
            name: 'job_board_verification_ceiling',
            passed: !tooMany,
            responseTimeMs: 0,
            error: tooMany ? `${staleCount} boards with live postings not re-verified in 24h — rotation gap; their postings sweep in 48h` : undefined,
          });
          if (tooMany) {
            if (overallStatus === 'healthy') overallStatus = 'degraded';
            errorMessage = errorMessage || `${staleCount} boards behind the verification ceiling`;
          }
        }
      } catch (e) {
        skip('job_board_verification_ceiling', e instanceof Error ? e.message : 'get_stale_board_count unavailable');
      }

      // THE PUBLISHED FRESHNESS CAP, MEASURED. The board page states a
      // "30-day freshness cap" as a fact about what it serves. It was false:
      // ~20,600 servable postings sat past the cap on 2026-08-24, the oldest
      // dated 2014, because a delete/re-insert loop put them back faster than
      // the sweep removed them. A published promise with no monitor is a
      // promise that goes false quietly — this is the monitor.
      try {
        const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString();
        const { count: staleCount, error: staleErr } = await supabase
          .from('job_board_postings')
          .select('id', { count: 'exact', head: true })
          .is('missing_since', null)
          .lt('effective_posted', cutoff);
        if (staleErr) throw staleErr;
        // A trickle is the sweep's normal lag between passes; a wall means the
        // cap is not being enforced and the public claim is false.
        const overCap = (staleCount ?? 0) > 2000;
        checks.push({
          name: 'job_board_freshness_cap',
          passed: !overCap,
          responseTimeMs: 0,
          error: overCap
            ? `${staleCount} servable postings are older than the published 30-day freshness cap — the board page states that cap as a fact, so it is currently false; check the aged-out tombstone and the pass-end freshness sweep`
            : undefined,
        });
        if (overCap && overallStatus === 'healthy') {
          overallStatus = 'degraded';
          errorMessage = errorMessage || `${staleCount} postings past the published freshness cap`;
        }
      } catch (e) {
        skip('job_board_freshness_cap', e instanceof Error ? e.message : 'stale-count query failed');
      }

      // Host reachability: feed membership is blind to host rot — 23,347
      // servable postings carry apply URLs on employer-owned hosts, and when
      // one lapses the feed keeps listing jobs behind a button that cannot
      // load (the 233-posting Recruitee vanity-domain incident, as a class).
      // The hourly host sweep publishes an aggregate rollup per full cycle;
      // this reads it. Absent row = the sweep hasn't completed a first cycle
      // yet — skip, don't fail. Present-but-old = the cron is wedged.
      try {
        const { data: reach } = await supabase
          .from('job_board_stats_rollup').select('v, computed_at').eq('k', 'reachability').maybeSingle();
        if (!reach) {
          skip('job_board_host_reachability', 'no reachability rollup yet — host sweep has not completed a cycle');
        } else {
          const rv = (reach.v ?? {}) as { hosts_checked?: number; hosts_failing?: number; postings_on_failing?: number };
          const ageH = Math.round((Date.now() - new Date(reach.computed_at).getTime()) / 3600_000);
          // A full cycle is a few hours; 48h without one means the sweep died.
          const stale = ageH > 48;
          // 500 postings is ~2x the Recruitee incident: one flaky mid-size
          // host stays quiet, a real lapse of any substantial employer pages.
          const rotting = (rv.postings_on_failing ?? 0) >= 500;
          checks.push({
            name: 'job_board_host_reachability',
            passed: !rotting && !stale,
            responseTimeMs: 0,
            error: rotting
              ? `${rv.postings_on_failing} postings sit on ${rv.hosts_failing} apply-URL hosts that failed two consecutive sweeps (of ${rv.hosts_checked} checked) — their apply buttons cannot load; host names are in job_board_meta.host_sweep and the function log`
              : stale ? `host reachability rollup is ${ageH}h old — the hourly host-sweep cron has stopped cycling` : undefined,
          });
          if ((rotting || stale) && overallStatus === 'healthy') {
            overallStatus = 'degraded';
            errorMessage = errorMessage || (rotting ? `${rv.postings_on_failing} postings on unreachable apply hosts` : 'host sweep stopped cycling');
          }
        }
      } catch (e) {
        skip('job_board_host_reachability', e instanceof Error ? e.message : 'reachability rollup unreadable');
      }

      // FILTER CONTRACT: the board's core promise is that a filter is never
      // silently ignored — ask for remote roles in the US and every row you get
      // is remote and in the US, or the board honestly returns nothing. That
      // promise has broken twice in code review (the ranked path once dropped
      // work-mode; the fuzzy tier once dropped every filter and served other
      // companies' jobs on a company lander), and both times nothing alerted:
      // the response looked perfectly healthy, it was the ROWS that lied.
      //
      // So this check reads the rows. Three probes, each asserting the
      // constraint on every returned row, and a typo'd company-scoped query —
      // the exact shape of the fuzzy-tier leak. Cheap (the board's own list
      // path, ~1s) and it fails loudly with the offending row named.
      // Full sweep with every filter: scripts/verify-board-search.mjs.
      try {
        const boardUrl = `${supabaseUrl}/functions/v1/job-board`;
        const probe = async (body: Record<string, unknown>) => {
          const r = await fetch(boardUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${supabaseServiceKey}` },
            body: JSON.stringify(body),
            // Tight: list queries measure 1-3s, and this check must never be
            // the reason the heartbeat runs long (2026-07-26: a 17s status
            // action pushed a heartbeat run to 70s and aborted another check).
            signal: AbortSignal.timeout(8_000),
          });
          if (!r.ok) return null;
          const j = await r.json();
          return Array.isArray(j?.jobs) ? j.jobs as Array<Record<string, unknown>> : null;
        };

        const violations: string[] = [];
        let probed = 0, unreachable = 0;
        const check = async (label: string, body: Record<string, unknown>, holds: (j: Record<string, unknown>) => boolean) => {
          // Swallow HERE, per probe. A timed-out fetch used to reject out of
          // Promise.all and get caught by this block's outer catch, which
          // deleted the ENTIRE contract check — so the board's core promise
          // went unverified and the payload simply didn't mention it. One slow
          // probe must cost us one probe, never the whole check.
          let jobs: Array<Record<string, unknown>> | null = null;
          try {
            jobs = await probe(body);
          } catch { jobs = null; }
          if (jobs === null) { unreachable++; return; } // transient — the refresh checks own that
          probed++;
          const bad = jobs.find((j) => !holds(j));
          if (bad) violations.push(`${label}: "${String(bad.title ?? '').slice(0, 40)}" @ ${String(bad.company ?? '')}`);
        };

        // In parallel: four independent reads, ~1-3s each, so the whole
        // contract check costs about one probe's wall time.
        await Promise.all([
          check('remote+US', { action: 'list', workMode: 'remote', country: 'US', limit: 15 },
            (j) => j.workMode === 'remote' && (!j.country || j.country === 'US')),
          // The floor compares in APPROXIMATE USD (salary_rank_usd semantics,
          // 2026-07-26): a EUR 95,000 row legitimately clears a $100k floor.
          // This predicate mirrors the migration's FX table — asserting the raw
          // number here would flag the fixed filter as broken (it did, once:
          // this check correctly fired the moment the semantics shipped).
          check('salaryFloor 100k', { action: 'list', salaryFloor: 100000, limit: 15 },
            (j) => {
              const fx: Record<string, number> = { USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.66, NZD: 0.61, CHF: 1.12, SEK: 0.095, DKK: 0.145, NOK: 0.094, PLN: 0.25, INR: 0.012, SGD: 0.74, JPY: 0.0066, BRL: 0.18, MXN: 0.055, PHP: 0.017 };
              const rate = fx[String(j.salaryCurrency ?? 'USD').toUpperCase()];
              return typeof j.salaryMinAnnual === 'number' && typeof rate === 'number'
                && (j.salaryMinAnnual as number) * rate >= 100000 * 0.999;
            }),
          check('category=healthcare', { action: 'list', category: 'healthcare', limit: 15 },
            (j) => j.category === 'healthcare'),
          // A typo'd query scoped to one employer must never surface another's.
          check('company lander + typo', { action: 'list', companies: ['stripe'], q: 'desinger', limit: 10 },
            (j) => String(j.token ?? '').toLowerCase() === 'stripe'),
        ]);

        if (probed === 0) {
          // Nothing actually got verified. Reporting a pass here would be a
          // clean bill of health issued without an examination.
          skip('job_board_filter_contract', `all ${unreachable} filter probes were unreachable or timed out — the contract went unverified this run`);
        } else {
          checks.push({
            name: 'job_board_filter_contract',
            passed: violations.length === 0,
            responseTimeMs: 0,
            error: violations.length
              ? `filters returned rows that violate them — ${violations.join(' | ')}`
              : undefined,
          });
          // Partial coverage still counts as a real check on what it did read,
          // but say which probes never ran rather than implying full coverage.
          if (unreachable > 0) skip('job_board_filter_contract:partial', `${probed}/${probed + unreachable} probes ran; ${unreachable} timed out`);
        }
        if (violations.length) {
          // A filter serving wrong rows is worse than an outage: the user
          // can't tell, and applies to jobs that don't match what they asked.
          overallStatus = 'unhealthy';
          errorMessage = errorMessage || `Job-board filter contract broken: ${violations[0]}`;
        }
      } catch (e) {
        skip('job_board_filter_contract', e instanceof Error ? e.message : 'board unreachable — the refresh/deploy checks above own that');
      }

      // Vendor circuit breaker: the refresh quarantines a vendor whose feeds
      // go mass-empty (API/shape break) instead of pruning its corpus. That
      // quarantine is safe but means the vendor's zero-feed boards are frozen —
      // a human needs to look at the vendor's API and ship a fetcher fix.
      const { data: vh } = await supabase
        .from('job_board_meta').select('v, updated_at').eq('k', 'vendor_breaker').maybeSingle();
      const vhV = (vh?.v ?? {}) as { quarantined?: string[]; vendors?: Record<string, { a?: number; z?: number }> };
      const quarantined = Array.isArray(vhV.quarantined) ? vhV.quarantined : [];
      if (quarantined.length > 0) {
        const detail = quarantined
          .map((v) => {
            const st = vhV.vendors?.[v];
            const rate = st && st.a ? Math.round(((st.z ?? 0) / st.a) * 100) : null;
            return `${v}${rate !== null ? ` (${rate}% zero feeds)` : ''}`;
          })
          .join(', ');
        checks.push({
          name: 'job_board_vendor_quarantine',
          passed: false,
          responseTimeMs: 0,
          error: `vendor(s) quarantined after mass-empty feeds: ${detail} — prunes suspended for their zero boards; likely a vendor API change, check the fetcher`,
        });
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || `Job-board vendor quarantined: ${quarantined.join(', ')}`;
      } else {
        checks.push({ name: 'job_board_vendor_quarantine', passed: true, responseTimeMs: 0 });
      }

      // Capacity headroom: the corpus is bounded by the free-tier DB (~100k).
      // Warn BEFORE the governor has to evict live postings — a shrinking
      // headroom is the signal to widen the DB tier or trim the board
      // selection, rather than silently shedding real jobs to stay under cap.
      const { data: cap } = await supabase
        .from('job_board_meta').select('v').eq('k', 'capacity').maybeSingle();
      const capV = (cap?.v ?? {}) as { active?: boolean; headroom?: number | null; corpus?: number | null; corpusBefore?: number; evicted?: number; ceiling?: number; basis?: string };
      const headroom = typeof capV.headroom === 'number'
        ? capV.headroom
        : (typeof capV.ceiling === 'number' && typeof capV.corpusBefore === 'number' ? capV.ceiling - capV.corpusBefore : null);
      // An UNMEASURED corpus is a failure, not a pass. The exact count outgrew
      // the statement timeout and `corpusSize ?? 0` published headroom = the
      // whole ceiling, so this check read maximum headroom and went green while
      // the governor was in fact blind. A guard that cannot measure the thing it
      // guards has to say so.
      const capUnmeasured = capV.basis === 'unmeasured' || (capV.active !== true && headroom === null);
      const capTight = capV.active === true || (headroom !== null && headroom < 2000);
      checks.push({
        name: 'job_board_capacity',
        passed: !capTight && !capUnmeasured,
        responseTimeMs: 0,
        error: capUnmeasured
          ? 'corpus size unmeasurable — the capacity governor cannot tell whether the ceiling is near, and eviction is disabled until it can'
          : capTight
          ? (capV.active
              ? `capacity governor active — evicted ${capV.evicted ?? '?'} stalest postings last pass (ceiling ${capV.ceiling ?? '?'}); widen the DB tier or trim board selection`
              : `corpus near cap — headroom ${headroom} below ceiling ${capV.ceiling ?? '?'}`)
          : undefined,
      });
      if (capTight || capUnmeasured) {
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || (capUnmeasured
          ? 'Job board corpus size unmeasurable (capacity governor blind)'
          : `Job board near capacity (${capV.active ? 'governor evicting' : `headroom ${headroom}`})`);
      }

      // Disk headroom: the governor caps ROWS, but nothing watched BYTES on the
      // 8GB plan — approach disk pressure blind and you discover it under load.
      // Warn at 70% so the tier gets widened deliberately. If the size RPC isn't
      // migrated yet, skip silently (not an incident).
      const { data: sizeStats, error: sizeErr } = await dbSizeP as { data: unknown; error?: unknown };
      if (sizeErr || !sizeStats) skip('job_board_disk', 'get_db_size_stats returned nothing within its deadline');
      if (!sizeErr && sizeStats) {
        const sz = sizeStats as { db_bytes?: number; postings_bytes?: number };
        const dbBytes = typeof sz.db_bytes === 'number' ? sz.db_bytes : 0;
        const planGb = await planDiskGb();
        const usedPct = dbBytes > 0 ? Math.round((dbBytes / (planGb * 1024 ** 3)) * 100) : 0;
        const diskTight = usedPct >= 70;
        checks.push({
          name: 'job_board_disk',
          passed: !diskTight,
          responseTimeMs: 0,
          error: diskTight
            ? `database at ${usedPct}% of the ${planGb}GB plan (${(dbBytes / 1e9).toFixed(2)} GB total, postings ${((sz.postings_bytes ?? 0) / 1e9).toFixed(2)} GB) — widen the DB tier before raising the row governor`
            : undefined,
        });
        if (diskTight) {
          if (overallStatus === 'healthy') overallStatus = 'degraded';
          errorMessage = errorMessage || `Database near disk cap (${usedPct}% of ${planGb}GB)`;
        }
      }
    } catch (e) {
      checks.push({
        name: 'job_board_refresh',
        passed: false,
        responseTimeMs: Date.now() - boardStart,
        error: e instanceof Error ? e.message : 'Unknown error'
      });
      if (overallStatus === 'healthy') overallStatus = 'degraded';
    }

    // Check: DEPLOY INTROSPECTION. The meta checks above pass even when the
    // job-board FUNCTION is stale-deployed or failing to boot (the "pushed ≠ live"
    // failure mode — the rung-2 publish took hours to diagnose because nothing
    // confirmed what build was actually live). This calls the function's read-only
    // `status` action so a boot failure, an empty catalog, or a broken deploy shows
    // up within the hour. Concerns kept separate: this verifies the BUILD is live
    // and sane; job_board_refresh above verifies the pipeline is MOVING.
    const deployStart = Date.now();
    try {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
      const controller = new AbortController();
      // 35s, not 15s. Measured 2026-08-06 across seven probes over 4.5 minutes:
      // status answers in 8.5-26s, straddling the old 15s abort, so this check
      // FLAPPED — reporting "job-board status unreachable" about a function that
      // was demonstrably serving audits and job queries the same minute. A
      // deploy check that cries outage on a slow-but-working endpoint trains you
      // to ignore the one alarm whose entire job is answering "did it land?".
      // The underlying latency is fixed separately (the two stats RPCs it awaits
      // are now precomputed); this bound just has to sit clear of the real
      // spread rather than inside it.
      const timeoutId = setTimeout(() => controller.abort(), 35000);
      let resp: Response;
      try {
        resp = await fetch(`${supabaseUrl}/functions/v1/job-board`, {
          method: 'POST',
          headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'status' }),
          signal: controller.signal,
        });
      } finally { clearTimeout(timeoutId); }
      const sBody = await resp.json().catch(() => null) as Record<string, unknown> | null;
      // An older bundle (pre-status-action) answers unknown actions with 400
      // "Unknown action" — that means the new build isn't live yet, a transient
      // deploy state, NOT an incident. Don't page on it; just note it.
      const oldBuild = resp.status === 400 && /unknown action/i.test(String(sBody?.error ?? ''));
      const hasStatus = sBody != null && typeof sBody.catalogSize === 'number';
      let deployBad = false;
      let deployErr: string | undefined;
      if (oldBuild) {
        console.log('[HEARTBEAT] job-board status action not live yet (older bundle) — deploy check unverified, not paging');
      } else if (!resp.ok || !hasStatus) {
        deployBad = true;
        deployErr = `job-board status HTTP ${resp.status}${hasStatus ? '' : ' / malformed response'} — function may be down or failing to boot`;
      } else {
        const catalogSize = sBody.catalogSize as number;
        deployBad = catalogSize <= 0;
        deployErr = deployBad
          ? `deployed job-board has an empty catalog (size ${catalogSize}, build v${sBody.version ?? '?'}) — bad publish`
          : undefined;
        if (!deployBad) {
          console.log(`[HEARTBEAT] job-board build v${sBody.version}, catalog ${catalogSize}, ${sBody.dormantBoards ?? 0} dormant, cold cursor ${(sBody.cursor as { cold?: number } | undefined)?.cold ?? '?'}`);
        }
      }
      checks.push({
        name: 'job_board_deploy',
        passed: !deployBad,
        responseTimeMs: Date.now() - deployStart,
        error: deployErr,
      });
      if (deployBad) {
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || deployErr || 'Job board deploy check failed';
      }
    } catch (e) {
      // Timeout/abort/network error calling status = the function isn't answering.
      checks.push({
        name: 'job_board_deploy',
        passed: false,
        responseTimeMs: Date.now() - deployStart,
        error: e instanceof Error ? `job-board status unreachable: ${e.message}` : 'job-board status unreachable',
      });
      if (overallStatus === 'healthy') overallStatus = 'degraded';
      errorMessage = errorMessage || 'Job board status endpoint unreachable';
    }

    // Check: VENDOR SCHEMA DRIFT. The normalizer tests lock our parsing to fixed
    // captured payloads — they can't catch a vendor changing its LIVE API, after
    // which that vendor's feeds fetch fine but normalize to zero and the whole
    // vendor silently drains off the board. This asks job-board's vendor-health
    // canary (cached 30 min there) whether any vendor returned raw items that
    // parsed to nothing. Drift pages; a single unreachable vendor is transient
    // and only logged.
    const vendorStart = Date.now();
    try {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      let vResp: Response;
      try {
        vResp = await fetch(`${supabaseUrl}/functions/v1/job-board`, {
          method: 'POST',
          headers: { 'apikey': anonKey, 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'vendor-health' }),
          signal: controller.signal,
        });
      } finally { clearTimeout(timeoutId); }
      const vBody = await vResp.json().catch(() => null) as { drifted?: string[]; unreachable?: string[] } | null;
      const oldBuild = vResp.status === 400; // older bundle without the action — not live yet
      const drifted = Array.isArray(vBody?.drifted) ? vBody!.drifted : [];
      const unreachable = Array.isArray(vBody?.unreachable) ? vBody!.unreachable : [];
      const driftBad = !oldBuild && vResp.ok && drifted.length > 0;
      checks.push({
        name: 'job_board_vendors',
        passed: !driftBad,
        responseTimeMs: Date.now() - vendorStart,
        error: driftBad
          ? `vendor API drift: ${drifted.join(', ')} returned raw postings that normalized to ZERO — the vendor changed its API shape; update the normalizer`
          : undefined,
      });
      if (driftBad) {
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || `Job board vendor drift: ${drifted.join(', ')}`;
      } else if (unreachable.length > 0) {
        console.log(`[HEARTBEAT] vendor canary: ${unreachable.join(', ')} unreachable this cycle (transient, not paged)`);
      }
    } catch (e) {
      // A failure to reach the canary is not itself a vendor-drift signal; log,
      // don't page (the deploy/refresh checks already cover a down function).
      console.log(`[HEARTBEAT] vendor-health check skipped: ${e instanceof Error ? e.message : 'unreachable'}`);
    }

    // Check 6: END-TO-END scan through the real deployed function. The
    // component checks above can all pass while free-keyword-scan itself is
    // crashed or stale-deployed (exactly the July 4 outage) — this is the
    // check that would have caught it. Sends x-heartbeat-secret so the scan
    // function skips per-IP daily limits (see HEARTBEAT_SECRET there); if the
    // secret isn't configured, a 429 counts as alive-but-unverified, not down.
    const e2eStart = Date.now();
    try {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') || '';
      const heartbeatSecret = Deno.env.get('HEARTBEAT_SECRET');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 75000);
      const scanResp = await fetch(`${supabaseUrl}/functions/v1/free-keyword-scan`, {
        method: 'POST',
        headers: {
          'apikey': anonKey,
          'Authorization': `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          ...(heartbeatSecret ? { 'x-heartbeat-secret': heartbeatSecret } : {}),
        },
        body: JSON.stringify({ resumeText: TEST_RESUME }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const e2eTime = Date.now() - e2eStart;

      if (scanResp.status === 429) {
        // Alive (the limiter answered coherently) but the report path is
        // unverified this cycle. Don't page for this.
        checks.push({ name: 'e2e_scan', passed: true, responseTimeMs: e2eTime, error: 'rate-limited: alive but report unverified (set HEARTBEAT_SECRET)' });
      } else if (!scanResp.ok) {
        const bodyText = (await scanResp.text()).substring(0, 200);
        checks.push({ name: 'e2e_scan', passed: false, responseTimeMs: e2eTime, error: `HTTP ${scanResp.status}: ${bodyText}` });
        overallStatus = 'down';
        errorMessage = errorMessage || `E2E scan: HTTP ${scanResp.status}`;
      } else {
        const scanJson = await scanResp.json();
        const anatomyOk = typeof scanJson.atsScoreEstimate === 'number' && !!scanJson.reportMeta?.reportId;
        checks.push({
          name: 'e2e_scan',
          passed: anatomyOk,
          responseTimeMs: e2eTime,
          error: anatomyOk ? undefined : 'Response missing atsScoreEstimate/reportMeta',
        });
        if (!anatomyOk) {
          overallStatus = 'degraded';
          errorMessage = errorMessage || 'E2E scan: 200 but malformed report';
        }
      }
    } catch (e) {
      checks.push({
        name: 'e2e_scan',
        passed: false,
        responseTimeMs: Date.now() - e2eStart,
        error: e instanceof Error ? e.message : 'Unknown error',
      });
      overallStatus = 'down';
      errorMessage = errorMessage || `E2E scan: ${e instanceof Error ? e.message : 'Unknown'}`;
    }

    // Calculate total response time and adjust status based on latency
    const totalTime = Date.now() - startTime;
    if (overallStatus === 'healthy' && totalTime > DEGRADED_RESPONSE_TIME_MS) {
      overallStatus = 'degraded';
      errorMessage = `High latency: ${totalTime}ms`;
    } else if (overallStatus === 'healthy' && totalTime > HEALTHY_RESPONSE_TIME_MS) {
      // Just log as info, not degraded
      console.log(`[SCAN-HEARTBEAT] Response time elevated: ${totalTime}ms`);
    }

    // Log heartbeat result to database
    const allPassed = checks.every(c => c.passed);
    const checksPassedJson = checks.reduce((acc, c) => {
      acc[c.name] = { passed: c.passed, time_ms: c.responseTimeMs, error: c.error };
      return acc;
    }, {} as Record<string, any>);

    await supabase.rpc('log_heartbeat_result', {
      p_function_name: 'free-keyword-scan',
      p_status: overallStatus,
      p_response_time_ms: totalTime,
      p_test_passed: allPassed && overallStatus !== 'down',
      p_error_message: errorMessage,
      p_checks_passed: checksPassedJson,
      p_metadata: { ai_model: AI_MODEL, test_time: new Date().toISOString() }
    });

    console.log(`[SCAN-HEARTBEAT] ${overallStatus} | Total: ${totalTime}ms | Checks: ${checks.map(c => `${c.name}:${c.passed}`).join(', ')}${skipped.length ? ` | SKIPPED: ${skipped.map(s => s.name).join(', ')}` : ''}`);

    // Send alert if status is not healthy — and a single recovery note when a
    // previously-alerted state clears, so the inbox learns the incident ended
    // without anyone re-curling the endpoint.
    if (overallStatus !== 'healthy') {
      EdgeRuntime.waitUntil(sendHeartbeatAlert(overallStatus, errorMessage, checks, totalTime));
    } else {
      EdgeRuntime.waitUntil(sendRecoveryIfAlerted());
    }

    // The apply worker runs on hardware we do not control — currently a laptop,
    // which macOS sleeps ~11 minutes after you stop touching it unless
    // `pmset -c sleep 0` is set, and an OS update can revert that silently.
    // Deliberately OUTSIDE overallStatus: the scanner and board are fine when
    // the sender is down, and turning this into a platform "down" would page on
    // the wrong thing.
    const senderState = await evaluateSenderState(supabase);
    if (senderState?.shouldAlert) {
      EdgeRuntime.waitUntil(sendSenderOfflineAlert(senderState));
    }

    // WHAT CONFIRMATION PAGES ACTUALLY SAID when the worker could not recognise
    // them. Every phrase in CONFIRMED_RE is a guess, and the evidence that would
    // replace a guess with a measurement was landing in a jsonb column nobody
    // reads. Surfaced here because this response is already the thing that gets
    // curled — the wording is useless sitting in a table nobody queries.
    //
    // Carries no user, no posting and no URL: agent_confirmation_gaps strips all
    // three, which is what makes it safe to put in a public response.
    const confirmationGaps = await evaluateConfirmationGaps(supabase);

    // WHY FILLS REFUSED, which is the same question one step earlier in the run
    // and the larger of the two numbers. A confirmation gap costs a review; a
    // fill gap costs the application. Both were landing in `blockers` and only
    // one of them was being read.
    //
    // Same safety terms: the worker decides at the point of failure what may be
    // published, and agent_fill_gaps reads only that — never the free-text
    // sentence beside it.
    const fillGaps = await evaluateFillGaps(supabase);

    // IS EMAIL ACTUALLY GOING OUT. The worst failure this product has is a paid
    // report that never arrives, and until now nothing anywhere reported it —
    // the delivery log recorded every failure and no surface read it.
    const delivery = await evaluateDelivery(supabase);

    // AND DID THE PRODUCT ITSELF EVER GET MADE. The email check above assumes
    // there was something to send. reconcile-stripe assumes the webhook never
    // ran. Neither sees a generation that failed after the idempotency marker
    // was written, which is the one case where the customer has paid, the
    // system believes it delivered, and the retry has already given up.
    const productDelivery = await evaluateProductDelivery(supabase);

    return new Response(
      JSON.stringify({
        status: overallStatus,
        // First field after the verdict, deliberately: when this endpoint says
        // something surprising, "which bundle said it" is the next question.
        buildVersion: BUILD_VERSION,
        timestamp: new Date().toISOString(),
        responseTimeMs: totalTime,
        checks,
        skipped,
        errorMessage,
        // Reported every run, alert or not. An alert that has never fired is an
        // assumption; this makes the exact inputs curl-able so the rule can be
        // checked against live data instead of waited on.
        senderState,
        confirmationGaps,
        fillGaps,
        delivery,
        productDelivery
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    const totalTime = Date.now() - startTime;
    console.error("[SCAN-HEARTBEAT] Fatal error:", error);

    // Log failure
    await supabase.rpc('log_heartbeat_result', {
      p_function_name: 'free-keyword-scan',
      p_status: 'down',
      p_response_time_ms: totalTime,
      p_test_passed: false,
      p_error_message: error instanceof Error ? error.message : 'Unknown error',
      p_checks_passed: {},
      p_metadata: {}
    });

    EdgeRuntime.waitUntil(sendHeartbeatAlert('down', error instanceof Error ? error.message : 'Unknown', checks, totalTime));

    return new Response(
      JSON.stringify({
        status: 'down',
        timestamp: new Date().toISOString(),
        responseTimeMs: totalTime,
        checks,
        skipped,
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

/**
 * IS THE APPLY WORKER ALIVE, AND DOES IT MATTER RIGHT NOW?
 *
 * `agent_sender_online()` is a boolean, and false means two unrelated things:
 * nothing was ever installed, or the thing that was installed died. Alerting on
 * it would page about a machine that never existed, or stay silent when the real
 * one stops. `agent_sender_state()` returns the inputs instead, so the rule
 * lives here in the open and every state is nameable.
 *
 * WHY IT IS GATED ON WORK OUTSTANDING. A sleeping worker with no mandate and no
 * ready packet costs nobody anything — the laptop being shut overnight is normal
 * and emailing about it nightly would train the alert to be ignored, which is
 * worse than not having one. The moment there is a mandate or a ready packet,
 * the same silence means a candidate is not being applied for, and that is the
 * outage worth waking up to.
 */
const SENDER_OFFLINE_SECONDS = Math.max(
  300,
  Number(Deno.env.get("SENDER_OFFLINE_ALERT_SECONDS") ?? "3600") || 3600,
);

interface SenderState {
  everSeen: boolean;
  lastSeen: string | null;
  offlineSeconds: number | null;
  activeMandates: number;
  pendingPackets: number;
  thresholdSeconds: number;
  shouldAlert: boolean;
  reason: string;
}

/**
 * The phrases real confirmation pages used, for the ones we failed to read.
 *
 * `parked` is reported even when zero, deliberately. A field that only appears
 * when something is wrong is indistinguishable from a field that stopped being
 * computed, which is the same trap as an alarm that only records failures.
 *
 * Never throws and never blocks the heartbeat: an absent RPC (migration not yet
 * applied) reports `reason: rpc-missing` rather than turning a healthy platform
 * into a failed check.
 */
async function evaluateConfirmationGaps(
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
): Promise<{ reason: string; parked: number; wordings: Array<{ wording: string; occurrences: number }> }> {
  try {
    const { data, error } = await supabase.rpc('agent_confirmation_gaps', { p_days: 30 });
    if (error) return { reason: 'rpc-missing', parked: 0, wordings: [] };
    const rows = Array.isArray(data) ? data as Array<Record<string, unknown>> : [];
    const wordings = rows.slice(0, 10).map((r) => ({
      wording: String(r.wording ?? '').slice(0, 200),
      occurrences: Number(r.occurrences ?? 0),
    }));
    const parked = wordings.reduce((n, w) => n + w.occurrences, 0);
    return {
      // `none-yet` and `unrecognised-wording` are different states and must read
      // differently: the first means nothing has been sent, the second means
      // sends ARE happening and the phrase list is behind them.
      reason: parked === 0 ? 'none-yet' : 'unrecognised-wording',
      parked,
      wordings,
    };
  } catch {
    return { reason: 'rpc-missing', parked: 0, wordings: [] };
  }
}

/**
 * WHY THE AGENT DID NOT FILL A FORM, grouped so it can be acted on.
 *
 * The shape mirrors evaluateConfirmationGaps deliberately — same never-throws
 * rule, same rpc-missing reason so a build deployed ahead of its migration says
 * so rather than reporting a clean run.
 *
 * `blocked` is reported even at zero for the same reason `parked` is: a field
 * that only appears when something is wrong cannot be told apart from a field
 * that has stopped being computed.
 *
 * TOP STAGE IS THE HEADLINE, and it is the number worth watching. When a single
 * stage holds most of the refusals it is one fix — a label pattern, a field map
 * — standing between the agent and every one of them. When they are spread
 * evenly there is no such fix, and knowing that is worth as much.
 */
async function evaluateFillGaps(
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
): Promise<{
  reason: string;
  blocked: number;
  topStage: string | null;
  stages: Array<{ stage: string; occurrences: number }>;
  wordings: Array<{ stage: string; source: string; wording: string; occurrences: number }>;
}> {
  const empty = { reason: 'rpc-missing', blocked: 0, topStage: null, stages: [], wordings: [] };
  try {
    const { data, error } = await supabase.rpc('agent_fill_gaps', { p_days: 30 });
    if (error) return empty;
    const rows = (Array.isArray(data) ? data as Array<Record<string, unknown>> : []).map((r) => ({
      stage: String(r.stage ?? 'unstamped'),
      source: String(r.source ?? 'unknown'),
      wording: String(r.wording ?? '').slice(0, 200),
      occurrences: Number(r.occurrences ?? 0),
    }));
    const blocked = rows.reduce((n, r) => n + r.occurrences, 0);

    // Rolled up per stage, because the row grain is (stage, vendor, wording)
    // and "question-unanswerable, 40 times across 12 different labels" is the
    // sentence that decides what to build next.
    const byStage = new Map<string, number>();
    for (const r of rows) byStage.set(r.stage, (byStage.get(r.stage) ?? 0) + r.occurrences);
    const stages = [...byStage.entries()]
      .map(([stage, occurrences]) => ({ stage, occurrences }))
      .sort((a, b) => b.occurrences - a.occurrences);

    return {
      // Three states, three words. `none-yet` means nothing has been attempted;
      // `clean` would be a lie in that case, and it is the lie that matters —
      // an agent that has never run looks exactly like one that never fails.
      reason: blocked === 0 ? 'none-yet' : 'fills-refused',
      blocked,
      topStage: stages[0]?.stage ?? null,
      stages: stages.slice(0, 10),
      // Only the rows that carry evidence. A stage with no wording is already
      // counted above, and repeating it here as an empty string reads like a
      // vendor whose forms ask blank questions.
      wordings: rows.filter((r) => r.wording.length > 0).slice(0, 10),
    };
  } catch {
    return empty;
  }
}

/**
 * EMAIL DELIVERY, WHICH NOTHING WAS WATCHING.
 *
 * Same never-throws, rpc-missing-is-a-reason shape as the two gap evaluators.
 *
 * `sent` and `failed` are reported even at zero, because a field that only
 * appears when something is wrong cannot be told apart from a field that
 * stopped being computed — the same rule the other two follow.
 *
 * `failRate` is the number worth alerting on eventually, but it is NOT wired to
 * overallStatus here. A first version that pages on it would fire on the first
 * bounced address from a typo, and an alert that cries wolf gets muted, which
 * is worse than the silence this replaces. Report it, watch it, then choose a
 * threshold from real numbers rather than from a guess.
 */
async function evaluateDelivery(
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
): Promise<{
  reason: string; sent: number; failed: number; stuck: number; failRate: number | null;
  byStatus: Array<{ status: string; n: number }>; lastSentAt: string | null;
}> {
  const empty = { reason: 'rpc-missing', sent: 0, failed: 0, stuck: 0, failRate: null, byStatus: [], lastSentAt: null };
  try {
    const { data, error } = await supabase.rpc('email_delivery_health', { p_hours: 24 });
    if (error) return empty;
    const rows = (Array.isArray(data) ? data as Array<Record<string, unknown>> : []).map((r) => ({
      status: String(r.status ?? 'unknown'),
      n: Number(r.n ?? 0),
      stuck: Number(r.stuck ?? 0),
      last_at: r.last_at ? String(r.last_at) : null,
    }));
    const of = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    const sent = of('sent');
    // Everything that means the person did not get it. `suppressed` is
    // deliberately NOT counted as a failure: it is the system correctly
    // refusing to mail someone who unsubscribed or hard-bounced before.
    const failed = of('failed') + of('bounced') + of('dlq');
    // NEITHER SENT NOR FAILED, which is how a stranded email stayed invisible.
    // Measured 2026-08-06: one row pending since 2026-07-03 — thirty-four days
    // — counted by nothing, so a log of nothing but stuck sends read as 'clean'.
    const stuck = rows.reduce((a, r) => a + r.stuck, 0);
    const total = sent + failed;
    return {
      // Four states now. `idle` matters: no email in 24h is normal on a quiet
      // day and catastrophic on a busy one, and only a human knows which — so it
      // must not read as healthy OR as broken. `stalled` is the state that used
      // to hide inside `clean`, and it is checked BEFORE clean deliberately: a
      // run with zero failures and a stranded queue is not a clean run.
      reason: (total + stuck) === 0 ? 'idle'
            : failed > 0 ? 'failures'
            : stuck > 0 ? 'stalled'
            : 'clean',
      sent,
      failed,
      stuck,
      failRate: total > 0 ? Math.round((failed / total) * 1000) / 10 : null,
      byStatus: rows.map(({ status, n }) => ({ status, n })).slice(0, 10),
      lastSentAt: rows.find((r) => r.status === 'sent')?.last_at ?? null,
    };
  } catch {
    return empty;
  }
}

/**
 * PAID PRODUCTS THAT NEVER ARRIVED.
 *
 * Distinct from the email check above and from reconcile-stripe, and the
 * distinction is the point: reconcile-stripe finds sessions with no delivery
 * marker, but the webhook writes that marker BEFORE generating. So everything
 * that breaks after the marker — a failed generation, an exhausted retry, a row
 * stranded in `generating` because the webhook died mid-flight — is invisible to
 * the money sweep, and retry-failed-deliveries gives up without telling anyone.
 *
 * This is the surface for the half of the failure space nothing was watching.
 */
async function evaluateProductDelivery(
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
): Promise<{
  reason: string; delivered: number; failed: number; exhausted: number; stuck: number;
  byStatus: Array<{ status: string; n: number }>;
}> {
  const empty = { reason: 'rpc-missing', delivered: 0, failed: 0, exhausted: 0, stuck: 0, byStatus: [] };
  try {
    const { data, error } = await supabase.rpc('product_delivery_health', { p_hours: 24 });
    if (error) return empty;
    const rows = (Array.isArray(data) ? data as Array<Record<string, unknown>> : []).map((r) => ({
      status: String(r.status ?? 'unknown'),
      n: Number(r.n ?? 0),
      exhausted: Number(r.exhausted ?? 0),
      stuck: Number(r.stuck ?? 0),
    }));
    const of = (s: string) => rows.find((r) => r.status === s)?.n ?? 0;
    // Both terminal-good states. `content_generated` means the product exists;
    // whether its email landed is the OTHER check's business, and conflating
    // them would let a delivery failure hide behind a successful generation.
    const delivered = of('delivered') + of('content_generated');
    const failed = of('generation_failed');
    const exhausted = rows.reduce((a, r) => a + r.exhausted, 0);
    // Stranded in a state that is transient by design and terminal by accident.
    const stuck = rows.reduce((a, r) => a + r.stuck, 0);
    return {
      // `idle` for the same reason as the email check: no purchases in 24h is a
      // quiet Tuesday or a broken checkout, and only a human knows which.
      reason: (delivered + failed + stuck) === 0 ? 'idle'
            : (failed + stuck) === 0 ? 'clean'
            : 'undelivered',
      delivered, failed, exhausted, stuck,
      byStatus: rows.map(({ status, n }) => ({ status, n })).slice(0, 10),
    };
  } catch {
    return empty;
  }
}

async function evaluateSenderState(
  // PromiseLike, not Promise: rpc() returns a PostgrestFilterBuilder, which is
  // thenable but has no catch/finally. `ReturnType<typeof createClient>` does
  // not work either — it infers different generics than the call site. Deno's
  // check catches both; tsconfig.app.json does not cover edge functions.
  supabase: { rpc: (fn: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> },
): Promise<SenderState | null> {
  try {
    const { data, error } = await supabase.rpc('agent_sender_state');
    if (error) {
      // Distinguishable on purpose: before the migration lands this reads
      // `rpc-missing` rather than silently looking like a healthy sender.
      console.error('[SCAN-HEARTBEAT] agent_sender_state failed:', error);
      return {
        everSeen: false, lastSeen: null, offlineSeconds: null,
        activeMandates: 0, pendingPackets: 0,
        thresholdSeconds: SENDER_OFFLINE_SECONDS,
        shouldAlert: false, reason: 'rpc-missing',
      };
    }
    const row = (Array.isArray(data) ? data[0] : data) as {
      ever_seen?: boolean; last_seen?: string | null; offline_seconds?: number | null;
      active_mandates?: number; pending_packets?: number;
    } | undefined;
    if (!row) return null;

    const everSeen = row.ever_seen === true;
    const offlineSeconds = typeof row.offline_seconds === 'number' ? row.offline_seconds : null;
    const activeMandates = row.active_mandates ?? 0;
    const pendingPackets = row.pending_packets ?? 0;
    const workOutstanding = activeMandates > 0 || pendingPackets > 0;
    const isOffline = everSeen && offlineSeconds !== null && offlineSeconds > SENDER_OFFLINE_SECONDS;

    const reason = !everSeen ? 'never-installed'
      : !isOffline ? 'online'
      : !workOutstanding ? 'offline-nothing-at-stake'
      : 'offline-with-work-outstanding';

    return {
      everSeen,
      lastSeen: row.last_seen ?? null,
      offlineSeconds,
      activeMandates,
      pendingPackets,
      thresholdSeconds: SENDER_OFFLINE_SECONDS,
      shouldAlert: reason === 'offline-with-work-outstanding',
      reason,
    };
  } catch (e) {
    console.error('[SCAN-HEARTBEAT] sender state check threw:', e);
    return null;
  }
}

async function sendSenderOfflineAlert(state: SenderState): Promise<void> {
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "resumeboostersupp@gmail.com";
    if (!RESEND_API_KEY) return;

    // Same durable dedupe as the heartbeat alert. 1 per 6 hours: this fires on a
    // 10-minute schedule, and an outage that lasts a weekend must not send 200
    // emails. NB `alert:*` is deliberately outside the cross-function request
    // budget (migration 20260803170000), so alerting can never spend the budget
    // that résumé upload and checkout depend on.
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        const dedupeClient = createClient(supabaseUrl, serviceKey);
        const { data: allowed } = await dedupeClient.rpc('check_rate_limit', {
          p_function: 'alert:sender-offline',
          p_ip: 'global',
          p_max_requests: 1,
          p_window_minutes: 360,
        });
        if (allowed === false) {
          console.log('[SCAN-HEARTBEAT] Sender-offline alert suppressed (1 per 6h)');
          return;
        }
      }
    } catch (_e) { /* dedupe is best-effort — never swallow a real alert */ }

    const mins = state.offlineSeconds === null ? '?' : Math.round(state.offlineSeconds / 60).toString();
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Resume Booster Alerts <onboarding@resend.dev>",
        to: [ADMIN_EMAIL],
        subject: `🔴 Apply worker offline ${mins}m — ${state.activeMandates} mandate(s) waiting`,
        html: `
          <h2>The apply worker has stopped</h2>
          <p>No heartbeat for <strong>${mins} minutes</strong> (last seen
             ${state.lastSeen ?? 'unknown'}). Applications are not going out.</p>
          <ul>
            <li>Active mandates: <strong>${state.activeMandates}</strong></li>
            <li>Packets ready to send: <strong>${state.pendingPackets}</strong></li>
          </ul>
          <p>Most likely cause, if it runs on the Mac: the machine slept. Check
             <code>pmset -g custom</code> shows <code>sleep 0</code> under AC Power —
             a macOS update can revert it. Lid open, on the power adapter.</p>
          <p>You will not get another of these for 6 hours.</p>
        `,
      }),
    });
    console.log(`[SCAN-HEARTBEAT] Sender-offline alert sent (${mins}m, ${state.activeMandates} mandates)`);
  } catch (e) {
    console.error('[SCAN-HEARTBEAT] Failed to send sender-offline alert:', e);
  }
}

// One recovery note when a previously-alerted state clears. Reads the same
// durable fingerprint the alert path writes; sends nothing when the last
// stored state was already healthy (or absent), so a healthy board costs zero
// email. Best-effort throughout.
async function sendRecoveryIfAlerted(): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return;
    // Its own client, like sendHeartbeatAlert's dedupeClient: passing the
    // outer client fails deno check on generics (see evaluateSenderState's
    // note), and this path runs a handful of times a day at most.
    const client = createClient(supabaseUrl, serviceKey);
    const { data: st } = await client
      .from('job_board_meta').select('v').eq('k', 'heartbeat_alert_state').maybeSingle();
    const prev = ((st as { v?: unknown } | null)?.v ?? {}) as { fingerprint?: string };
    if (!prev.fingerprint || prev.fingerprint.startsWith('healthy')) return;
    await client.from('job_board_meta').upsert(
      { k: 'heartbeat_alert_state', v: { fingerprint: 'healthy', lastSentAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
      { onConflict: 'k' },
    );
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "resumeboostersupp@gmail.com";
    if (!RESEND_API_KEY) return;
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Resume Booster Alerts <onboarding@resend.dev>",
        to: [ADMIN_EMAIL],
        subject: `✅ Heartbeat recovered: all checks passing`,
        html: `<h2>Heartbeat recovered</h2><p>The previously reported failing state (<code>${prev.fingerprint}</code>) has cleared — all checks pass as of ${new Date().toISOString()}.</p>`,
      }),
    });
    console.log('[SCAN-HEARTBEAT] Recovery email sent');
  } catch (e) {
    console.error('[SCAN-HEARTBEAT] Recovery email failed:', e);
  }
}

// Send alert email for heartbeat failures
async function sendHeartbeatAlert(
  status: string, 
  errorMessage: string | null, 
  checks: HealthCheckResult[],
  responseTime: number
): Promise<void> {
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    // Fallback must be a real inbox: the old admin@resumebooster.com default
    // was a dead letter on a domain we don't even use (.com, site is .work).
    const ADMIN_EMAIL = Deno.env.get("ADMIN_EMAIL") || "resumeboostersupp@gmail.com";

    if (!RESEND_API_KEY) return;

    const failedChecks = checks.filter(c => !c.passed);

    // ALERT ON CHANGE, REMIND RARELY. The old gate was a 2/hour rate cap — on
    // a 10-minute cron a PERSISTENT degraded state (a slow census digestion, a
    // week of a miscalibrated SLA) meant 48 identical emails a day, and the
    // inbox learned to ignore them, which is how alerting dies. The state that
    // matters is the FAILING SET: email when it changes (a new check fails,
    // the status escalates, part of it recovers), remind at most once a day
    // while it persists, and send one recovery note when it clears. The
    // fingerprint lives in job_board_meta so it survives isolates; every read
    // and write is best-effort — a dedupe failure must never swallow a real
    // alert, so on any error we fall through to the rate cap below and send.
    const fingerprint = `${status}|${failedChecks.map((c) => c.name).sort().join(",")}`;
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        const stateClient = createClient(supabaseUrl, serviceKey);
        const { data: st } = await stateClient
          .from('job_board_meta').select('v').eq('k', 'heartbeat_alert_state').maybeSingle();
        const prev = (st?.v ?? {}) as { fingerprint?: string; lastSentAt?: string };
        const lastSent = Date.parse(prev.lastSentAt ?? '');
        const sameState = prev.fingerprint === fingerprint;
        const REMIND_MS = 24 * 60 * 60_000;
        if (sameState && Number.isFinite(lastSent) && Date.now() - lastSent < REMIND_MS) {
          console.log(`[SCAN-HEARTBEAT] Alert suppressed — same failing set already reported ${Math.round((Date.now() - lastSent) / 60_000)}m ago (daily reminder pending)`);
          return;
        }
        await stateClient.from('job_board_meta').upsert(
          { k: 'heartbeat_alert_state', v: { fingerprint, lastSentAt: new Date().toISOString() }, updated_at: new Date().toISOString() },
          { onConflict: 'k' },
        );
      }
    } catch (_e) { /* fall through — the cap below still bounds the volume */ }

    // The rate cap survives as a BACKSTOP for a flapping fingerprint (a check
    // oscillating in and out of the failing set would otherwise email every
    // flip): still at most 2 emails an hour, no matter what.
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (supabaseUrl && serviceKey) {
        const dedupeClient = createClient(supabaseUrl, serviceKey);
        const { data: allowed } = await dedupeClient.rpc('check_rate_limit', {
          p_function: 'alert:heartbeat',
          p_ip: 'global',
          p_max_requests: 2,
          p_window_minutes: 60,
        });
        if (allowed === false) {
          console.log('[SCAN-HEARTBEAT] Alert suppressed (2/hour global cap)');
          return;
        }
      }
    } catch (_e) { /* fall through and send */ }
    const statusEmoji = status === 'down' ? '🔴' : '🟡';

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Resume Booster Alerts <onboarding@resend.dev>",
        to: [ADMIN_EMAIL],
        // The failing set in the subject: identical subjects for different
        // incidents thread together in Gmail and hide each other; a stable
        // subject PER FINGERPRINT threads one incident as one conversation.
        subject: `${statusEmoji} Heartbeat ${status.toUpperCase()}: ${failedChecks.map((c) => c.name.replace(/^job_board_/, "")).sort().join(", ").slice(0, 140) || "no failing checks"}`,
        html: `
          <h2>Free Scan Heartbeat Alert</h2>
          <p><strong>Status:</strong> ${status.toUpperCase()}</p>
          <p><strong>Time:</strong> ${new Date().toISOString()}</p>
          <p><strong>Response Time:</strong> ${responseTime}ms</p>
          ${errorMessage ? `<p><strong>Error:</strong> ${errorMessage}</p>` : ''}
          
          <h3>Check Results:</h3>
          <ul>
            ${checks.map(c => `
              <li>
                ${c.passed ? '✅' : '❌'} <strong>${c.name}</strong>: 
                ${c.responseTimeMs}ms 
                ${c.error ? `- ${c.error}` : ''}
              </li>
            `).join('')}
          </ul>
          
          ${failedChecks.length > 0 ? `
            <h3>Failed Checks:</h3>
            <ul>
              ${failedChecks.map(c => `<li>${c.name}: ${c.error}</li>`).join('')}
            </ul>
          ` : ''}
        `,
      }),
    });
    
    console.log(`[SCAN-HEARTBEAT] Alert email sent for status: ${status}`);
  } catch (e) {
    console.error("[SCAN-HEARTBEAT] Failed to send alert:", e);
  }
}
