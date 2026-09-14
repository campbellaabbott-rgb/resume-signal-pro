-- A BOARD THAT GREW IS A RATE WITH GATES, NOT A COUNT.
--
-- THE OWNER'S DECISION (2026-09-09): "Actively hiring" is takedowns we watched
-- PLUS the rate at which an employer is posting new roles -- "the key is to
-- recognize smaller companies that are hiring to demonstrate growth patterns;
-- of course the huge companies have a lot of openings". A count cannot do
-- that. A rate can, and only a rate with gates can do it without lying about
-- a named small company. Since 2026-09-09 nine locales have said the
-- new-postings half "joins once we hold enough days of our own counts". This
-- file is what makes that sentence true, and the copy that said it retires
-- with it.
--
-- WHAT IS MEASURED. For one BOARD (company_token is the vendor tenant, not the
-- employer -- PwC holds four, every eu~ mirror is its own; no company-entity
-- mapping exists, so nothing here sums across tokens):
--
--   rate = (open_roles_served[latest_day] - open_roles_served[baseline_day])
--          / open_roles_served[baseline_day]
--
-- from public.job_board_company_snapshots, the 02:30 UTC daily level series.
-- open_roles_served is the count the board SERVES (missing_since IS NULL AND
-- effective_posted >= now() - 30 days), written from 2026-09-06 and NULL
-- before, never backfilled. NEVER open_roles: its own COMMENT ON COLUMN says
-- it is not open roles -- it counts missing_since rows and rows past the
-- 30-day fence -- and a card built on it would promise a number the
-- destination page does not show. The baseline is THE DAY'S served count, not
-- a trailing average: the series began 2026-09-06, so on the day this ships a
-- trailing average would be averaging days that do not exist. A 7-day window
-- is computable from 2026-09-13; a 28-day one from 2026-10-04.
--
-- snapshot_date is OUR observation date. It carries no posting age. first_seen
-- is never a posting age either (the 2.8-day-median incident), and nothing in
-- this file reads it.
--
-- THE GATES, each with the measurement that set it. The bars are MODELLED,
-- not observed: the served series is locked (anon cannot read the table), so
-- the one-day noise floor was built from each board's own measured departure
-- rate through get_company_fill_curve on the 2026-09-03 onboarding cohort
-- (841 boards, 7-12 tracking days; departures/day p50 1.86, p95 11.1;
-- turnover/day p50 5.7%) and a Skellam(lambda, lambda) model of a STATIONARY
-- board's one-day net delta. The cohort carries a backlog crossing the 30-day
-- fence, so its turnover -- and therefore this floor -- runs high.
--
--   MIN_BASELINE_SERVED = 10. One role = 10% resolution. 91.3% of measured
--     boards sit at or above it; a floor of 20 would discard another 33% (the
--     10-19 band, 281/841), and that band is exactly the "smaller companies"
--     the owner asked to recognise. The floor stays at 10 and the net-add bar
--     carries the noise defence there.
--
--   MIN_NET_ADD = 4 -- RAISED from the house precedent of 3, and here is why.
--     The rule is that it must sit strictly ABOVE the p95 one-day |delta| of a
--     non-growing board in the smallest admitted band. Modelled p95 for the
--     10-19 band is 3 (one-day) and 3-4 at two endpoints (a 7-day endpoint
--     difference jitters at BOTH ends), so 3 is AT the floor, not above it.
--     4 clears one-day p95 for 10-19 (3) and equals it for 20-49 (4), where
--     the rate bar does the work. Pooled one-day |delta| p95 across all sizes
--     is 5, driven by 200+ boards where the rate bar refuses anyway.
--
--   MIN_RATE = 0.25 -- RAISED from the design's 15%. Pooled one-day |rate| p95
--     is 16.7% and the 20-49 band's p95 is exactly 15.0% (p99 22.7%), so 15%
--     is inside the noise. 25% is strictly above one-day p99 for every band
--     >= 20 and above two-endpoint p95 at median turnover for every band
--     >= 20; in the 10-19 band the net-add bar (4 of 10 = 40%) dominates.
--     Combined false-"grew" share on stationary boards >= 10 served: 1.36%,
--     against 4.95% for the 3 / 15% pair. A board must clear BOTH.
--
--   READ QUALITY -- the load-bearing gate. Every day in the window must carry
--     a job_board_board_state row for this token with state = 'ok', bucketed
--     by EQUALITY against the writer's vocabulary (ok | empty | truncated |
--     error | dark). Never `state <> 'truncated'`: a day with no row is NULL
--     on the LEFT JOIN, NULL <> 'truncated' is NULL, and the trap that
--     get_closure_population documents would admit every board we never
--     visited. This is what stops a deep cursor walking a giant board (CVS:
--     678 stored against 19,265 advertised) from publishing as +2,700%.
--     get_trending_companies, on stored counts with no such gate, ranks
--     careers.ulta.com +340% today: a cursor walk wearing a growth figure.
--     'empty' and 'dark' are NOT ok here either -- a served count taken on a
--     day the feed answered with nothing is not a reading of the board.
--
--     THE LEDGER IS CHECKED ONE DAY EARLIER THAN THE SERIES. A snapshot dated
--     D is taken at 02:30 UTC on D over job_board_postings as they stand, so
--     it is the product of the reads dated D-1 (and the first two and a half
--     hours of D); board_state.observed_on is the read's own UTC date. The
--     read that produced the BASELINE count is therefore dated
--     baseline_day - 1, and a gate that only looked at the snapshot days
--     would never see it. A partial read never stamps missing_since ("absence
--     unprovable -- do not stamp", job-board/index.ts), so a 'truncated' read
--     can only UNDERSTATE a count; a board read 'truncated' through
--     baseline_day - 1 and in full from baseline_day onward would publish its
--     first whole read as +N00% on the day the baseline fell on the
--     transition -- the CVS failure, once, for every board that ever moves
--     from windowed to whole (a cap raise, a feed shrinking under the page
--     cap, a fetcher fix). So the ledger window is
--     [baseline_day - 1, latest_day]: ledger_days_expected = window + 2 = 9
--     rows for an 8-row series, every one of them 'ok'. The far end reads
--     one day past the read that produced latest_day's count; that is a day
--     of extra strictness, in the refusing direction, and it is kept.
--
--   MIN TRACKING. A served row on BOTH endpoints and on at least
--     ceil(0.8 x window) interior days -- which at 7 is all six, so all eight
--     rows. days_observed and days_expected are returned. A gap REFUSES
--     (unknown / series_gap); it never silently shortens the window, which is
--     what get_trending_companies' "min(snapshot_date) within 7 days" does.
--     So one missed 02:30 run refuses the whole board population for seven
--     days. That is the intent: a 7-day label over a 5-day difference is a
--     different number wearing the same words.
--
--   TENURE. The board's first snapshot must be at least MIN_TENURE_DAYS = 21
--     days before the baseline day. When first_snapshot_day equals the
--     table's own min(snapshot_date) the series is CENSORED there:
--     tenure_days is then a FLOOR ("tracked at least N days", never
--     "onboarded then"), tenure_censored is true, and the gate passes when
--     the floor clears 21 -- today the floor is well past it. Read the other
--     way ("must be strictly after the table min") the clause would push
--     every board present on the series' first day -- the bulk of ~44k --
--     into unknown forever. A censored board's first_snapshot_day is not an
--     onboarding date and no surface may print it as one. Too new is UNKNOWN,
--     never no-growth: >= 3,160 boards onboarded 2026-09-02/03 clear on a
--     7-day window from 2026-10-01.
--
--   EDITORIAL. showcase_excluded tokens are unknown / excluded (14 today).
--     Ranking employers against each other is an editorial surface by this
--     repo's own rule (get_relisting_employers); a pure serving count would
--     not exclude, and this is not one.
--
-- DEPARTURES WE CAUSED ARE NOT SHRINKAGE. job_board_company_flow's
-- departures_untracked (20260909212000) are OUR actions -- the Oracle dedupe
-- of 2026-09-10 exited 14,652 rows as untracked. They lower a served count
-- without the employer doing anything. In a level difference that can only
-- push a board TOWARD no-growth (the safe direction for a claim that speaks
-- well of an employer), so it is not gated -- but the sum over the window is
-- returned as untracked_departures (NULL when no flow row exists, never a
-- fabricated 0) so a surface can refuse to characterise a fall, and no
-- surface may render "no-growth" as "shrinking".
--
-- A POOL THAT WAS REPLACED DID NOT GROW. open_roles_served fences undated
-- rows on first_seen (effective_posted = first_seen when the ATS states no
-- date), so on an undated board a vendor re-issuing every posting id makes a
-- full read stamp every old id missing and insert every new id with
-- first_seen = today: the served count jumps from "undated rows we first saw
-- in the last 30 days" to "the whole board" -- 30 to 100, +233%, every gate
-- above passed -- while the employer changed an ATS setting and nothing else.
-- That is defence (c) in 20260909212000's header, and the tell it names is
-- departures_removed ~ arrivals_observed ~ served_start. The gate here is the
-- simplest form of it: when more roles LEFT the pool over the window
-- (job_board_company_flow.departures_removed, the one departure class that is
-- the employer's feed stopping to list a role) than the pool HELD at the
-- baseline, the two counts are not the same pool and no rate between them is
-- a reading of growth: unknown / pool_replaced. That also refuses a board
-- whose whole inventory genuinely turned over inside a week -- a rate over a
-- pool that was entirely replaced is not what "grew" means either, and
-- unknown-with-reason is the safe direction. removed_departures and
-- observed_arrivals are returned for every token so the day-one query can
-- size this bucket by band. MODELLED from the pipeline's rules, not observed
-- on the served series; checked by the same service-role query as the bars.
--
-- THREE STATES, AND THE THIRD IS NOT A NO.
--   grew        every gate passed, net >= MIN_NET_ADD AND rate >= MIN_RATE
--   no-growth   every gate passed, the bar not cleared: a reading we can
--               support -- we watched this board in full and the pool did not
--               rise by that much. The only verdict a surface may render
--               silently.
--   unknown     a gate failed, WITH THE REASON RETAINED in unknown_reason, in
--               this order of precedence (first failure wins):
--                 excluded       showcase_excluded
--                 series_stale   the served series' latest day is older than
--                                yesterday (the 02:30 cron has not landed for
--                                two days; every token answers this)
--                 no_series      this token has never been snapshotted
--                 too_new        first snapshot fewer than MIN_TENURE_DAYS
--                                before the baseline (or after it)
--                 series_gap     an endpoint or an interior served row missing
--                 too_small      baseline served < MIN_BASELINE_SERVED
--                 pool_replaced  removed departures over the window >= the
--                                baseline served count (the pool turned over
--                                or was re-keyed under us)
--                 not_in_ledger  no board_state row at all in the ledger
--                                window [baseline_day - 1, latest_day]
--                 windowed_read  a day in the window read 'truncated'
--                 failed_read    a day read 'error', 'dark', 'empty' or a
--                                value outside the vocabulary
--                 ledger_gap     a day in the ledger window with no
--                                board_state row
--               The unknown bucket is COUNTED on screen with its reason, as
--               partitionByHiringRecord does for takedowns.
--
-- THE RPC OWNS THE VERDICT, as get_company_fill_curve owns `sufficient`: the
-- client renders verdict and unknown_reason and never re-derives the bar from
-- net and rate. The bars are mirrored in src/pages/Jobs.tsx for COPY only,
-- and a guard pins those mirrors to the k CTE below. Batched like the fill
-- curve: FROM toks t LEFT JOIN ..., a row for every token asked. A token we
-- have never seen answers unknown / no_series, not an absent row.
--
-- WHAT THIS PUBLISHES, AND WHAT IT KEEPS PRIVATE. SECURITY DEFINER with a
-- deliberate anon EXECUTE, because neither table is anon-readable
-- (job_board_company_snapshots: 42501 since 20260820233000;
-- job_board_board_state: RLS on, no policy) and the client can compute nothing
-- itself. It returns AGGREGATES ONLY: two served counts on two named days, a
-- verdict, counts of ledger days -- never a per-day series row and never a
-- ledger state by date. The moat memory stands: the ledger stays private.
--
-- CALIBRATION, WRITTEN HERE SO IT HAPPENS. Every bar above is modelled from
-- measured departure rates, not observed from open_roles_served differences.
-- This function returns baseline_served, latest_served, net and rate for
-- every token whether or not it clears the gates, so ONE service-role query
-- on day one -- p95 of |rate| and |net| over boards with verdict in ('grew',
-- 'no-growth') and baseline_served in each size band -- can replace the model
-- with the observed floor. If the observed p95 one-day |delta| for the 10-19
-- band is >= 4, or the observed p95 |rate| for any band >= 20 is >= 0.25,
-- raise the bar in k, re-issue this function, and move the mirror in
-- Jobs.tsx with it; the guard will not let one move without the other.
--
-- ONE FUNCTION IN THIS FILE. The plpgsql-out-params guard slices the newest
-- migration mentioning a function from first dollar-quote to last, so a
-- second function here would make that guard read a body it is not looking
-- at (the get_board_flow lesson, 20260909202000). LANGUAGE sql, so RETURNS
-- TABLE names are not variables in scope: no 42702 is possible here, and the
-- OUT names are still distinct from every column they are computed from.
--
-- Executed in pglite before shipping: scripts/verify-migration-20260909227000.mjs
-- seeds the four tables with boards worked by hand for every verdict and
-- every reason, proves the NULL trap on a mutant that buckets on
-- `IS DISTINCT FROM 'truncated'`, proves that a 'truncated' or 'error' read
-- on baseline_day - 1 alone refuses the board (and one on baseline_day - 2
-- alone does not), and proves the stale-series refusal.

-- THE SHAPE IS NEW, SO THE CATALOGUE IS CLEARED BY NAME FIRST. The live
-- database has held overloads no migration file describes (schema-drift
-- memory); the drop enumerates pg_proc rather than trusting a hand-listed
-- signature. Grants are discarded by the drop and re-issued at the foot.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = 'get_company_growth'
  LOOP
    RAISE NOTICE 'dropping % ahead of its issue', r.sig;
    EXECUTE 'DROP FUNCTION ' || r.sig::text;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.get_company_growth(p_tokens text[])
RETURNS TABLE (
  company_token         text,
  window_days           int,
  baseline_day          date,
  baseline_served       int,
  latest_day            date,
  latest_served         int,
  net                   int,
  rate                  numeric,
  days_observed         int,
  days_expected         int,
  ledger_days_expected  int,
  board_days_ok         int,
  board_days_bad        int,
  first_snapshot_day    date,
  tenure_days           int,
  tenure_censored       boolean,
  untracked_departures  int,
  removed_departures    int,
  observed_arrivals     int,
  verdict               text,
  unknown_reason        text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '25s'
AS $$
  WITH toks AS (
    SELECT DISTINCT unnest(p_tokens) AS tok
  ),
  -- ── the bars, named once. The header says where each number came from and
  --    what observation would move it. Jobs.tsx mirrors these for copy and a
  --    guard pins the mirror to this block. ────────────────────────────────
  k AS (
    SELECT 7                  AS window_days,
           10                 AS min_baseline_served,
           4                  AS min_net_add,
           0.25::numeric      AS min_rate,
           21                 AS min_tenure_days,
           'ok'::text         AS read_state_ok,
           1                  AS max_series_lag_days
  ),
  -- The window is GLOBAL: anchored on the served series' latest day, so every
  -- token in a batch is read over the same two dates and the figures are
  -- comparable. A token missing the latest day is a series gap for that
  -- token, not a shorter window.
  bounds AS (
    SELECT (SELECT max(s.snapshot_date)
              FROM public.job_board_company_snapshots s
             WHERE s.open_roles_served IS NOT NULL)      AS latest_day,
           (SELECT min(s.snapshot_date)
              FROM public.job_board_company_snapshots s) AS series_floor
  ),
  win AS (
    SELECT b.latest_day,
           b.latest_day - k.window_days                  AS baseline_day,
           k.window_days + 1                             AS days_expected,
           -- The ledger runs one day EARLIER than the series: a snapshot dated
           -- D is the product of the read dated D-1 (header, READ QUALITY).
           k.window_days + 2                             AS ledger_days_expected,
           -- ceil(0.8 x window) interior days: at 7 that is all six.
           ceil(0.8 * k.window_days)::int                AS min_interior_days,
           b.series_floor,
           (b.latest_day < current_date - k.max_series_lag_days) AS series_stale
      FROM bounds b CROSS JOIN k
  ),
  -- The served rows inside the window, per token. open_roles_served IS NULL
  -- means NOT MEASURED (a pre-2026-09-06 row), so it does not count as a day.
  ser AS (
    SELECT t.tok,
           count(s.snapshot_date) FILTER (WHERE s.open_roles_served IS NOT NULL)::int AS days_observed,
           max(s.open_roles_served) FILTER (WHERE s.snapshot_date = w.baseline_day)  AS baseline_served,
           max(s.open_roles_served) FILTER (WHERE s.snapshot_date = w.latest_day)    AS latest_served
      FROM toks t
      CROSS JOIN win w
      LEFT JOIN public.job_board_company_snapshots s
             ON s.company_token = t.tok
            AND s.snapshot_date BETWEEN w.baseline_day AND w.latest_day
     GROUP BY t.tok
  ),
  -- Board tenure from snapshot APPEARANCE, never from first_seen.
  ten AS (
    SELECT t.tok,
           min(s.snapshot_date) AS first_snapshot_day
      FROM toks t
      LEFT JOIN public.job_board_company_snapshots s ON s.company_token = t.tok
     GROUP BY t.tok
  ),
  -- The read-quality ledger over [baseline_day - 1, latest_day] -- the reads
  -- that PRODUCED the window's snapshots, the 02:30 snapshot dated D being
  -- the product of the read dated D-1 -- bucketed BY EQUALITY on the writer's
  -- vocabulary. A day with no row is neither ok nor bad; it is counted as a
  -- gap below (ledger_days_expected - ok - bad).
  led AS (
    SELECT t.tok,
           count(bs.observed_on) FILTER (WHERE bs.state = k.read_state_ok)::int             AS board_days_ok,
           count(bs.observed_on) FILTER (WHERE bs.state IS DISTINCT FROM k.read_state_ok)::int AS board_days_bad,
           count(bs.observed_on) FILTER (WHERE bs.state = 'truncated')::int                 AS board_days_truncated,
           count(bs.observed_on)::int                                                       AS board_days_any
      FROM toks t
      CROSS JOIN win w
      CROSS JOIN k
      LEFT JOIN public.job_board_board_state bs
             ON bs.company_token = t.tok
            AND bs.observed_on BETWEEN w.baseline_day - 1 AND w.latest_day
     GROUP BY t.tok
  ),
  -- The flow ledger across the days whose difference the rate spans: our own
  -- removals (never shrinkage), and the employer's removals and our observed
  -- arrivals (the pool-replacement tell). Both endpoint days are INCLUDED: a
  -- snapshot dated D is taken at 02:30 on D, so day D's flow straddles it,
  -- and over-covering by a day at each end only pushes the gate below toward
  -- refusal and the untracked figure upward, neither of which any surface
  -- turns into a claim.
  flo AS (
    SELECT t.tok,
           sum(f.departures_untracked)::int AS untracked_departures,
           sum(f.departures_removed)::int   AS removed_departures,
           sum(f.arrivals_observed)::int    AS observed_arrivals
      FROM toks t
      CROSS JOIN win w
      LEFT JOIN public.job_board_company_flow f
             ON f.company_token = t.tok
            AND f.flow_date BETWEEN w.baseline_day AND w.latest_day
     GROUP BY t.tok
  ),
  ex AS (
    SELECT x.company_token AS tok FROM public.showcase_excluded x
  ),
  calc AS (
    SELECT t.tok,
           w.latest_day,
           w.baseline_day,
           w.days_expected,
           w.ledger_days_expected,
           w.series_stale,
           s.days_observed,
           s.baseline_served,
           s.latest_served,
           (s.latest_served - s.baseline_served)                                   AS net_roles,
           CASE WHEN s.baseline_served > 0
                THEN round((s.latest_served - s.baseline_served)::numeric / s.baseline_served, 4)
                ELSE NULL END                                                       AS growth_rate,
           tn.first_snapshot_day,
           (w.baseline_day - tn.first_snapshot_day)::int                            AS tenure_d,
           (tn.first_snapshot_day IS NOT NULL AND tn.first_snapshot_day = w.series_floor) AS censored,
           l.board_days_ok, l.board_days_bad, l.board_days_truncated, l.board_days_any,
           fl.untracked_departures,
           fl.removed_departures,
           fl.observed_arrivals,
           (ex.tok IS NOT NULL)                                                     AS is_excluded,
           w.min_interior_days
      FROM toks t
      CROSS JOIN win w
      JOIN ser s   ON s.tok  = t.tok
      JOIN ten tn  ON tn.tok = t.tok
      JOIN led l   ON l.tok  = t.tok
      JOIN flo fl  ON fl.tok = t.tok
      LEFT JOIN ex ON ex.tok = t.tok
  ),
  judged AS (
    SELECT c.*,
           CASE
             WHEN c.is_excluded                                             THEN 'excluded'
             WHEN c.series_stale                                            THEN 'series_stale'
             WHEN c.first_snapshot_day IS NULL                              THEN 'no_series'
             WHEN c.tenure_d < k.min_tenure_days                            THEN 'too_new'
             WHEN c.baseline_served IS NULL OR c.latest_served IS NULL
               OR (c.days_observed - 2) < c.min_interior_days               THEN 'series_gap'
             WHEN c.baseline_served < k.min_baseline_served                 THEN 'too_small'
             WHEN c.removed_departures >= c.baseline_served                 THEN 'pool_replaced'
             WHEN c.board_days_any = 0                                      THEN 'not_in_ledger'
             WHEN c.board_days_truncated > 0                                THEN 'windowed_read'
             WHEN c.board_days_bad > 0                                      THEN 'failed_read'
             WHEN c.board_days_ok < c.ledger_days_expected                  THEN 'ledger_gap'
             ELSE NULL
           END AS reason
      FROM calc c CROSS JOIN k
  )
  SELECT j.tok                                   AS company_token,
         k.window_days                           AS window_days,
         j.baseline_day                          AS baseline_day,
         j.baseline_served                       AS baseline_served,
         j.latest_day                            AS latest_day,
         j.latest_served                         AS latest_served,
         j.net_roles                             AS net,
         j.growth_rate                           AS rate,
         j.days_observed                         AS days_observed,
         j.days_expected                         AS days_expected,
         j.ledger_days_expected                  AS ledger_days_expected,
         j.board_days_ok                         AS board_days_ok,
         j.board_days_bad                        AS board_days_bad,
         j.first_snapshot_day                    AS first_snapshot_day,
         j.tenure_d                              AS tenure_days,
         j.censored                              AS tenure_censored,
         j.untracked_departures                  AS untracked_departures,
         j.removed_departures                    AS removed_departures,
         j.observed_arrivals                     AS observed_arrivals,
         CASE
           WHEN j.reason IS NOT NULL THEN 'unknown'
           WHEN j.net_roles >= k.min_net_add AND j.growth_rate >= k.min_rate THEN 'grew'
           ELSE 'no-growth'
         END                                     AS verdict,
         j.reason                                AS unknown_reason
    FROM judged j CROSS JOIN k
   ORDER BY j.tok
$$;

COMMENT ON FUNCTION public.get_company_growth(text[]) IS
  'Per-BOARD (company_token, never summed across an employer) growth verdict '
  'from the daily served-pool snapshot: rate = (open_roles_served[latest_day] '
  '- open_roles_served[baseline_day]) / open_roles_served[baseline_day] over a '
  'window_days window anchored on the series'' latest day. snapshot_date is '
  'OUR observation date and carries no posting age. THE RPC OWNS THE VERDICT: '
  'grew (net >= 4 AND rate >= 0.25 with every gate passed), no-growth (gates '
  'passed, bar not cleared -- the only verdict a surface may render silently), '
  'unknown with unknown_reason in (excluded, series_stale, no_series, too_new, '
  'series_gap, too_small, pool_replaced, not_in_ledger, windowed_read, '
  'failed_read, ledger_gap). GATES: baseline_served >= 10; served rows on both '
  'endpoints and all ceil(0.8 x window) interior days (a gap refuses, never '
  'shortens); every day from baseline_day - 1 to latest_day (the reads that '
  'produced the window''s snapshots -- a snapshot dated D is taken at 02:30 on '
  'D from the read dated D-1) a job_board_board_state row with state = ''ok'', '
  'bucketed by equality (a missing day is a gap, never ok); removed_departures '
  '(job_board_company_flow.departures_removed over the window) below the '
  'baseline served count, else the pool was replaced under us and no rate '
  'between the two counts reads growth; first snapshot >= 21 days '
  'before the baseline, where tenure_days is a FLOOR when tenure_censored '
  '(first_snapshot_day = the table''s own min and is not an onboarding date); '
  'showcase_excluded out. untracked_departures sums job_board_company_flow.'
  'departures_untracked over the window (NULL when no flow row) -- OUR removals, '
  'so a fall is never rendered as shrinking. Bars modelled from measured '
  'departure rates (header); net and rate are returned for every token so a '
  'service-role query can replace the model with the observed floor. Returns '
  'a row for every token asked; aggregates only, never a per-day series row. '
  'SECURITY DEFINER with anon EXECUTE on purpose: neither source table is '
  'anon-readable. A rise in roles served is roles opened net of roles that came '
  'down, on one board; it is never a hire and never a headcount.';

GRANT EXECUTE ON FUNCTION public.get_company_growth(text[]) TO anon, authenticated, service_role;

-- Self-verifying: exactly one definition, carrying the verdict columns.
DO $$
DECLARE n int; cols text;
BEGIN
  SELECT count(*) INTO n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_company_growth';
  IF n <> 1 THEN
    RAISE EXCEPTION 'get_company_growth: expected exactly one definition, found %', n;
  END IF;
  SELECT pg_get_function_result(p.oid) INTO cols
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'get_company_growth';
  IF cols NOT LIKE '%verdict%' OR cols NOT LIKE '%unknown_reason%' OR cols NOT LIKE '%tenure_censored%' THEN
    RAISE EXCEPTION 'get_company_growth: issued without the verdict columns: %', cols;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
