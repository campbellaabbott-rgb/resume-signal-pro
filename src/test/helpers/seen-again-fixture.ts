/**
 * ONE BOARD, FOUR WAYS, FOR THE SEEN-AGAIN GUARDS (20261008110000 and 20261008110500).
 *
 * Every variant is the same board process on its own token (and, for the
 * field curve, its own category), so two variants can be compared column by
 * column inside one database:
 *
 *   A   the board as it happened: no collection failure at all.
 *   B   A, plus a suspect batch 34 days ago that stamped all fifty postings
 *       then stored with a closure, plus five aged_out exits logged in that
 *       same batch (the batch's age-out twins). Every one of those postings
 *       was observed again afterwards: stored again, closed for real, or
 *       aged out at the cap.
 *   B2  B with the batch unstamped (no suspect, no batch_live_before), so only
 *       the retroactive dark proxy can see it.
 *   C   A, plus five postings that exist ONLY as suspect closures in that
 *       batch: never seen again, so they must stay censored.
 *
 * The board, per variant (ids carry the token):
 *   g1  60 postings dated 40 days ago (inside the day-30 cohort): 10
 *       re-listed (superseded) at day 5, 20 taken down at day 10, 15 aged out
 *       at the cap, 15 still stored (re-stored after the batch, first_seen 33
 *       days ago).
 *   g2  30 postings dated 10 days ago: 10 taken down at day 3, 20 stored.
 *   g3  5 postings dated 66 days ago, stored (first_seen 33 days ago): the
 *       ones the batch's age-out twins name in B and B2.
 * Every genuine closure carries a batch stamp, and the board's snapshot is
 * 100 roles, so the dark proxy fires on the unstamped fifty-row batch of B2
 * and on nothing else.
 */
export const SEEN_AGAIN_SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, source text, company_token text, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, effective_posted timestamptz, first_seen timestamptz NOT NULL DEFAULT now(),
    last_seen timestamptz, missing_since timestamptz);
  CREATE TABLE public.job_board_closures (
    posting_id text, source text, company_token text, category text NOT NULL DEFAULT '',
    first_seen timestamptz, posted_at timestamptz, closed_at timestamptz NOT NULL DEFAULT now(),
    superseded boolean NOT NULL DEFAULT false, suspect boolean, batch_live_before integer, absence_basis text);
  CREATE TABLE public.job_board_exits (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text, source text,
    company_token text, category text NOT NULL DEFAULT 'other', exit_reason text NOT NULL,
    days_on_board numeric, exited_at timestamptz NOT NULL DEFAULT now(), posted_at timestamptz);
  CREATE TABLE public.job_board_company_snapshots (
    company_token text, snapshot_date date, open_roles integer, PRIMARY KEY (company_token, snapshot_date));
  CREATE TABLE public.job_board_board_observability (
    company_token text PRIMARY KEY,
    bucket text NOT NULL CHECK (bucket IN ('full_read','lap_proven','lap_pending','unprovable','unobserved')),
    lap_w0 timestamptz, as_of timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_watch (
    company_token text PRIMARY KEY, first_observed_on date NOT NULL, first_observed_basis text NOT NULL,
    is_censored boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT now(), live_count integer, stored_count integer, feed_total integer,
    state text NOT NULL DEFAULT 'ok', PRIMARY KEY (company_token, observed_on));
`;

export type Variant = "A" | "B" | "B2" | "C";
/** Token and field per variant: the field curve compares fields, the company curve tokens. */
export const VARIANTS: Record<Variant, { tok: string; cat: string }> = {
  A: { tok: "TA", cat: "engineering" },
  B: { tok: "TB", cat: "science" },
  B2: { tok: "TB2", cat: "design" },
  C: { tok: "TC", cat: "legal" },
};

/** The instant of the doubted batch, as SQL. */
const BATCH = `now() - interval '34 days'`;

export function seenAgainFixture(v: Variant): string {
  const { tok, cat } = VARIANTS[v];
  const s: string[] = [];
  const closures = (tag: string, from: number, to: number, postedDaysAgo: number, closedAt: string, opts: { superseded?: boolean; suspect?: boolean; stamped?: boolean } = {}) => s.push(`
    INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, first_seen, closed_at, superseded, suspect, batch_live_before, absence_basis)
    SELECT '${tok}:${tag}:'||g, 'greenhouse', '${tok}', '${cat}', now() - interval '${postedDaysAgo} days', now() - interval '${postedDaysAgo} days',
           ${closedAt}, ${opts.superseded ? "true" : "false"}, ${opts.suspect ? "true" : "NULL"}, ${opts.stamped === false ? "NULL" : "5000"}, 'full_read'
    FROM generate_series(${from}, ${to}) g;`);
  const exits = (tag: string, from: number, to: number, postedDaysAgo: number, exitedAt: string) => s.push(`
    INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
    SELECT '${tok}:${tag}:'||g, 'greenhouse', '${tok}', '${cat}', 'aged_out', ${exitedAt}, now() - interval '${postedDaysAgo} days'
    FROM generate_series(${from}, ${to}) g;`);
  const stored = (tag: string, from: number, to: number, postedDaysAgo: number, firstSeenDaysAgo: number) => s.push(`
    INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
    SELECT '${tok}:${tag}:'||g, 'greenhouse', '${tok}', '${cat}', now() - interval '${postedDaysAgo} days',
           now() - interval '${postedDaysAgo} days', now() - interval '${firstSeenDaysAgo} days', now() - interval '${firstSeenDaysAgo} days'
    FROM generate_series(${from}, ${to}) g;`);

  // g1: the day-30 cohort.
  closures("g1", 1, 10, 40, `now() - interval '35 days'`, { superseded: true });
  closures("g1", 11, 30, 40, `now() - interval '30 days'`);
  exits("g1", 31, 45, 40, `now() - interval '40 days' + interval '30 days 2 hours'`);
  stored("g1", 46, 60, 40, 33);
  // g2: the young cohort.
  closures("g2", 1, 10, 10, `now() - interval '7 days'`);
  stored("g2", 11, 30, 10, 3);
  // g3: dated past the cap at the batch, stored again afterwards.
  stored("g3", 1, 5, 66, 33);

  if (v === "B" || v === "B2") {
    const stamped = v === "B";
    // The doubted batch: every g1 posting stored at that instant.
    closures("g1", 11, 60, 40, BATCH, { suspect: stamped, stamped });
    // Its age-out twins, logged at the same instant by the same pass.
    exits("g3", 1, 5, 66, BATCH);
  }
  if (v === "C") {
    // Five postings that only ever appear in the doubted batch.
    closures("g4", 1, 5, 40, BATCH, { suspect: true });
  }

  s.push(`INSERT INTO public.job_board_company_snapshots VALUES ('${tok}', current_date - 40, 100);`);
  s.push(`INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('${tok}', 'full_read');`);
  s.push(`INSERT INTO public.job_board_board_watch (company_token, first_observed_on, first_observed_basis, is_censored)
          VALUES ('${tok}', current_date - 80, 'company_snapshot', true);`);
  return s.join("\n");
}

export const SEEN_AGAIN_FIXTURE = (["A", "B", "B2", "C"] as Variant[]).map(seenAgainFixture).join("\n");
