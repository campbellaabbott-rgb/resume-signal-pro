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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now();
  const checks: HealthCheckResult[] = [];
  let overallStatus = 'healthy';
  let errorMessage: string | null = null;

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
      const { data: rot } = await supabase
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
      const expectedWrapMin = Math.ceil((coldBoards / 80) * 0.95);
      const COLD_ROTATION_SLA_MIN = Math.max(120, Math.ceil(expectedWrapMin * 1.4));
      const rotStale = rotAgeMin !== null && rotAgeMin > COLD_ROTATION_SLA_MIN;
      checks.push({
        name: 'job_board_freshness',
        passed: !rotStale,
        responseTimeMs: 0,
        error: rotStale ? `cold-tail last fully re-verified ${rotAgeMin} min ago (SLA ${COLD_ROTATION_SLA_MIN}) — long-tail postings may be stale; check for failing boards or too-slow rotation` : undefined,
      });
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
      try {
        const { data: fRows } = await supabase.rpc('get_freshness_stats');
        const f = Array.isArray(fRows) ? (fRows[0] as { boards?: number; p50_min?: number; p95_min?: number } | undefined) : undefined;
        if (f && typeof f.p95_min === 'number' && (f.boards ?? 0) > 1000) {
          const CLAIM_P95_MIN = 300; // "a few hours", with margin
          const claimBreach = f.p95_min > CLAIM_P95_MIN;
          checks.push({
            name: 'job_board_freshness_claim',
            passed: !claimBreach,
            responseTimeMs: 0,
            error: claimBreach
              ? `measured re-verification P95 is ${(f.p95_min / 60).toFixed(1)}h (median ${Math.round(f.p50_min ?? 0)}m) — the public "within a few hours" claim is drifting false; raise rotation throughput or fix failing slices`
              : undefined,
          });
          if (claimBreach) {
            if (overallStatus === 'healthy') overallStatus = 'degraded';
            errorMessage = errorMessage || `Board freshness P95 ${(f.p95_min / 60).toFixed(1)}h exceeds the published claim`;
          }
        }
      } catch { /* RPC not applied yet */ }

      // Ground-truth accuracy: the daily audit samples ~100 served postings and
      // confirms each live at the vendor source. A dip below threshold means the
      // pipeline is serving dead listings RIGHT NOW — the one failure users feel
      // most and every other check can miss.
      const { data: audit } = await supabase
        .from('job_board_meta').select('v, updated_at').eq('k', 'audit').maybeSingle();
      if (audit) {
        const aV = (audit.v ?? {}) as { accuracyPct?: number | null; live?: number; gone?: number; at?: string; byVendor?: Record<string, { sampled?: number; accuracyPct?: number | null }> };
        const auditAgeH = Math.round((Date.now() - new Date(audit.updated_at).getTime()) / 3600_000);
        // Per-vendor floor: the stratified audit samples every vendor, so one
        // broken vendor can't hide inside a healthy blended number. A vendor
        // with a real sample below 80% is an incident even at 99% overall.
        const badVendors = Object.entries(aV.byVendor ?? {})
          .filter(([, b]) => (b.sampled ?? 0) >= 5 && typeof b.accuracyPct === 'number' && b.accuracyPct < 80)
          .map(([v, b]) => `${v} ${b.accuracyPct}%`);
        const lowAccuracy = (typeof aV.accuracyPct === 'number' && aV.accuracyPct < 97) || badVendors.length > 0;
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
          errorMessage = errorMessage || (lowAccuracy ? `Board accuracy ${aV.accuracyPct}% (below 97% SLA)` : 'Board accuracy audit stale');
        }
      }

      // Published-stat plausibility: the Ghost Job Index's headline median once
      // collapsed to 2.8d because it measured OUR discovery age, not the
      // company's stated post date — a user spotted it before we did. With a
      // 30-day cap, a stated-date median outside 4-25d means a basis or
      // ingestion skew; a stated-date coverage collapse means a vendor parser
      // stopped extracting dates. Catch both before the public page does.
      try {
        const { data: gs } = await supabase.rpc('get_ghost_job_index_stats');
        const g = Array.isArray(gs) ? gs[0] : gs;
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
        }
      } catch { /* RPC not applied yet */ }

      // Label integrity: the daily audit cross-checks our experience_band and
      // remote labels against each posting's own text. A contradiction rate
      // above 15% means the detector is mislabeling a filterable field —
      // users are filtering on claims the postings themselves dispute.
      if (audit) {
        const la = ((audit.v ?? {}) as { labelAudit?: { entryChecked?: number; entryContradicted?: number; remoteChecked?: number; remoteContradicted?: number } }).labelAudit;
        if (la && ((la.entryChecked ?? 0) >= 10 || (la.remoteChecked ?? 0) >= 10)) {
          const entryRate = (la.entryChecked ?? 0) >= 10 ? (la.entryContradicted ?? 0) / (la.entryChecked ?? 1) : 0;
          const remoteRate = (la.remoteChecked ?? 0) >= 10 ? (la.remoteContradicted ?? 0) / (la.remoteChecked ?? 1) : 0;
          const bad = entryRate > 0.15 || remoteRate > 0.15;
          checks.push({
            name: 'job_board_label_integrity',
            passed: !bad,
            responseTimeMs: 0,
            error: bad
              ? `label audit: ${Math.round(entryRate * 100)}% of sampled entry-band postings state 3+ years required, ${Math.round(remoteRate * 100)}% of remote-flagged state on-site only — tighten the detector; demotions only patch the sampled rows`
              : undefined,
          });
          if (bad && overallStatus === 'healthy') {
            overallStatus = 'degraded';
            errorMessage = errorMessage || 'Board label integrity: contradiction rate above 15%';
          }
        }
      }

      // Storage headroom: the scale program pushes the corpus past 300k
      // postings on an 8GB plan. Alert at 75% database usage — the one
      // failure mode that takes every feature down at once is out-of-disk.
      try {
        const { data: sf } = await supabase.rpc('get_storage_footprint');
        const row = Array.isArray(sf) ? sf[0] : sf;
        if (row && typeof row.db_bytes === 'number') {
          const PLAN_BYTES = 8 * 1024 ** 3;
          const usedPct = Math.round(100 * row.db_bytes / PLAN_BYTES);
          const tight = usedPct >= 75;
          checks.push({
            name: 'job_board_storage',
            passed: !tight,
            responseTimeMs: 0,
            error: tight
              ? `database at ${usedPct}% of the 8GB plan (postings ${Math.round(row.postings_bytes / 1024 ** 2)}MB, closures ${Math.round(row.closures_bytes / 1024 ** 2)}MB) — upgrade the plan or lower the corpus governor before ingest stalls`
              : undefined,
          });
          if (tight && overallStatus === 'healthy') {
            overallStatus = 'degraded';
            errorMessage = errorMessage || `Database storage at ${usedPct}% of plan`;
          }
        }
      } catch { /* RPC not applied yet */ }

      // Per-vendor date-parser canary: a vendor whose stated-date coverage
      // collapses means its date mapping regressed (the Lever evergreen bug
      // was found by hand; this catches the next one). BambooHR is exempt —
      // its feed carries no dates at all, disclosed as such.
      try {
        const { data: cov } = await supabase.rpc('get_date_coverage');
        if (Array.isArray(cov)) {
          const broken = (cov as Array<{ source: string; total: number; dated: number }>)
            .filter((r) => r.source !== 'bamboohr' && r.source !== 'rippling' && Number(r.total) >= 1000)
            .map((r) => ({ source: r.source, pct: Math.round(100 * Number(r.dated) / Math.max(Number(r.total), 1)) }))
            .filter((r) => r.pct < 50);
          checks.push({
            name: 'job_board_date_coverage',
            passed: broken.length === 0,
            responseTimeMs: 0,
            error: broken.length
              ? `stated-date coverage collapsed for ${broken.map((b) => `${b.source} ${b.pct}%`).join(', ')} — that vendor's date mapping likely regressed; age stats are losing their basis`
              : undefined,
          });
          if (broken.length && overallStatus === 'healthy') {
            overallStatus = 'degraded';
            errorMessage = errorMessage || `Vendor date coverage collapsed: ${broken.map((b) => b.source).join(', ')}`;
          }
        }
      } catch { /* RPC not applied yet */ }

      // Verification ceiling: boards that still hold live postings but weren't
      // re-verified in 24h — a widening count means a cursor/selection gap the
      // 48h sweep is about to start deleting around.
      try {
        const { data: staleCount } = await supabase.rpc('get_stale_board_count');
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
      } catch { /* RPC not applied yet — check appears once the migration lands */ }

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
      const capV = (cap?.v ?? {}) as { active?: boolean; headroom?: number; corpusBefore?: number; evicted?: number; ceiling?: number };
      const headroom = typeof capV.headroom === 'number'
        ? capV.headroom
        : (typeof capV.ceiling === 'number' && typeof capV.corpusBefore === 'number' ? capV.ceiling - capV.corpusBefore : null);
      const capTight = capV.active === true || (headroom !== null && headroom < 2000);
      checks.push({
        name: 'job_board_capacity',
        passed: !capTight,
        responseTimeMs: 0,
        error: capTight
          ? (capV.active
              ? `capacity governor active — evicted ${capV.evicted ?? '?'} stalest postings last pass (ceiling ${capV.ceiling ?? '?'}); widen the DB tier or trim board selection`
              : `corpus near cap — headroom ${headroom} below ceiling ${capV.ceiling ?? '?'}`)
          : undefined,
      });
      if (capTight) {
        if (overallStatus === 'healthy') overallStatus = 'degraded';
        errorMessage = errorMessage || `Job board near capacity (${capV.active ? 'governor evicting' : `headroom ${headroom}`})`;
      }

      // Disk headroom: the governor caps ROWS, but nothing watched BYTES on the
      // 8GB plan — approach disk pressure blind and you discover it under load.
      // Warn at 70% so the tier gets widened deliberately. If the size RPC isn't
      // migrated yet, skip silently (not an incident).
      const { data: sizeStats, error: sizeErr } = await supabase.rpc('get_db_size_stats');
      if (!sizeErr && sizeStats) {
        const sz = sizeStats as { db_bytes?: number; postings_bytes?: number };
        const dbBytes = typeof sz.db_bytes === 'number' ? sz.db_bytes : 0;
        const PLAN_BYTES = 8 * 1024 * 1024 * 1024; // 8 GB plan
        const usedPct = dbBytes > 0 ? Math.round((dbBytes / PLAN_BYTES) * 100) : 0;
        const diskTight = usedPct >= 70;
        checks.push({
          name: 'job_board_disk',
          passed: !diskTight,
          responseTimeMs: 0,
          error: diskTight
            ? `database at ${usedPct}% of the 8GB plan (${(dbBytes / 1e9).toFixed(2)} GB total, postings ${((sz.postings_bytes ?? 0) / 1e9).toFixed(2)} GB) — widen the DB tier before raising the row governor`
            : undefined,
        });
        if (diskTight) {
          if (overallStatus === 'healthy') overallStatus = 'degraded';
          errorMessage = errorMessage || `Database near disk cap (${usedPct}% of 8GB)`;
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
      const timeoutId = setTimeout(() => controller.abort(), 15000);
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

    console.log(`[SCAN-HEARTBEAT] ${overallStatus} | Total: ${totalTime}ms | Checks: ${checks.map(c => `${c.name}:${c.passed}`).join(', ')}`);

    // Send alert if status is not healthy
    if (overallStatus !== 'healthy') {
      EdgeRuntime.waitUntil(sendHeartbeatAlert(overallStatus, errorMessage, checks, totalTime));
    }

    return new Response(
      JSON.stringify({
        status: overallStatus,
        timestamp: new Date().toISOString(),
        responseTimeMs: totalTime,
        checks,
        errorMessage
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
        errorMessage: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 503, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

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

    // Durable dedupe, same pattern as free-keyword-scan's alerts: on a 10-min
    // schedule an outage would otherwise mean 6 emails/hour. check_rate_limit
    // is atomic and global across isolates; cap 2/hour. Best-effort — a
    // dedupe failure must never swallow a real alert.
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

    const failedChecks = checks.filter(c => !c.passed);
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
        subject: `${statusEmoji} Scan Heartbeat Alert: ${status.toUpperCase()}`,
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
