-- A RATE NEEDS A CLOCK, AND THE CLOCK CAN ONLY BE STARTED ONCE.
--
-- The owner wants a hiring signal that surfaces SMALL GROWING employers --
-- "of course the huge companies have a lot of openings". A count cannot do
-- that; only a RATE can. A rate needs a SERIES, and the two series this
-- database holds both began three days ago:
--
--   job_board_company_snapshots.open_roles_served   first written 2026-09-06
--   job_board_board_state                            first written 2026-09-06
--
-- Neither of them records an ARRIVAL. They record LEVELS: how many roles a
-- board held on a day. A difference of levels is a NET number, and a net
-- number cannot tell a company that posted forty roles and closed thirty-nine
-- apart from a company that posted one. The gross arrival count -- and the
-- corroboration that says whether an arrival was the employer's action or ours
-- -- exists for exactly as long as the posting row does, and posting rows are
-- HARD-DELETED at closure. Every day without this table is a day that can
-- never be reconstructed, by us or by anyone.
--
-- THIS FILE COLLECTS. IT PUBLISHES NOTHING. There is no RPC, no grant to anon,
-- no reader. That is deliberate and it is also the risk: a broken write here
-- turns nothing red. The guard is that the writer is one function called by
-- one cron, it is idempotent, and its output is dated and self-describing.
--
-- ═════════════════════════════════════════════════════════════════════════
-- 1. THE TRAP THIS FILE EXISTS TO DEFEAT: first_seen IS OUR CLOCK.
-- ═════════════════════════════════════════════════════════════════════════
--
-- job_board_postings.first_seen is when WE first stored a posting. It is NOT
-- when the employer posted it. This distinction has already cost this product
-- twice: the "2.8-day median age of an open posting" the owner caught in July
-- (computed as now() - first_seen across a catalog that was doubling), and the
-- mass re-ingest around 2026-07-11 that reset first_seen for the whole table,
-- leaving no row older than that date and therefore no "established board"
-- cohort to gate on.
--
-- A growth rate built on first_seen alone would say, of a board we onboarded
-- yesterday, that the employer posted their entire catalog yesterday. Applied
-- to NAMED SMALL COMPANIES -- which is the entire point of the signal -- that
-- is a confident, specific falsehood about a third party. It is the same class
-- of error this product spent today correcting for large employers, aimed at
-- the parties least able to object.
--
-- FOUR DISTINCT WAYS A NON-ARRIVAL LOOKS LIKE AN ARRIVAL, and this table's
-- shape is chosen so a reader can tell each of them apart LATER:
--
--   (a) BOARD ONBOARDING. Day zero of a board stamps first_seen on every
--       posting it holds. Defended by: job_board_board_watch.first_observed_on
--       (a board's watch tenure, so a window that includes its first observed
--       day can be refused) AND by arrivals_corroborated below.
--
--   (b) A PARTIAL READ THAT PAGES IN OLD ROLES. MAX_POSTINGS_PER_VISIT is 250.
--       A board bigger than one visit is walked by a deep cursor, so the first
--       visit to reach offset 250-500 INSERTS postings that have been on the
--       employer's board for months. Every one of them gets first_seen = today.
--       This is the sharpest form of the trap because it recurs on every lap,
--       not just at onboarding. Defended by: read_state (the fetch was
--       'truncated') AND, decisively, by arrivals_corroborated -- a role paged
--       in late carries an employer-stated post date that is old, or none at
--       all, and is excluded.
--
--   (c) A VENDOR MIGRATION THAT RE-IDS EVERY POSTING. The posting id is
--       source:token:externalId, so a vendor re-issuing its external ids makes
--       the whole board arrive and the whole board depart on one day.
--       Defended by: recording arrivals AND departures as GROSS counts on the
--       same row, next to the day's level. The tell is
--       arrivals_observed ~ departures_removed ~ served_start with
--       arrivals_corroborated near zero. A net-difference series cannot see
--       this at all; it reads as a quiet day.
--
--   (d) THE ROTATION LAP. Boards are not visited daily. A board last read four
--       days ago books four days of the employer's postings under one date.
--       Defended by: prev_observed_on, which makes the accumulation interval
--       an explicit column instead of an assumption. arrivals_observed
--       divided by (flow_date - prev_observed_on) is the per-day rate; the
--       raw column is NOT a daily rate and must never be used as one.
--
-- ═════════════════════════════════════════════════════════════════════════
-- 2. THE CORROBORATOR, AND WHY IT IS THE EXISTING DEFINITION AND NOT A NEW ONE
-- ═════════════════════════════════════════════════════════════════════════
--
-- get_hiring_trends (20260715160000) already solved "which new postings did we
-- observe near the employer's own posting time", for the same reason, in the
-- same words: "when new companies join the catalog their backlog would
-- otherwise appear as a fake hiring spike". Its guard is
--
--     posted_at IS NOT NULL AND first_seen - posted_at < interval '3 days'
--
-- and arrivals_corroborated below is that predicate, unchanged, per board per
-- day. It is NOT a second definition of the same idea. Three days is this
-- file's constant only in the sense that it is the repo's constant; a build
-- that wants a different one changes both sites or it has forked the meaning.
--
-- THE THREE ARRIVAL COLUMNS ARE A LADDER, WIDEST TO NARROWEST:
--   arrivals_observed      every posting whose first_seen fell on this day.
--                          Contaminated by all four cases above.
--   arrivals_dated         those of them the employer put a date on at all.
--                          The denominator of the corroboration rate.
--   arrivals_corroborated  those the employer dated within three days of our
--                          seeing it. The only one of the three that is a
--                          defensible numerator for a published growth rate.
--
-- Storing all three rather than only the last is the point of the file: the
-- ratio between them IS the confidence, and it cannot be recovered afterwards.
--
-- ═════════════════════════════════════════════════════════════════════════
-- 3. THIS FILE TOUCHES NO HOT TABLE'S LOCKS.
-- ═════════════════════════════════════════════════════════════════════════
--
-- 20260909211000 exists because a seed ran inside the transaction that had
-- just taken ACCESS EXCLUSIVE on job_board_board_state, holding it for the
-- index build plus up to ten minutes of measurement against a table the
-- ingest upserts 24/7.
--
-- The rule that incident produced is honoured here structurally rather than by
-- care: BOTH tables created below are NEW, so their indexes are built on empty
-- relations that no other session can be queued behind, and the seed writes
-- ONLY to one of those new tables. Every existing table this file names
-- (job_board_board_state, job_board_company_snapshots, job_board_postings,
-- job_board_exits) is READ, which takes ACCESS SHARE and blocks no writer.
--
-- NO INDEX IS CREATED ON job_board_postings. A btree on first_seen would make
-- the nightly arrival scan cheaper and is exactly the statement that wedged
-- the pool on 2026-07-19. The collector eats a sequential scan of ~945k rows
-- once a night, off the request path, inside its own timeout, instead.
--
-- The seed is still wrapped in its own handler with its own timeout: a slow
-- seed must degrade the tenure floor of a table nothing reads yet, never fail
-- a deploy.
--
-- ═════════════════════════════════════════════════════════════════════════
-- 4. RETENTION: NONE, DELIBERATELY, FOR THE REASON job_board_board_state
--    STATES AND job_board_exits LEARNED THE HARD WAY.
-- ═════════════════════════════════════════════════════════════════════════
--
-- The whole value of this table is that it is LONG. It is also irreversible:
-- it is computed from job_board_postings rows that are hard-deleted at
-- closure and from job_board_exits rows pruned at ninety days, so a bare
-- DELETE here destroys something no later job can rebuild -- which is
-- precisely what 20260906218000 caught scheduled against the exit ledger. A
-- prune here needs a rollup first, and there is nothing to roll up yet.
--
-- Size is OBSERVED, not assumed: a nightly probe stamps the table's bytes and
-- date span into job_board_meta, the same shape the dim-snapshot size job
-- uses, so this decision is checked against reality rather than discovered by
-- a full disk. Order of magnitude: a row is written only for a board that was
-- OBSERVED or that MOVED on that date, so at ~33,600 boards on a rotation that
-- laps in a day or two this is ~20k narrow rows a day, ~7M a year -- under
-- half of what job_board_board_state accrues in the same period with no prune.


