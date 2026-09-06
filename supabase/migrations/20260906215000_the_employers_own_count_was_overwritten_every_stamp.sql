-- THE MOST VALUABLE NUMBER WE TOUCH HAS NO HISTORY, BECAUSE ITS TABLE HAS ONE
-- ROW PER BOARD.
--
-- job_board_verifications is PRIMARY KEY (company_token). It carries
-- feed_total — the EMPLOYER'S OWN advertised posting count, read straight off
-- their careers feed. That is the only figure in this entire system we did not
-- derive: everything else is our count of what we managed to store. And it is
-- UPSERTed on every successful board fetch, so each stamp destroys the
-- previous value. There is no history of it anywhere.
--
-- Live example, 2026-09-06: CVS Health, 678 rows stored against 19,265
-- advertised. Our stored count for a windowed board like that is close to
-- meaningless as a hiring signal — it measures our pagination, not their
-- hiring. Their own number is the signal, and we overwrite it daily.
--
-- WHAT AN APPEND-ONLY SERIES OF IT BUYS, none of which is recoverable later:
--   * an employer-side hiring trend for every windowed board, where our own
--     stored count cannot produce one
--   * an auditable COVERAGE RATIO (live_count / feed_total) to publish beside
--     every number we sell, instead of asserting completeness — read only off
--     rows where state <> 'truncated', because live_count is what ONE fetch
--     returned and a windowed board's fetch is a slice (see its comment)
--   * the ATS-migration signal: feed_total collapsing to zero or the board
--     going dark while the company is demonstrably still hiring
--
-- ONE ROW PER BOARD PER DAY, ENFORCED BY THE KEY, NOT BY THE CALLER. Hot
-- boards are fetched several times a day; the primary key is
-- (company_token, observed_on) so the fifth fetch of the day overwrites the
-- first rather than appending a fifth row. The writer upserts with
--
--     onConflict: "company_token,observed_on"
--
-- and does NOT need to send observed_on: a BEFORE trigger derives it from
-- observed_at, so the key can never disagree with the timestamp beside it.
--
-- MEMORY: this is one small upsert per board, written alongside the
-- verification stamp that already fires per board at index.ts ~3685. It adds
-- no per-posting allocation and no array — the ingest loop dies on
-- WORKER_RESOURCE_LIMIT at ~1,800 postings and nothing here scales with
-- postings.

CREATE TABLE IF NOT EXISTS public.job_board_board_state (
  company_token text NOT NULL,
  observed_on   date NOT NULL DEFAULT current_date,
  source        text NOT NULL DEFAULT '',
  observed_at   timestamptz NOT NULL DEFAULT now(),
  live_count    integer,
  stored_count  integer,
  feed_total    integer,
  state         text NOT NULL DEFAULT 'ok',
  PRIMARY KEY (company_token, observed_on)
);

COMMENT ON TABLE public.job_board_board_state IS
  'Append-only daily ledger of what each employer''s board looked like when we '
  'fetched it: our count, THEIR advertised count, and whether the fetch '
  'worked. One row per board per day, keyed so a board fetched five times a '
  'day writes one row rather than five. Exists because '
  'job_board_verifications is keyed by company_token alone and therefore '
  'overwrites feed_total — the only ground-truth number in the system — on '
  'every stamp. Private: RLS on, no policy, service_role only.';

COMMENT ON COLUMN public.job_board_board_state.company_token IS
  'The BOARD identity (vendor tenant), not the employer: one employer may hold '
  'several tokens (PwC has four) and every eu~ mirror is its own token. Do not '
  'sum across tokens without a company-entity mapping, which does not exist.';
COMMENT ON COLUMN public.job_board_board_state.observed_on IS
  'OUR observation date, derived by trigger from observed_at (UTC). It is the '
  'day WE looked, not any employer date, and it carries no posting age. Part '
  'of the primary key: this is what makes the ledger at most daily.';
COMMENT ON COLUMN public.job_board_board_state.observed_at IS
  'OUR observation time: when the fetch that produced this row completed. On a '
  'board fetched several times in a day this is the LAST such fetch, because '
  'the row is upserted.';
