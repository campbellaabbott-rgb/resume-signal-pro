-- ONE INTEGER A DAY IS THE WHOLE MEMORY WE KEEP OF A COMPANY'S HIRING.
--
-- job_board_company_snapshots stores exactly one number per company per day.
-- Every question a customer actually asks — "is Cigna growing its engineering
-- team or its claims team", "did the remote share of this employer's postings
-- collapse in Q3", "which country absorbed the cuts" — is unanswerable for
-- every day already elapsed, and no amount of later work recovers it, because
-- the postings those days described are deleted at closure.
--
-- The scan that produces the scalar is a full GROUP BY over job_board_postings.
-- The dimensional cut is the same scan with a wider GROUP BY.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 1. THE SERVING FENCE, AND WHY IT ARRIVES AS A NEW COLUMN AND NOT AS A
--    REDEFINITION OF open_roles.
--
-- snapshot_company_counts has always been a bare `count(*) ... GROUP BY
-- company_token` with neither of the board's two serving predicates:
--
--     missing_since IS NULL
--     effective_posted >= now() - interval '30 days'
--
-- (the pair 20260811013000 applied to five Explore RPCs after finding they
-- counted "a population no reader can reach"). So the column named open_roles
-- has never meant open roles. It means ROWS WE STORE, including rows the board
-- itself refuses to show.
--
-- The obvious fix — put the predicates into open_roles — is the one thing that
-- must not happen, and 20260811013000 says so in its own header: it excluded
-- get_trending_companies from that sweep because "trending is a DIFFERENCE
-- across those rows (n.open_roles - b.open_roles) — every company would show a
-- fabricated collapse for 7-14 days until the baseline aged out."
--
-- That reasoning still holds and there are now TWO such consumers, both public:
--   get_trending_companies  (Explore)        n.open_roles - b.open_roles
--   get_company_intel       (company lander) net_7d, newest snap minus oldest
-- Re-basing the column under them prints a double-digit fake collapse for
-- every employer on the site for a week. A number on a page is a promise.
--
-- So the honest number starts accruing TODAY in a column of its own, and the
-- existing column keeps the meaning its whole history already has. Both are
-- written by the same scan; nothing is lost and nothing silently changes.
--
--   open_roles         rows we STORE          continuous since 2026-07-21
--   open_roles_served  rows the board SERVES  begins 2026-09-06, NULL before
--
-- A NULL open_roles_served on a row dated before 2026-09-06 means "not
-- measured", never zero. It is deliberately NOT backfilled from open_roles:
-- that would be inventing a served count for days nobody measured one, which
-- is the same class of error as a 2.8-day median with no basis.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 2. RETENTION 400 DAYS ON BOTH TABLES. 400 and not 365 so a year-over-year
--    comparison has slack on both ends: the same calendar week last year is
--    still present after a fortnight of cron trouble, and a "52 weeks ago"
--    window does not fall off the cliff on the day it is asked for.
--    The scalar table costs ~44,500 rows/day; 400 days is ~18M rows.
--
-- ─────────────────────────────────────────────────────────────────────────
-- 3. THE DIMENSIONAL TABLE RUNS WEEKLY, AND THAT IS A STORAGE DECISION,
--    WRITTEN DOWN SO IT CAN BE ARGUED WITH.
--
-- Row count per snapshot is bounded by the sum over companies of distinct
-- (dimension, value) pairs. ~989k postings across ~44,500 boards, six
-- dimensions, and a 22-role median board emits roughly 30 rows — call it
-- ~1.3M rows per snapshot. DAILY at 400-day retention is ~520M rows, tens of
-- gigabytes, on a database that has already raised a disk alarm
-- (20260830260000). WEEKLY at 400-day retention is ~75M rows and a table that
-- still answers every question above at the grain the answer moves in:
-- an employer's departmental mix does not change materially in a day.
--
-- TO GO DAILY, change one cron expression — '50 2 * * 0' to '50 2 * * *'.
-- The table, its key and the function are all already daily-capable and the
-- writer is idempotent per date. Nothing else changes.
--
-- Growth is OBSERVED, not assumed: a nightly job stamps the table's size into
-- job_board_meta so this estimate gets checked against reality instead of
-- being discovered by a full disk.

-- ── the served count, alongside the stored one ───────────────────────────
ALTER TABLE public.job_board_company_snapshots
  ADD COLUMN IF NOT EXISTS open_roles_served integer;