-- ═════════════════════════════════════════════════════════════════════════
-- THE TENURE TABLE: HOW LONG WE CAN PROVE WE HAVE BEEN WATCHING A BOARD.
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.job_board_board_watch (
  company_token        text PRIMARY KEY,
  first_observed_on    date NOT NULL,
  first_observed_basis text NOT NULL,
  is_censored          boolean NOT NULL DEFAULT false,
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.job_board_board_watch
  DROP CONSTRAINT IF EXISTS job_board_board_watch_basis_check;
ALTER TABLE public.job_board_board_watch
  ADD CONSTRAINT job_board_board_watch_basis_check
  CHECK (first_observed_basis IN ('board_state', 'company_snapshot'));

COMMENT ON TABLE public.job_board_board_watch IS
  'One row per board: the earliest date we can PROVE we were observing it. '
  'Exists because a growth rate computed over a window that contains a '
  'board''s first observed day reports our onboarding as the employer''s '
  'hiring. This is the ONLY admissible board-age source in this database: '
  'min(job_board_postings.first_seen) is not one, because a mass re-ingest '
  'around 2026-07-11 reset first_seen for the entire table and left nothing '
  'older than that date. Private: RLS on, no policy, service_role only.';

COMMENT ON COLUMN public.job_board_board_watch.company_token IS
  'The BOARD identity (vendor tenant), not the employer: one employer may hold '
  'several tokens (PwC has four) and every eu~ mirror is its own token. Do not '
  'sum across tokens without a company-entity mapping, which does not exist.';

COMMENT ON COLUMN public.job_board_board_watch.first_observed_on IS
  'ALWAYS A LOWER BOUND on how long we have been watching this board, never an '
  'equality: the earliest date on which some series this database still holds '
  'shows an observation of it. Both contributing series are young and one of '
  'them was pruned at 35 days until 2026-09-06, so for a board we have carried '
  'since July this date is the first surviving evidence, not the truth. Read '
  'it as "watched since AT LEAST this date". A window that begins on or before '
  'this date must be refused for that board, because its first observed day '
  'stamps our own discovery date onto every posting the employer already had.';

COMMENT ON COLUMN public.job_board_board_watch.first_observed_basis IS
  'Which series produced first_observed_on. ''board_state'' = '
  'job_board_board_state.observed_on, a real per-fetch observation, written '
  'from 2026-09-06. ''company_snapshot'' = '
  'job_board_company_snapshots.snapshot_date, which proves only that the board '
  'had stored rows on that date, written from 2026-07-21 and pruned at 35 days '
  'until 2026-09-06. Closed vocabulary, enforced by a CHECK: a new basis needs '
  'a migration, so a reader can trust that these two words mean what this '
  'comment says.';

COMMENT ON COLUMN public.job_board_board_watch.is_censored IS
  'TRUE when first_observed_on is the earliest date its source series can '
  'express at all -- i.e. the board was already there when the series started, '
  'so the real first observation is EARLIER and is unrecoverable. Censoring is '
  'the safe direction (the board is older than stated, never younger), so a '
  'censored row may be used for a tenure gate; it must not be used to claim a '
  'board''s age, and it must never be counted as "onboarded on that date".';

CREATE INDEX IF NOT EXISTS job_board_board_watch_first_idx
  ON public.job_board_board_watch (first_observed_on);

ALTER TABLE public.job_board_board_watch ENABLE ROW LEVEL SECURITY;
-- No policy and no anon/authenticated grant: RLS with no policy denies
-- everyone but service_role. The grant is withheld rather than granted and
-- later revoked, because in this repo a GRANT has twice outlived its intent
-- and 107 of 121 definer functions were found anon-callable.
GRANT ALL ON public.job_board_board_watch TO service_role;


-- ═════════════════════════════════════════════════════════════════════════
-- THE FLOW TABLE: ARRIVALS, DEPARTURES AND READ QUALITY, PER BOARD PER DAY.
-- ═════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.job_board_company_flow (
  company_token         text NOT NULL,
  flow_date             date NOT NULL,
  source                text,

  arrivals_observed     integer NOT NULL DEFAULT 0,
  arrivals_dated        integer NOT NULL DEFAULT 0,
  arrivals_corroborated integer NOT NULL DEFAULT 0,

  departures_removed    integer NOT NULL DEFAULT 0,
  departures_aged_out   integer NOT NULL DEFAULT 0,
  departures_backdated  integer NOT NULL DEFAULT 0,
  departures_dormant    integer NOT NULL DEFAULT 0,
  departures_untracked  integer NOT NULL DEFAULT 0,
  departures_total      integer NOT NULL DEFAULT 0,

  served_start          integer,
  stored_start          integer,

  read_state            text,
  feed_total            integer,
  prev_observed_on      date,

  watch_since           date,
  watch_basis           text,
  watch_censored        boolean,

  collected_at          timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (company_token, flow_date)
);

COMMENT ON TABLE public.job_board_company_flow IS
  'Per-board, per-day GROSS arrivals and departures -- departures split over ALL FIVE exit_reason values job_board_exits admits, plus an unfiltered total so the split is provably exhaustive -- with the read quality and '
  'the tenure that say whether they may be read as a rate at all. The two '
  'series that predate it record LEVELS, and a difference of levels is a NET '
  'number that cannot separate a board that posted forty roles and closed '
  'thirty-nine from one that posted one. '
  'WHAT THIS TABLE MUST NEVER BE USED FOR: a per-day rate taken from '
  'arrivals_observed alone. That column books everything we stored for the '
  'first time on this date, which on a board''s first observed day is its '
  'entire back catalogue, on a page-capped board is whatever slice the deep '
  'cursor reached, and after a vendor re-ids its postings is the whole board. '
  'The publishable numerator is arrivals_corroborated, over an interval given '
  'by prev_observed_on, for a board whose job_board_board_watch tenure '
  'predates the window. '
  'Private: RLS on, no policy, service_role only -- this is the same class of '
  'longitudinal asset as the closure log, which was anon-readable for its '
  'first 35 days.';

COMMENT ON COLUMN public.job_board_company_flow.company_token IS
  'The BOARD identity (vendor tenant), not the employer. Same caveat as '
  'job_board_board_state.company_token: one employer may hold several tokens '
  'and there is no company-entity mapping to sum across them.';

COMMENT ON COLUMN public.job_board_company_flow.flow_date IS
  'OUR observation date (UTC), and always a COMPLETED day: the collector '
  'refuses any date that has not fully elapsed, because a partial day is a '
  'rate over an unknown denominator. It is not an employer date and carries no '
  'posting age. A MISSING ROW for a (board, date) means the board was neither '
  'observed nor moved that day -- it is NOT a measured zero, and a denominator '
  'must count rows that are present rather than assume absent ones are zero.';

COMMENT ON COLUMN public.job_board_company_flow.source IS
  'The ATS vendor this board was fetched from on this date, copied from '
  'job_board_board_state. Kept per row so a board changing vendor is visible '
  'in this series itself: an ATS migration is one of the ways a board appears '
  'to grow explosively without an employer doing anything.';

COMMENT ON COLUMN public.job_board_company_flow.arrivals_observed IS
  'Postings we STILL HOLD whose first_seen fell on this UTC day. THIS IS OUR '
  'CLOCK, NOT THE EMPLOYER''S: it counts the day WE first stored a role, which '
  'is the day the employer posted it only when we happened to be looking. It '
  'is inflated by a board''s first observed day, by a deep-cursor slice paging '
  'in roles that were always there, and by a vendor re-issuing its posting '
  'ids. It is ALSO A FLOOR even on its own terms: a role that arrived and left '
  'within the same day is already hard-deleted and cannot be counted. Publish '
  'nothing from this column; it is the widest rung of the ladder and its job '
  'is to be the denominator of the corroboration ratio.';

COMMENT ON COLUMN public.job_board_company_flow.arrivals_dated IS
  'Of arrivals_observed, how many carried an employer-stated posted_at at all. '
  'The coverage of the corroborator, which differs sharply by vendor -- '
  'Workday stamps a date only while a role is under 30 days old and BambooHR '
  'publishes none -- so a low arrivals_corroborated on a board with '
  'arrivals_dated near zero means WE CANNOT SEE, not that nothing happened.';

COMMENT ON COLUMN public.job_board_company_flow.arrivals_corroborated IS
  'Of arrivals_dated, how many the EMPLOYER dated within three days of our '
  'first seeing them: posted_at IS NOT NULL AND first_seen - posted_at < '
  'interval ''3 days''. This is get_hiring_trends'' existing guard '
  '(20260715160000), reused verbatim rather than reinvented, and it is the '
  'only arrival column that may be published as a growth numerator: it is the '
  'employer''s own clock corroborating ours. It is a FLOOR in both directions '
  '-- a genuine new role we found four days late is excluded, and a role on an '
  'undated board can never qualify -- so a number built on it understates '
  'hiring and never overstates it, which is the direction this product has '
  'chosen every time it had the choice.';

COMMENT ON COLUMN public.job_board_company_flow.departures_removed IS
  'job_board_exits rows for this board on this UTC day with exit_reason = '
  '''removed'': the employer''s feed stopped listing the role. The only '
  'departure class attributable to the employer. Note that the ingest refuses '
  'to log a removal from a page-capped fetch, so a board whose read_state is '
  '''truncated'' will read as zero removals -- absence of departures there is '
  'absence of proof, not proof of absence.';

COMMENT ON COLUMN public.job_board_company_flow.departures_aged_out IS
  'exit_reason = ''aged_out'': the role was still advertised when it crossed '
  'OUR 30-day serving cap. This is OUR fence closing, not the employer '
  'hiring anyone, and it must never be netted against arrivals as though it '
  'were a departure the employer caused.';

COMMENT ON COLUMN public.job_board_company_flow.departures_backdated IS
  'exit_reason = ''backdated'': the role entered our window already older than '
  'the serving cap. Like aged_out this is our own fence and not an employer '
  'action; it is kept separate so neither can be silently pooled with '
  'departures_removed.';

COMMENT ON COLUMN public.job_board_company_flow.departures_dormant IS
  'exit_reason = ''board_dormant'': OUR prune of an entire board after '
  'DEAD_BOARD_THRESHOLD consecutive failed fetches. OUR action and not the '
  'employer''s, so it must never be netted against arrivals -- and on the day '
  'it fires it is usually the board''s WHOLE inventory at once, which is why '
  'it cannot be left out of the split: a zero here beside a large '
  'served_start would read as a quiet day on the day the board died.';

COMMENT ON COLUMN public.job_board_company_flow.departures_untracked IS
  'exit_reason = ''untracked'': the board''s token was removed from sources.ts '
  'and its rows were orphan-pruned. OUR action, whole-board, never netted '
  'against arrivals. Together with departures_dormant this is the tell for a '
  'vendor re-id, where one token''s inventory leaves as another token''s '
  'arrives.';

COMMENT ON COLUMN public.job_board_company_flow.departures_total IS
  'count(*) of job_board_exits rows for this board on this UTC day, '
  'UNFILTERED. It exists so the five-way split is provably exhaustive rather '
  'than exhaustive by assertion: departures_total > the sum of the five parts '
  'means a sixth exit_reason has been added to job_board_exits and this '
  'collector has not been taught it. Never publish this as employer-caused '
  'outflow -- three of the five classes it pools are our own fences.';

COMMENT ON COLUMN public.job_board_company_flow.served_start IS
  'job_board_company_snapshots.open_roles_served for this board on this date '
  '-- roles the site would actually SERVE, measured by the 02:30 UTC snapshot '
  'ON flow_date. It is therefore a level taken 2.5 HOURS INTO the day, NOT a '
  'true start-of-day level: arrivals between 00:00 and 02:30 UTC are already '
  'inside it, so arrivals/served_start slightly UNDERSTATES the rate. That '
  'direction is the one this product picks every time, and it is named here '
  'rather than rounded off. A build wanting a strictly pre-window level must '
  'copy snapshot_date = flow_date - 1 and say which it used. Copied here '
  'rather than joined so this row '
  'remains reproducible on its own and so a NULL is visible: NULL means the '
  'snapshot did not run or the date predates 2026-09-06, and it means NOT '
  'MEASURED, never zero. This is the denominator of a growth rate; '
  'stored_start is not.';

COMMENT ON COLUMN public.job_board_company_flow.stored_start IS
  'job_board_company_snapshots.open_roles for this board on this date: rows we '
  'STORE, fenced or not, including rows the board refuses to show. Kept beside '
  'served_start because the ratio is this board''s staleness, and because the '
  'two existing public consumers of the snapshot series difference this '
  'unfenced column. NOT a denominator for anything published.';

COMMENT ON COLUMN public.job_board_company_flow.read_state IS
  'READ QUALITY FOR THIS BOARD ON THIS DAY, copied verbatim from '
  'job_board_board_state.state so there is exactly one vocabulary for it in '
  'this database. ''ok'' and ''empty'' and ''dark'' = we read the board fully. '
  '''truncated'' = the fetch was cut short (a page-capped board read in '
  'slices), so BOTH the arrival and departure counts on this row understate '
  'and no closure may be inferred. ''error'' = the fetch failed. NULL = the '
  'board was NOT OBSERVED on this date at all, which is ordinary because '
  'boards rotate. A rate computed across a day whose read_state is '
  '''truncated'', ''error'' or NULL is not a rate; those days must be excluded '
  'from the numerator AND from the day count of the window, not treated as '
  'zero-arrival days.';

COMMENT ON COLUMN public.job_board_company_flow.feed_total IS
  'THE EMPLOYER''S OWN ADVERTISED COUNT on this date, copied verbatim from '
  'job_board_board_state.feed_total -- the only figure in this row we did not '
  'derive. It is the employer-side growth series, and on a page-capped board '
  'it is the ONLY meaningful level we have. NULL means the vendor stated no '
  'total, or stated one we compute ourselves and therefore refuse to store; it '
  'is NOT zero, and a coverage ratio must skip those rows rather than read '
  'them as complete coverage.';

COMMENT ON COLUMN public.job_board_company_flow.prev_observed_on IS
  'The previous date within the last 60 days on which this board was observed '
  'at all. THE ACCUMULATION INTERVAL: boards are not visited daily, so a board '
  'last read four days ago books four days of the employer''s postings under '
  'this one date. The per-day arrival rate is the arrival count divided by '
  '(flow_date - prev_observed_on); the raw count is not a daily rate. NULL '
  'means no prior observation inside the 60-day lookback -- either the board '
  'is newly watched or the gap exceeds the lookback -- and a rate must be '
  'REFUSED for that day rather than assuming one.';

COMMENT ON COLUMN public.job_board_company_flow.watch_since IS
  'job_board_board_watch.first_observed_on as it stood when this row was '
  'collected: the earliest date we can prove we were watching this board. '
  'Frozen onto the row so a later reader sees what was knowable then. Always a '
  'LOWER BOUND. A window that begins on or before this date must be refused '
  'for this board.';

COMMENT ON COLUMN public.job_board_company_flow.watch_basis IS
  'Which series produced watch_since (''board_state'' or ''company_snapshot''); '
  'see job_board_board_watch.first_observed_basis. NULL means the board had no '
  'watch row when this flow row was written, which is itself a refusal '
  'condition.';

COMMENT ON COLUMN public.job_board_company_flow.watch_censored IS
  'TRUE when watch_since is the first date its source series can express, so '
  'the board is OLDER than watch_since says. Safe for a tenure gate, unusable '
  'as a board age, and never an onboarding date.';

COMMENT ON COLUMN public.job_board_company_flow.collected_at IS
  'When this row was computed. It matters because arrivals_observed is '
  'measured from postings we STILL HOLD, so a row collected late has lost the '
  'roles that arrived and closed in between: collected_at - flow_date greater '
  'than about one day means this row''s arrival counts are more decayed than '
  'the rest of the series and are a weaker floor. The collector deliberately '
  'will NOT overwrite a row from an earlier collection day for this reason -- '
  'see the ON CONFLICT clause in collect_company_flow.';

-- The per-board series is the primary key's own order. The other read is
-- "every board on one day", for a cross-sectional sweep.
CREATE INDEX IF NOT EXISTS job_board_company_flow_date_idx
  ON public.job_board_company_flow (flow_date);

ALTER TABLE public.job_board_company_flow ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.job_board_company_flow TO service_role;


-- ═════════════════════════════════════════════════════════════════════════
-- THE COLLECTOR.
-- ═════════════════════════════════════════════════════════════════════════
--
-- ONE COMPLETED UTC DAY AT A TIME. observed_on in job_board_board_state is
-- derived by trigger as (observed_at AT TIME ZONE 'UTC')::date, so this
-- function takes its day boundaries in UTC too rather than from current_date,
-- which follows the database timezone. job_board_company_snapshots.snapshot_date
-- is written with current_date; on a UTC database, which this one is, the two
-- agree, and the snapshot join is by date equality so a timezone change would
-- show up as served_start going NULL rather than as a silently shifted number.
--
-- 240s and not longer: the dominant cost is one sequential scan of
-- job_board_postings (~945k rows) because no index on first_seen exists and
-- this file refuses to add one to that table. If it ever cannot finish in four
-- minutes, the cron run is where that should be discovered.
CREATE OR REPLACE FUNCTION public.collect_company_flow(p_date date DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET statement_timeout = '240s'
AS $$
DECLARE
  -- Default: yesterday in UTC. The cron runs at 03:20 UTC, so the day being
  -- measured elapsed over three hours ago.
  v_date        date := COALESCE(p_date, (now() AT TIME ZONE 'UTC')::date - 1);
  v_today       date := (now() AT TIME ZONE 'UTC')::date;
  -- The employer-clock corroboration guard, identical to get_hiring_trends
  -- (20260715160000). Changing it here alone forks the meaning of "new
  -- posting" between two surfaces.
  c_corroborate interval := interval '3 days';
  -- How far back to look for the previous observation of a board. Bounds the
  -- lookup; beyond it prev_observed_on is NULL and the day is unusable for a
  -- rate, which is the honest answer for a board we have not touched in two
  -- months.
  c_lookback    integer := 60;
  v_from        timestamptz;
  v_to          timestamptz;
  v_rows        integer;
BEGIN
  -- A PARTIAL DAY IS NOT A DAY. Refusing is the whole discipline of the file:
  -- a rate over a window that is still filling is a number the query could not
  -- produce.
  IF v_date >= v_today THEN
    RAISE EXCEPTION 'collect_company_flow: % has not fully elapsed (UTC today is %); a partial day cannot carry a rate', v_date, v_today;
  END IF;

  v_from := (v_date::timestamp AT TIME ZONE 'UTC');
  v_to   := ((v_date + 1)::timestamp AT TIME ZONE 'UTC');

  -- ── 1. Tenure first, so a board first observed on this date gets an honest
  --       first_observed_on before any flow row quotes it. Boards already
  --       known keep their earlier date: this only ever INSERTS.
  --
  -- IT COMPUTES THE FLOOR RATHER THAN ASSUMING v_date, AND THAT IS THE WHOLE
  -- POINT. The first draft wrote (v_date, 'board_state', is_censored=false)
  -- flat for every board seen today, on the assumption that the seed at the
  -- bottom of this migration had already established every earlier floor. The
  -- seed runs under its own 120s statement_timeout with an
  -- `EXCEPTION WHEN OTHERS THEN RAISE NOTICE` handler, so a timeout leaves
  -- job_board_board_watch EMPTY while the migration still reports success --
  -- and the first cron run would then stamp the entire catalogue with
  -- first_observed_on = its own date and is_censored = FALSE. That is not
  -- merely a wrong floor: is_censored=false is a POSITIVE CLAIM that the floor
  -- is exact, it is the field a later rate uses to admit a board, and every
  -- flow row freezes watch_since/watch_basis/watch_censored at collection
  -- time -- so after the fact nothing in the database could distinguish a real
  -- 2026-09-09 onboarding from a fabricated one, and the flow rows cannot be
  -- rebuilt. A swallowed seed must not be able to author that.
  --
  -- So this step asks the same question the seed asks, restricted to the
  -- boards observed on v_date (a bounded set, not the whole catalogue): the
  -- earliest date either series can prove, and censored when that date is the
  -- first date its series can express. A board genuinely first seen today gets
  -- (v_date, false) because no earlier evidence exists; a board carried since
  -- July gets July whether or not the seed ever ran. The seed is now an
  -- optimisation -- it covers boards NOT observed today -- rather than the
  -- only thing standing between this table and a fabricated tenure.
  INSERT INTO public.job_board_board_watch
    (company_token, first_observed_on, first_observed_basis, is_censored, updated_at)
  WITH todays AS (
    SELECT DISTINCT bs.company_token
    FROM public.job_board_board_state bs
    WHERE bs.observed_on = v_date
  ),
  ev AS (
    SELECT t.company_token,
           (SELECT min(x.observed_on)  FROM public.job_board_board_state x
             WHERE x.company_token = t.company_token)      AS bs_d,
           (SELECT min(y.snapshot_date) FROM public.job_board_company_snapshots y
             WHERE y.company_token = t.company_token)      AS sn_d
    FROM todays t
  )
  SELECT e.company_token,
         LEAST(COALESCE(e.bs_d, 'infinity'::date), COALESCE(e.sn_d, 'infinity'::date)),
         CASE WHEN COALESCE(e.sn_d, 'infinity'::date) <= COALESCE(e.bs_d, 'infinity'::date)
              THEN 'company_snapshot' ELSE 'board_state' END,
         CASE WHEN COALESCE(e.sn_d, 'infinity'::date) <= COALESCE(e.bs_d, 'infinity'::date)
              THEN e.sn_d <= (SELECT min(snapshot_date) FROM public.job_board_company_snapshots)
              ELSE e.bs_d <= (SELECT min(observed_on)   FROM public.job_board_board_state) END,
         now()
  FROM ev e
  WHERE COALESCE(e.bs_d, e.sn_d) IS NOT NULL
  ON CONFLICT (company_token) DO NOTHING;

  -- ── 2. The flow rows.
  WITH obs AS (
    -- Read quality, vendor and the employer's own count, for boards we
    -- actually looked at on this date.
    SELECT bs.company_token, bs.source, bs.state, bs.feed_total
    FROM public.job_board_board_state bs
    WHERE bs.observed_on = v_date
  ),
  arr AS (
    -- The arrival ladder. One sequential scan; see the timeout note above.
    SELECT p.company_token,
           count(*)::int AS arrivals_observed,
           count(*) FILTER (WHERE p.posted_at IS NOT NULL)::int AS arrivals_dated,
           count(*) FILTER (
             WHERE p.posted_at IS NOT NULL
               AND p.first_seen - p.posted_at < c_corroborate
           )::int AS arrivals_corroborated
    FROM public.job_board_postings p
    WHERE p.first_seen >= v_from
      AND p.first_seen <  v_to
    GROUP BY p.company_token
  ),
  dep AS (
    -- Gross departures, split by whose action ended the role, over ALL FIVE
    -- reasons job_board_exits' CHECK admits. Served by
    -- job_board_exits_exited_idx.
    --
    -- ENUMERATING ONLY THREE OF THEM WAS A REAL DEFECT IN THIS FILE'S FIRST
    -- DRAFT, and the exact failure the table exists to prevent. A board that
    -- hits DEAD_BOARD_THRESHOLD is pruned wholesale by logWholeBoardExit
    -- (job-board/index.ts) with exit_reason 'board_dormant', and a board
    -- dropped from sources.ts with 'untracked'. Those exit rows put the token
    -- into `universe` below, so a flow row WAS still written for it -- with
    -- every departure column reading 0 beside a large served_start. This
    -- table's own contract is that a written row is a MEASUREMENT and only a
    -- MISSING row means "not observed", so that row asserted a quiet day on
    -- the single day the board lost its entire catalogue. It also blinded
    -- defence (c) in the header: a vendor re-id normally presents as the old
    -- token going dormant or untracked, which is precisely the whole-board
    -- departure the arrivals~departures~served_start tell is for.
    -- get_board_flow (20260818070000) already enumerates all five and says in
    -- its own comment that excluding a class "would under-count outflow, which
    -- is the exact failure this metric exists to correct". job_board_exits
    -- prunes at 90 days, after which this table is the only copy, so an
    -- uncounted class here is unrecoverable.
    SELECT e.company_token,
           count(*) FILTER (WHERE e.exit_reason = 'removed')::int       AS departures_removed,
           count(*) FILTER (WHERE e.exit_reason = 'aged_out')::int      AS departures_aged_out,
           count(*) FILTER (WHERE e.exit_reason = 'backdated')::int     AS departures_backdated,
           count(*) FILTER (WHERE e.exit_reason = 'board_dormant')::int AS departures_dormant,
           count(*) FILTER (WHERE e.exit_reason = 'untracked')::int     AS departures_untracked,
           -- UNFILTERED, so the split is PROVABLY exhaustive rather than
           -- exhaustive-by-assertion. If a sixth reason is ever added to
           -- job_board_exits' CHECK, it shows up here as
           -- departures_total > sum(parts) instead of vanishing.
           count(*)::int                                               AS departures_total
    FROM public.job_board_exits e
    WHERE e.exited_at >= v_from
      AND e.exited_at <  v_to
    GROUP BY e.company_token
  ),
  -- A row is written for a board that was OBSERVED or that MOVED. Absence of a
  -- row therefore means neither happened, and the table comment says so; it is
  -- never a measured zero.
  universe AS (
    SELECT company_token FROM obs
    UNION
    SELECT company_token FROM arr
    UNION
    SELECT company_token FROM dep
  )
  INSERT INTO public.job_board_company_flow AS f (
    company_token, flow_date, source,
    arrivals_observed, arrivals_dated, arrivals_corroborated,
    departures_removed, departures_aged_out, departures_backdated,
    departures_dormant, departures_untracked, departures_total,
    served_start, stored_start,
    read_state, feed_total, prev_observed_on,
    watch_since, watch_basis, watch_censored,
    collected_at
  )
  SELECT u.company_token,
         v_date,
         obs.source,
         COALESCE(arr.arrivals_observed, 0),
         COALESCE(arr.arrivals_dated, 0),
         COALESCE(arr.arrivals_corroborated, 0),
         COALESCE(dep.departures_removed, 0),
         COALESCE(dep.departures_aged_out, 0),
         COALESCE(dep.departures_backdated, 0),
         COALESCE(dep.departures_dormant, 0),
         COALESCE(dep.departures_untracked, 0),
         COALESCE(dep.departures_total, 0),
         snap.open_roles_served,
         snap.open_roles,
         obs.state,
         obs.feed_total,
         pv.observed_on,
         w.first_observed_on,
         w.first_observed_basis,
         w.is_censored,
         now()
  FROM universe u
  LEFT JOIN obs ON obs.company_token = u.company_token
  LEFT JOIN arr ON arr.company_token = u.company_token
  LEFT JOIN dep ON dep.company_token = u.company_token
  LEFT JOIN public.job_board_company_snapshots snap
         ON snap.company_token = u.company_token
        AND snap.snapshot_date = v_date
  LEFT JOIN public.job_board_board_watch w
         ON w.company_token = u.company_token
  -- The previous observation of this board. Index-only against the primary
  -- key (company_token, observed_on), bounded by the lookback constant.
  LEFT JOIN LATERAL (
    SELECT max(b2.observed_on) AS observed_on
    FROM public.job_board_board_state b2
    WHERE b2.company_token = u.company_token
      AND b2.observed_on <  v_date
      AND b2.observed_on >= v_date - c_lookback
  ) pv ON true
  ON CONFLICT (company_token, flow_date) DO UPDATE SET
    source                = EXCLUDED.source,
    arrivals_observed     = EXCLUDED.arrivals_observed,
    arrivals_dated        = EXCLUDED.arrivals_dated,
    arrivals_corroborated = EXCLUDED.arrivals_corroborated,
    departures_removed    = EXCLUDED.departures_removed,
    departures_aged_out   = EXCLUDED.departures_aged_out,
    departures_backdated  = EXCLUDED.departures_backdated,
    departures_dormant    = EXCLUDED.departures_dormant,
    departures_untracked  = EXCLUDED.departures_untracked,
    departures_total      = EXCLUDED.departures_total,
    served_start          = EXCLUDED.served_start,
    stored_start          = EXCLUDED.stored_start,
    read_state            = EXCLUDED.read_state,
    feed_total            = EXCLUDED.feed_total,
    prev_observed_on      = EXCLUDED.prev_observed_on,
    watch_since           = EXCLUDED.watch_since,
    watch_basis           = EXCLUDED.watch_basis,
    watch_censored        = EXCLUDED.watch_censored,
    collected_at          = EXCLUDED.collected_at
  -- IDEMPOTENT WITHIN A COLLECTION DAY, INERT AFTER IT. A re-run on the same
  -- UTC day is a correction and is allowed to replace the row. A re-run days
  -- later would recompute arrivals from postings that have since been
  -- hard-deleted at closure and would REPLACE a good measurement with a
  -- decayed one -- silently, and with no way to tell afterwards. So the update
  -- arm refuses. Re-running an old date is then a no-op rather than damage,
  -- and a date that was never collected still INSERTs (this clause gates only
  -- the conflict path), carrying its own late collected_at as the disclosure.
  WHERE f.collected_at >= (v_today::timestamp AT TIME ZONE 'UTC');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

-- 107 of 121 definer functions in this database were once anon-callable,
-- including one that granted paid credits. The revoke is explicit and comes
-- before the grant.
REVOKE ALL ON FUNCTION public.collect_company_flow(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.collect_company_flow(date) TO service_role;


-- ═════════════════════════════════════════════════════════════════════════
-- SEED THE TENURE FLOOR -- AND ONLY THE TENURE FLOOR.
-- ═════════════════════════════════════════════════════════════════════════
--
-- WHY THIS SEED IS NOT OPTIONAL. Without it, the first cron run would insert
-- first_observed_on = 2026-09-09 for every board in the catalogue, asserting
-- that a board we have carried since July was onboarded yesterday -- the exact
-- falsehood the whole file is built to prevent, written by the very table that
-- exists to prevent it. The seed reads the two real series and takes the
-- EARLIEST evidence either one holds.
--
-- WHY NO FLOW ROW IS SEEDED. Today has not elapsed. A flow row for 2026-09-09
-- written now would count part of a day and present it beside full days. The
-- collector refuses that date on purpose and the seed does not go around it:
-- the first flow row is written by the cron at 03:20 UTC on 2026-09-10, for
-- 2026-09-09, once that day is complete.
--
-- LOCKS: this writes only to job_board_board_watch, created empty above, and
-- reads two tables under ACCESS SHARE, which blocks no writer. It builds no
-- index on any existing table. It is wrapped and given its own budget so a
-- slow read degrades the tenure floor rather than failing the deploy; if it
-- fails, the floor is simply absent and can be re-established by re-running
-- this block's body, because the INSERT is ON CONFLICT DO NOTHING.
DO $$
DECLARE
  v_bs_series   date;
  v_snap_series date;
  v_n           integer;
BEGIN
  SET LOCAL statement_timeout = '120s';

  SELECT min(observed_on)  INTO v_bs_series   FROM public.job_board_board_state;
  SELECT min(snapshot_date) INTO v_snap_series FROM public.job_board_company_snapshots;

  INSERT INTO public.job_board_board_watch
    (company_token, first_observed_on, first_observed_basis, is_censored, updated_at)
  WITH bs AS (
    SELECT company_token, min(observed_on) AS d
    FROM public.job_board_board_state GROUP BY company_token
  ),
  sn AS (
    SELECT company_token, min(snapshot_date) AS d
    FROM public.job_board_company_snapshots GROUP BY company_token
  ),
  both AS (
    SELECT COALESCE(bs.company_token, sn.company_token) AS company_token,
           bs.d AS bs_d, sn.d AS sn_d
    FROM bs FULL OUTER JOIN sn ON sn.company_token = bs.company_token
  )
  SELECT b.company_token,
         LEAST(COALESCE(b.bs_d, 'infinity'::date), COALESCE(b.sn_d, 'infinity'::date)),
         -- The snapshot series starts earlier (2026-07-21) than the board-state
         -- series (2026-09-06), so it usually wins; board_state wins only for a
         -- board that has no surviving snapshot row.
         CASE WHEN COALESCE(b.sn_d, 'infinity'::date) <= COALESCE(b.bs_d, 'infinity'::date)
              THEN 'company_snapshot' ELSE 'board_state' END,
         -- Censored when the earliest evidence we hold IS the first date its
         -- series can express: the board was already there when the series
         -- started, so its true first observation is earlier and gone. Note
         -- that the snapshot series was pruned at 35 days until 2026-09-06, so
         -- its own minimum is itself a censoring boundary, not an origin.
         CASE WHEN COALESCE(b.sn_d, 'infinity'::date) <= COALESCE(b.bs_d, 'infinity'::date)
              THEN b.sn_d <= v_snap_series
              ELSE b.bs_d <= v_bs_series END,
         now()
  FROM both b
  WHERE COALESCE(b.bs_d, b.sn_d) IS NOT NULL
  ON CONFLICT (company_token) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RAISE NOTICE 'job_board_board_watch seeded with % board(s); board_state series starts %, snapshot series starts %', v_n, v_bs_series, v_snap_series;
  -- Stamped from inside the success path, so "did the seed run?" is a question
  -- the database can answer without the deploy log.
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('company_flow_watch_seed', jsonb_build_object(
            'ok', true, 'boards', v_n,
            'board_state_series_start', v_bs_series,
            'snapshot_series_start', v_snap_series, 'at', now()), now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
EXCEPTION WHEN OTHERS THEN
  -- NOT SILENT, AND NO LONGER LOAD-BEARING. collect_company_flow's step 1
  -- computes each observed board's floor from the same two series rather than
  -- assuming its own run date, so a failure here costs coverage of boards not
  -- observed on a collection day -- it can no longer fabricate an uncensored
  -- tenure for the catalogue. The failure is also STAMPED, so an operator can
  -- see it after the deploy log has scrolled away, and re-running this block's
  -- body (it is ON CONFLICT DO NOTHING) is safe at any time.
  RAISE NOTICE 'board watch seed failed (%); collect_company_flow still derives each observed board''s floor from both series, but boards not observed on a collection day stay unseeded until this block is re-run', SQLERRM;
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('company_flow_watch_seed', jsonb_build_object('ok', false, 'error', SQLERRM, 'at', now()), now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END $$;


-- ═════════════════════════════════════════════════════════════════════════
-- SCHEDULES.
-- ═════════════════════════════════════════════════════════════════════════
-- cron.schedule upserts by jobname, so re-applying this file updates the
-- entries rather than being skipped by an IF NOT EXISTS guard the way the
-- original 35-day snapshot retention job was.
--
-- 03:20 UTC, and the ordering is load-bearing. 02:30 snapshot_company_counts
-- writes the served_start this file copies; 02:40 and 02:55 are the snapshot
-- retentions; 03:05 is the dim-snapshot size probe. 04:17 prunes the exit
-- ledger this file reads. So 03:20 sits after everything it depends on and an
-- hour before anything that removes its inputs.
--
-- There is NO retention job here, deliberately -- see the header. There IS a
-- size probe, because that decision has to be checked against reality.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule(
      'company-flow-daily', '20 3 * * *',
      $job$ SELECT public.collect_company_flow(); $job$);

    PERFORM cron.schedule(
      'company-flow-size', '30 3 * * *',
      $job$ INSERT INTO public.job_board_meta (k, v, updated_at)
            SELECT 'company_flow_size',
                   jsonb_build_object(
                     'at', now(),
                     'bytes', pg_total_relation_size('public.job_board_company_flow'),
                     'watch_bytes', pg_total_relation_size('public.job_board_board_watch'),
                     'first_date', (SELECT min(f.flow_date) FROM public.job_board_company_flow f),
                     'last_date',  (SELECT max(f.flow_date) FROM public.job_board_company_flow f)),
                   now()
            ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at; $job$);
  ELSE
    RAISE NOTICE 'pg_cron is absent; collect_company_flow() exists but nothing calls it';
  END IF;
END $$;


-- ═════════════════════════════════════════════════════════════════════════
-- THE BASIS ROW: WHAT THIS SERIES IS, AND WHEN IT MAY FIRST BE READ.
-- ═════════════════════════════════════════════════════════════════════════
-- A reader a year from now must learn the gates from the data, not from this
-- file. The dates below are arithmetic on the collection start, not estimates:
-- the collector writes one completed day per night, so a 7-day window needs
-- seven of them and a 28-day window needs twenty-eight.
--
-- min_observed_days_* are this file's own sample gates, stated here so that a
-- later surface reuses them instead of inventing its own. They are day counts
-- WITHIN the window that carry read_state IN ('ok','empty','dark') -- a
-- truncated, failed or absent read is excluded from the numerator AND from the
-- day count, never counted as a zero-arrival day.
INSERT INTO public.job_board_meta (k, v, updated_at)
VALUES ('company_flow_basis', jsonb_build_object(
          'table', 'job_board_company_flow',
          'grain', 'one row per board per completed UTC day, written only for a board observed or moved that day; a missing row is not a measured zero',
          'collection_starts', (now() AT TIME ZONE 'UTC')::date,
          'first_flow_date', ((now() AT TIME ZONE 'UTC')::date),
          'first_flow_date_written_at', 'the 03:20 UTC run on the following day',
          'publishable_numerator', 'arrivals_corroborated (employer-stated posted_at within 3 days of our first_seen); arrivals_observed is our clock and is not publishable',
          'corroboration_days', 3,
          'prev_observation_lookback_days', 60,
          'min_observed_days_7d', 5,
          'min_observed_days_28d', 20,
          'window_must_start_after', 'job_board_board_watch.first_observed_on for that board',
          'earliest_7d_window_computable', ((now() AT TIME ZONE 'UTC')::date + 7),
          'earliest_28d_window_computable', ((now() AT TIME ZONE 'UTC')::date + 28),
          'retention_days', NULL::integer,
          'retention_note', 'none by design; a prune needs a rollup first, as job_board_exits learned'),
        now())
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