COMMENT ON COLUMN public.job_board_board_state.source IS
  'The ATS vendor this board was fetched from (greenhouse, workday, lever...). '
  'Kept per row rather than looked up, so a board changing vendor is visible '
  'in the series itself — that transition is the ATS-migration signal.';
COMMENT ON COLUMN public.job_board_board_state.live_count IS
  'HOW MANY POSTINGS THIS FETCH RETURNED AND KEPT — the vendor''s payload for '
  'this pass, after dropping postings whose stated date is older than the '
  '30-day freshness window. IT IS NOT A QUERY OVER STORED ROWS AND CARRIES NO '
  'SERVING FENCE. Two consequences a reader must hold: on a paginating vendor '
  '(workday, oracle, icims, smartrecruiters, rippling) a pass resumes from an '
  'offset, so this is ONE SLICE of the board and not its size — state = '
  '''truncated'' marks those rows; and an undated board keeps every posting '
  'here while the site may serve none of them, because effective_posted falls '
  'back to our discovery date and ages out. The honest use is as the numerator '
  'against feed_total on a non-truncated row. NULL means not measured on this '
  'fetch, never zero.';
COMMENT ON COLUMN public.job_board_board_state.stored_count IS
  'How many rows we HOLD for this board at observation time, fenced or not, '
  'computed from this pass''s own arithmetic (rows we already had, plus this '
  'pass''s inserts, minus this pass''s prune) rather than by a COUNT query. '
  'The gap to feed_total is our coverage. It is NOT comparable with live_count '
  'as a staleness measure — that gap is mostly pagination, since live_count is '
  'one fetch and this is the whole board. NULL means not measured, never '
  'zero.';
COMMENT ON COLUMN public.job_board_board_state.feed_total IS
  'THE EMPLOYER''S OWN ADVERTISED COUNT, verbatim from their feed, unmodified. '
  'The only figure here we did not derive. NULL means the vendor did not state '
  'one (most do not) — it is NOT zero, and a coverage ratio must skip those '
  'rows rather than treat them as complete coverage.';
COMMENT ON COLUMN public.job_board_board_state.state IS
  'How the fetch went. Vocabulary: ok (fetched and stored normally) | empty '
  '(fetched fine, the employer advertises nothing) | truncated (the fetch was '
  'cut short, so live_count/stored_count understate and no closure may be '
  'inferred from this row) | error (the fetch failed) | dark (the board '
  'answered but served nothing while we hold rows for it). Deliberately NOT a '
  'CHECK constraint: this row is a best-effort write, and a rejected value '
  'would lose the observation entirely rather than degrade it.';

-- The key must never disagree with the timestamp beside it, and the writer
-- must not have to remember to send both.
CREATE OR REPLACE FUNCTION public.job_board_board_state_day()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.observed_on := (NEW.observed_at AT TIME ZONE 'UTC')::date;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.job_board_board_state_day() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_board_board_state_day ON public.job_board_board_state;
CREATE TRIGGER trg_job_board_board_state_day
  BEFORE INSERT OR UPDATE ON public.job_board_board_state
  FOR EACH ROW EXECUTE FUNCTION public.job_board_board_state_day();

-- One board's series over time is the PK's own order. The other read is "every
-- board on a given day", for a coverage sweep.
CREATE INDEX IF NOT EXISTS job_board_board_state_day_idx
  ON public.job_board_board_state (observed_on DESC);

ALTER TABLE public.job_board_board_state ENABLE ROW LEVEL SECURITY;
-- No policy and no anon grant: RLS with no policy leaves service_role alone
-- able to read it. This is the same class of asset as the closure log, which
-- was anon-readable for its first 35 days.
GRANT ALL ON public.job_board_board_state TO service_role;

-- NO RETENTION JOB, DELIBERATELY. ~44,500 boards a day is ~16M rows a year of
-- five narrow columns, and the whole value of the table is that it is long.
-- A prune here would need a rollup first, in the shape of
-- roll_up_and_prune_closures — never a bare DELETE, which is what
-- 20260727140000 caught being scheduled against the closure log.