COMMENT ON COLUMN public.job_board_company_snapshots.open_roles IS
  'Rows we STORE for this company on this date. NOT the number of open roles: '
  'it includes rows the board refuses to serve (missing_since stamped, or '
  'effective_posted older than 30 days). Kept unfenced on purpose — '
  'get_trending_companies and get_company_intel take a DIFFERENCE across dates '
  'on this column, and re-basing it mid-series would print a fabricated '
  'collapse for every employer until the pre-change baseline aged out. '
  'Continuous since 2026-07-21. Use open_roles_served for the served count.';

COMMENT ON COLUMN public.job_board_company_snapshots.open_roles_served IS
  'Rows the board would actually SERVE for this company on this date: '
  'missing_since IS NULL AND effective_posted >= now() - interval ''30 days'', '
  'the same fence every serving query in this repo applies. Written from '
  '2026-09-06 onward. NULL on any earlier row means NOT MEASURED — it does not '
  'mean zero, and it must not be backfilled from open_roles, which counts a '
  'different population.';

COMMENT ON COLUMN public.job_board_company_snapshots.snapshot_date IS
  'OUR observation date (the server date the snapshot job ran, UTC). It is not '
  'an employer date and carries no posting age.';

-- ── the dimensional sibling ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.job_board_company_dim_snapshots (
  company_token text NOT NULL,
  snapshot_date date NOT NULL,
  dimension     text NOT NULL,
  value         text NOT NULL,
  roles_served  integer NOT NULL DEFAULT 0,
  roles_stored  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_token, snapshot_date, dimension, value)
);

COMMENT ON TABLE public.job_board_company_dim_snapshots IS
  'Per-company, per-day segmentation of the open-role count: the same scan '
  'that produces job_board_company_snapshots, cut by one more GROUP BY. '
  'Written weekly today (see the cron below) though the key is daily-capable. '
  'Private: RLS on, no policy, service_role only — this is the same '
  'longitudinal asset the closure log is, and the closure log was '
  'anon-readable for its first 35 days.';

COMMENT ON COLUMN public.job_board_company_dim_snapshots.snapshot_date IS
  'OUR observation date (the server date the snapshot job ran, UTC). Not an '
  'employer date, not a posting age.';
COMMENT ON COLUMN public.job_board_company_dim_snapshots.dimension IS
  'Which axis this row cuts: department | country | work_mode | '
  'employment_type | experience_band | category. Closed vocabulary — a new '
  'axis needs a migration, so a reader can trust that a missing dimension '
  'means it was never collected rather than that it was renamed.';
COMMENT ON COLUMN public.job_board_company_dim_snapshots.value IS
  'The value on that axis, verbatim from job_board_postings, truncated to 120 '
  'characters so it fits a btree key. Two reserved sentinels: ''(none)'' is '
  'the bucket for rows where the column is NULL or empty — i.e. we do not '
  'know, which is itself the coverage number — and ''(other)'' is the summed '
  'tail beyond the top 25 values of that (company, dimension), which bounds a '
  'free-text vendor field like department from unbounding the table. An '
  'employer whose real department is literally named "(other)" is SUMMED INTO '
  'that tail by the final fold in snapshot_company_dim_counts — accepted, and '
  'folded arithmetically rather than colliding, because two rows with one key '
  'in a single ON CONFLICT statement is error 21000 and would lose the whole '
  'snapshot for every company, not just that bucket. The same applies to a '
  'department literally named "(none)".';
COMMENT ON COLUMN public.job_board_company_dim_snapshots.roles_served IS
  'Postings in this bucket the board would SERVE on this date '
  '(missing_since IS NULL AND effective_posted >= now() - 30 days). This is '
  'the honest open-role count and the one to publish.';
COMMENT ON COLUMN public.job_board_company_dim_snapshots.roles_stored IS
  'Postings in this bucket we STORE on this date, fenced or not. Comparable '
  'with job_board_company_snapshots.open_roles; the ratio to roles_served is '
  'this board''s staleness.';

CREATE INDEX IF NOT EXISTS job_board_company_dim_snapshots_date_idx
  ON public.job_board_company_dim_snapshots (snapshot_date);
-- The obvious read is one axis of one company over time. The PK already leads
-- with company_token, so this is the only extra index earned today.
CREATE INDEX IF NOT EXISTS job_board_company_dim_snapshots_dim_idx
  ON public.job_board_company_dim_snapshots (dimension, snapshot_date);

