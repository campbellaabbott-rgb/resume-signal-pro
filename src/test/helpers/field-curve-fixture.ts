/**
 * THE TABLES THE FIELD CURVE READS, AND A FIXTURE SIZED FOR THE (90, 300) VARIANT.
 *
 * Shared by the two pglite guards of the 2026-09-28 pair (the curve's header
 * re-issue and the stats cache's eighth part) so both execute the REAL
 * get_category_fill_curve over one set of rows. The DDL is the shape
 * a-day-thirty-gate-must-have-seen-the-cohort-produce-an-event boots, plus
 * the observability table in its 20260909217000 form, because a LANGUAGE sql
 * body is validated at CREATE and every table it names must already exist.
 *
 * Every cohort member is dated 33 days ago: inside the 90-day window and
 * inside the day-30 cohort on any day from 2026-09-09 onward. Two fields:
 *
 *   C  engineering  200 fills at day 10, 100 relists at day 5, 200 age-outs
 *                   at the cap, 50 still live -- several hundred dated
 *                   observations, above the 300 floor the pages ask for.
 *   E  science      40 fills at day 10, 60 age-outs -- 100 observations,
 *                   above the estimator's absolute floor of 25 and BELOW 300.
 *
 * So the two variants are told apart by which fields answer: at the absolute
 * floor both do, at the pages' floor only engineering does. Snapshots are
 * sized so the feed-dark proxy never censors a batch.
 */
export const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz
  );
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer,
    absence_basis text
  );
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz
  );
  CREATE TABLE public.job_board_company_snapshots (
    company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date)
  );
  CREATE TABLE IF NOT EXISTS public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket        text NOT NULL CHECK (bucket IN ('full_read', 'lap_proven', 'lap_pending', 'unprovable', 'unobserved')),
    lap_w0        timestamptz,
    as_of         timestamptz NOT NULL DEFAULT now()
  );
`;

/** age-outs: our own sweep at the cap, never an employer event. */
export const ageouts = (tok: string, cat: string, n: number) => `
  INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
  SELECT '${tok}:age:'||g, 'greenhouse', '${tok}', '${cat}', 'aged_out',
         now() - interval '33 days' + interval '30 days', now() - interval '33 days'
  FROM generate_series(1, ${n}) g;`;
/** closures inside the day-30 cohort, at day `day`; `tag` keeps a second batch's ids distinct. */
export const closures = (tok: string, cat: string, n: number, day: number, relist: boolean, tag = "") => `
  INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, closed_at, superseded, absence_basis)
  SELECT '${tok}:${tag}${relist ? "x" : "f"}${day}:'||g, 'greenhouse', '${tok}', '${cat}',
         now() - interval '33 days', now() - interval '33 days' + interval '${day} days', ${relist}, 'full_read'
  FROM generate_series(1, ${n}) g;`;
export const live = (tok: string, cat: string, n: number) => `
  INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
  SELECT '${tok}:live:'||g, 'greenhouse', '${tok}', '${cat}', now() - interval '33 days',
         now() - interval '3 days', now() - interval '33 days', now()
  FROM generate_series(1, ${n}) g;`;
export const snapshot = (tok: string, n: number) =>
  `INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, open_roles) VALUES ('${tok}', current_date - 40, ${n});`;

export const FIXTURE_TOKENS = ["C", "E"] as const;

export const FIXTURE = [
  closures("C", "engineering", 200, 10, false), closures("C", "engineering", 100, 5, true),
  ageouts("C", "engineering", 200), live("C", "engineering", 50), snapshot("C", 5000),
  closures("E", "science", 40, 10, false), ageouts("E", "science", 60), snapshot("E", 1000),
  `INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('C', 'full_read'), ('E', 'full_read');`,
].join("\n");

/** Every fixture row, gone -- the empty-answer case for the real curve. */
export const CLEAR_FIXTURE = `
  DELETE FROM public.job_board_closures WHERE company_token IN ('C', 'E');
  DELETE FROM public.job_board_exits WHERE company_token IN ('C', 'E');
  DELETE FROM public.job_board_postings WHERE company_token IN ('C', 'E');
  DELETE FROM public.job_board_company_snapshots WHERE company_token IN ('C', 'E');
  DELETE FROM public.job_board_board_observability WHERE company_token IN ('C', 'E');
`;

/** Enough extra science fills to clear the 300 floor, so a later healthy run is visibly a NEW answer, not the old rows re-stamped. */
export const SCIENCE_CLEARS_THE_FLOOR = closures("E", "science", 250, 10, false, "later");
