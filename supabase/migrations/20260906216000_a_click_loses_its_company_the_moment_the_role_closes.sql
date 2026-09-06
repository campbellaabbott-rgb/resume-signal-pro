-- THE DEMAND LOG RECORDS WHAT WAS CLICKED, AND FORGETS WHAT IT WAS.
--
-- job_board_search_clicks stores search_id, posting_id, q, position, kind. The
-- posting row is HARD-DELETED when the role closes, so the moment a role comes
-- down we permanently lose, for every click that ever landed on it: which
-- employer it belonged to, what category it was, whether it disclosed pay, and
-- what work mode it advertised. A click on a role that closed in August is
-- already an orphan string today.
--
-- job_board_posting_reports already stamps company_token at insert for exactly
-- this reason. The click handler never did.
--
-- THE HANDLER STAYS FAST. It is a beacon fired as a visitor navigates away to
-- an employer's site, and it already answers immediately and does its write
-- inside waitUntil. One posting lookup INSIDE that waitUntil is acceptable;
-- a lookup BEFORE the response is not, and would cost the click it exists to
-- record.
--
-- ── AND THE DENOMINATOR: WHAT WAS SHOWN, NOT ONLY WHAT WAS CHOSEN ────────
--
-- Every employer-level demand number we can currently produce is confounded by
-- our own ranking. "Employer X gets twice the clicks of employer Y" may mean
-- candidates want X, or it may mean X sat at position 2 and Y at position 40 —
-- and the ranking changed materially several times last month, so the
-- confound is not even constant. Without an impression record there is no
-- denominator and the two readings can never be separated for any day already
-- past.
--
-- N IS CAPPED HARD AT 20 AND THE CAP IS ENFORCED BY TRIGGER, not by trust in
-- the caller: 20 posting ids is ~1KB per search event, and this table takes
-- every /v1 customer's traffic as well as the site's. Posting ids rather than
-- company tokens because a posting id IS source:company_token:externalId — the
-- employer is derivable from it, so the wider fact costs nothing.

-- ── the click: who it was for ────────────────────────────────────────────
ALTER TABLE public.job_board_search_clicks
  ADD COLUMN IF NOT EXISTS company_token  text,
  ADD COLUMN IF NOT EXISTS category       text,
  ADD COLUMN IF NOT EXISTS salary_present boolean;

COMMENT ON COLUMN public.job_board_search_clicks.company_token IS
  'The BOARD the clicked posting belonged to, resolved at INSERT time from the '
  'posting row. Denormalised because that row is deleted at closure and this '
  'is the last moment the fact exists. NULL means the lookup found no posting '
  '(a stale link, or a role that closed between the impression and the click) '
  '— it does not mean the click had no employer.';
COMMENT ON COLUMN public.job_board_search_clicks.category IS
  'The clicked posting''s category at click time, stamped at insert for the '
  'same reason. OUR classification, not the employer''s words.';
COMMENT ON COLUMN public.job_board_search_clicks.salary_present IS
  'Whether the clicked posting disclosed pay at click time (salary_min_annual '
  'IS NOT NULL). The one demand question that cannot be reconstructed later at '
  'all: it asks whether disclosure changes click-through, and both sides of '
  'that comparison vanish with the posting. NULL means the posting could not '
  'be looked up, never "no pay disclosed".';
COMMENT ON COLUMN public.job_board_search_clicks.at IS
  'OUR OBSERVATION TIME: when the click beacon reached us. Not an employer '
  'date and not a posting age.';

-- One employer's demand over time is the read this table will get. Partial, so
-- the index does not carry the rows written before the stamp existed.
CREATE INDEX IF NOT EXISTS job_board_search_clicks_company_idx
  ON public.job_board_search_clicks (company_token, at DESC)
  WHERE company_token IS NOT NULL;

-- ── the search event: what was shown, and who asked ──────────────────────
ALTER TABLE public.job_board_search_events
  ADD COLUMN IF NOT EXISTS shown jsonb;

COMMENT ON COLUMN public.job_board_search_events.shown IS
  'The IMPRESSION: a JSON array of up to 20 posting ids in the exact order '
  'they were served, so click-through has a denominator. Position is the array '
  'index — absolute rank is offset_n + index + 1, matching the 1-based '
  'absolute rank stored on the click. A posting id is '
  'source:company_token:externalId, so the employer of every impression is '
  'derivable without a second column. Truncated to 20 elements by trigger. '
  'NULL means the response predates this column or served nothing; an empty '
  'array means a search that genuinely returned no rows.';