ALTER TABLE public.job_board_company_dim_snapshots ENABLE ROW LEVEL SECURITY;
-- No policy is created and no SELECT is granted to anon or authenticated:
-- RLS with no policy denies everyone but service_role. The grant is withheld
-- rather than granted-and-later-revoked, because in this repo a GRANT has
-- twice outlived the intent behind it.
GRANT ALL ON public.job_board_company_dim_snapshots TO service_role;

-- ── the writer: the scalar, now with the served count ────────────────────
-- Same signature, so this is an edit and not an overload.
CREATE OR REPLACE FUNCTION public.snapshot_company_counts()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '180s'
AS $$
BEGIN
  INSERT INTO public.job_board_company_snapshots
    (company_token, snapshot_date, company, open_roles, open_roles_served)
  SELECT p.company_token,
         current_date,
         max(p.company),
         count(*)::int,
         count(*) FILTER (
           WHERE p.missing_since IS NULL
             AND p.effective_posted >= now() - interval '30 days'
         )::int
  FROM public.job_board_postings p
  GROUP BY p.company_token
  ON CONFLICT (company_token, snapshot_date)
  DO UPDATE SET open_roles        = EXCLUDED.open_roles,
                open_roles_served = EXCLUDED.open_roles_served,
                company           = EXCLUDED.company;
END;
$$;
REVOKE ALL ON FUNCTION public.snapshot_company_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_company_counts() TO service_role;

-- ── the writer: the dimensional cut ──────────────────────────────────────
-- Idempotent per date: re-running on the same day replaces that day's rows for
-- every bucket it produces. It does NOT delete buckets that disappeared since
-- an earlier run on the same date; a same-day re-run is a correction, and the
-- daily/weekly cadence means a bucket that vanished has a row saying so on the
-- next snapshot, which is the honest record.
CREATE OR REPLACE FUNCTION public.snapshot_company_dim_counts()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
-- 240s, not longer: this function is PERFORMed once inside this migration to
-- start the series today, and a migration that can hang for ten minutes is a
-- deploy incident. The work is one scan of job_board_postings with a six-way
-- fan-out and a GROUP BY; if it ever cannot finish in four minutes the cron
-- run is the place to find that out, not the deploy.
SET statement_timeout = '240s'
AS $$
BEGIN
  INSERT INTO public.job_board_company_dim_snapshots
    (company_token, snapshot_date, dimension, value, roles_served, roles_stored)
  WITH base AS (
    SELECT p.company_token,
           (p.missing_since IS NULL
              AND p.effective_posted >= now() - interval '30 days') AS served,
           left(COALESCE(NULLIF(btrim(p.department),      ''), '(none)'), 120) AS f_department,
           left(COALESCE(NULLIF(btrim(p.country),         ''), '(none)'), 120) AS f_country,
           left(COALESCE(NULLIF(btrim(p.work_mode),       ''), '(none)'), 120) AS f_work_mode,
           left(COALESCE(NULLIF(btrim(p.employment_type), ''), '(none)'), 120) AS f_employment_type,
           left(COALESCE(NULLIF(btrim(p.experience_band), ''), '(none)'), 120) AS f_experience_band,
           left(COALESCE(NULLIF(btrim(p.category),        ''), 'other'),  120) AS f_category
    FROM public.job_board_postings p
  ),
  melted AS (
    SELECT b.company_token, b.served, d.dimension, d.value
    FROM base b
    CROSS JOIN LATERAL (VALUES
      ('department',      b.f_department),
      ('country',         b.f_country),
      ('work_mode',       b.f_work_mode),
      ('employment_type', b.f_employment_type),
      ('experience_band', b.f_experience_band),
      ('category',        b.f_category)
    ) AS d(dimension, value)
  ),
  counted AS (
    SELECT m.company_token, m.dimension, m.value,
           count(*) FILTER (WHERE m.served)::int AS n_served,
           count(*)::int                         AS n_stored
    FROM melted m
    GROUP BY m.company_token, m.dimension, m.value
  ),
  ranked AS (
    SELECT c.company_token, c.dimension, c.value, c.n_served, c.n_stored,
           row_number() OVER (PARTITION BY c.company_token, c.dimension
                              ORDER BY c.n_stored DESC, c.value) AS rn
    FROM counted c
  ),
  capped AS (
    SELECT r.company_token, r.dimension, r.value, r.n_served, r.n_stored
    FROM ranked r WHERE r.rn <= 25
    UNION ALL
    SELECT r.company_token, r.dimension, '(other)',
           sum(r.n_served)::int, sum(r.n_stored)::int
    FROM ranked r WHERE r.rn > 25
    GROUP BY r.company_token, r.dimension
  ),
  -- ONE MORE FOLD, AND IT IS NOT COSMETIC. `capped` is a UNION ALL, so an
  -- employer whose top 25 already contains a department literally named
  -- "(other)" AND who has a tail beyond rank 25 emits TWO rows with the same
  -- primary key. INSERT ... ON CONFLICT DO UPDATE cannot affect one row twice:
  -- Postgres raises 21000 and the statement rolls back — not one bucket, the
  -- WHOLE snapshot, for every company, silently, from cron. department is free
  -- vendor text across ~44,500 boards, so this is a value the corpus can
  -- produce. Summing here merges the real bucket into the tail, which is what
  -- the value comment already promised happens.
  merged AS (
    SELECT k.company_token, k.dimension, k.value,
           sum(k.n_served)::int AS n_served,
           sum(k.n_stored)::int AS n_stored
    FROM capped k
    GROUP BY k.company_token, k.dimension, k.value
  )
  SELECT k.company_token, current_date, k.dimension, k.value, k.n_served, k.n_stored
  FROM merged k
  ON CONFLICT (company_token, snapshot_date, dimension, value)
  DO UPDATE SET roles_served = EXCLUDED.roles_served,
                roles_stored = EXCLUDED.roles_stored;
END;
$$;
REVOKE ALL ON FUNCTION public.snapshot_company_dim_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_company_dim_counts() TO service_role;

-- ── schedules ────────────────────────────────────────────────────────────
-- cron.schedule upserts by jobname, so these UPDATE the existing entries
-- rather than being skipped by an IF NOT EXISTS guard the way the original
-- 35-day retention job was installed.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    -- 35 -> 400 days. Nothing older than 35 days exists on the day this
    -- applies, so the first run under the new bound deletes nothing.
    PERFORM cron.schedule(
      'company-snapshots-retention', '40 2 * * *',
      $job$ DELETE FROM public.job_board_company_snapshots WHERE snapshot_date < current_date - 400; $job$);

    -- Weekly, Sunday 02:50 — after the scalar snapshot at 02:30.
    -- Change to '50 2 * * *' for daily; see the storage note in the header.
    PERFORM cron.schedule(
      'company-dim-snapshots', '50 2 * * 0',
      $job$ SELECT public.snapshot_company_dim_counts(); $job$);

    PERFORM cron.schedule(
      'company-dim-snapshots-retention', '55 2 * * *',
      $job$ DELETE FROM public.job_board_company_dim_snapshots WHERE snapshot_date < current_date - 400; $job$);

    -- Growth is watched, not assumed. pg_total_relation_size is O(1) and the
    -- min/max are index scans on the date index above.
    PERFORM cron.schedule(
      'company-dim-snapshots-size', '5 3 * * *',
      $job$ INSERT INTO public.job_board_meta (k, v, updated_at)
            SELECT 'dim_snapshot_size',
                   jsonb_build_object(
                     'at', now(),
                     'bytes', pg_total_relation_size('public.job_board_company_dim_snapshots'),
                     'first_date', (SELECT min(s.snapshot_date) FROM public.job_board_company_dim_snapshots s),
                     'last_date',  (SELECT max(s.snapshot_date) FROM public.job_board_company_dim_snapshots s)),
                   now()
            ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at; $job$);
  END IF;
END $$;

-- Seed one snapshot of each now, guarded, so the new series starts today
-- rather than at the next cron tick. A failure here must not fail the
-- migration: the cron will take the next one.
DO $$
BEGIN
  PERFORM public.snapshot_company_counts();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'seed snapshot_company_counts failed (non-fatal): %', SQLERRM;
END $$;

DO $$
BEGIN
  PERFORM public.snapshot_company_dim_counts();
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'seed snapshot_company_dim_counts failed (non-fatal): %', SQLERRM;
END $$;

-- The series meaning changes today, and a reader a year from now needs to find
-- that out from the data rather than from this file.
INSERT INTO public.job_board_meta (k, v, updated_at)
VALUES ('company_snapshot_basis', jsonb_build_object(
          'open_roles', 'rows stored, unfenced, continuous since 2026-07-21',
          'open_roles_served', 'rows the board serves (missing_since IS NULL AND effective_posted >= now() - 30d)',
          'open_roles_served_first_date', current_date,
          'dim_snapshots_first_date', current_date,
          'dim_snapshots_cadence', 'weekly (Sun 02:50 UTC); key is daily-capable',
          'retention_days', 400),
        now())
ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