-- ── the caller: our own monitoring, finally distinguishable ──────────────
--
-- logSearch() fires unconditionally at eight call sites, and action:'list' is
-- called by us constantly: the filter audit's self-calls (~31 a day),
-- scan-heartbeat's contract battery (including a literal {salaryFloor:100000}
-- probe), send-search-digest replaying saved searches nightly, agent-mcp on
-- every tool call, and every paying /v1 customer, since public-api proxies
-- straight through. All of it lands in the same table as a candidate typing
-- "nurse", indistinguishable — no bot flag, no visitor id, no user agent, no
-- source column. Every "candidates search for X" number we have quoted is
-- contaminated by our own monitoring, and NO retroactive filter can separate
-- them, because the probes issue ordinary queries with ordinary filters and
-- the only distinguishing fact was never written down.
--
-- NO DEFAULT, AND THAT IS THE WHOLE POINT OF THE COLUMN.
--
-- The obvious shape is `ADD COLUMN caller text DEFAULT 'web'`. It is wrong
-- twice over. Backfilling history to 'web' would assert that months of
-- unlabelled traffic was human — the contamination restated as fact. And a
-- forward default is worse, because of WHICH requests it catches: the resolver
-- already returns 'web' whenever an Origin or Referer header is present, so a
-- real browser is labelled by the resolver, not by the default. The default
-- fires only on requests with no declared caller, no service-role bearer and
-- NO ORIGIN OR REFERER — that is, on the population that is by construction
-- not a browser. Server-to-server callers holding only the public anon key
-- land there (the botwall sweep's own `list` calls are exactly this today),
-- and stamping them 'web' converts "we do not know" into a false positive
-- assertion of candidate demand that no later filter can undo. An unlabelled
-- row is honestly unknown; a wrongly-labelled one is the failure this column
-- exists to end.
--
-- So the column is NULLABLE with no default: NULL means UNATTRIBUTED. Rows
-- with at < 2026-09-06 are unattributed because the column did not exist;
-- rows after it are unattributed because the request declared nothing and
-- carried no attributable signal. Both are honestly unknown, and the date
-- separates them.
ALTER TABLE public.job_board_search_events
  ADD COLUMN IF NOT EXISTS caller text;
ALTER TABLE public.job_board_search_events
  ALTER COLUMN caller DROP DEFAULT;

ALTER TABLE public.job_board_search_events
  DROP CONSTRAINT IF EXISTS job_board_search_events_caller_check;
ALTER TABLE public.job_board_search_events
  ADD CONSTRAINT job_board_search_events_caller_check
  CHECK (caller IN ('web', 'api', 'mcp', 'digest', 'maintenance'));

COMMENT ON COLUMN public.job_board_search_events.caller IS
  'WHO ASKED, as a closed set: web (the site — a human in a browser) | api (a '
  'paying /v1 customer through public-api) | mcp (an agent through agent-mcp) '
  '| digest (send-search-digest replaying a real user''s saved search on a '
  'cadence — our traffic on their query, which is neither candidate demand nor '
  'monitoring) | maintenance (our own monitoring: scan-heartbeat''s battery '
  'and the filter audit''s self-calls; never candidate demand). '
  'A SELF-DECLARED HINT, NOT AN AUTHENTICATED IDENTITY: it is read from the '
  'caller field or the x-rsp-caller / x-rb-caller request header, the anon key '
  'is public, and nothing is authorised on the strength of it. '
  'NULL MEANS UNATTRIBUTED, and there is no default that would guess: a row '
  'with at < 2026-09-06 predates the column; a later NULL is a request that '
  'declared no caller, held no service-role bearer and sent no Origin or '
  'Referer — which is not a browser, and must never be counted as one. Exclude '
  'NULL from any demand number rather than folding it into web; the whole '
  'purpose of this column is that our own traffic stops being invisible, and a '
  'wrong label is less recoverable than a missing one.';

-- Reading demand means excluding our own traffic, so caller leads.
CREATE INDEX IF NOT EXISTS job_board_search_events_caller_idx
  ON public.job_board_search_events (caller, at DESC);

-- ── caps enforced in the database, because a lost row is unrecoverable ───
-- A CHECK on array length would REJECT an over-long impression list and lose
-- the whole event; these inserts are best-effort waitUntil writes whose
-- failure mode is silence. The trigger truncates so the row always lands.
CREATE OR REPLACE FUNCTION public.job_board_search_events_cap()
RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.shown IS NOT NULL THEN
    IF jsonb_typeof(NEW.shown) <> 'array' THEN
      NEW.shown := NULL;
    ELSIF jsonb_array_length(NEW.shown) > 20 THEN
      NEW.shown := (
        SELECT COALESCE(jsonb_agg(e.v ORDER BY e.i), '[]'::jsonb)
        FROM jsonb_array_elements(NEW.shown) WITH ORDINALITY AS e(v, i)
        WHERE e.i <= 20
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.job_board_search_events_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_job_board_search_events_cap ON public.job_board_search_events;
CREATE TRIGGER trg_job_board_search_events_cap
  BEFORE INSERT OR UPDATE ON public.job_board_search_events
  FOR EACH ROW EXECUTE FUNCTION public.job_board_search_events_cap();

-- Both tables keep RLS on with no policy and no anon grant, exactly as
-- 20260821010000 left them: this is behavioural data about real visitors, and
-- 20260821030000 is the record of what happens when a DEFINER function reads
-- through that lock for an anon caller.
