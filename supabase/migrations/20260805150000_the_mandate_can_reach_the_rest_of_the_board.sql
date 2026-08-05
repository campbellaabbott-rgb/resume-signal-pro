-- A CATEGORY CHOICE WAS SILENTLY HIDING 27.6% OF THE BOARD.
--
-- Measured 2026-08-05 against the live facets: 162,800 of 590,808 postings sit
-- in `other`. That bucket is deliberately absent from BOARD_CATEGORY_SLUGS —
-- "a catch-all bucket, not a landing page anyone searches for" — which is the
-- right call for an SEO lander and the wrong one for a filter.
--
-- agent-runner does `.eq("category", m.category)`, so the moment somebody picks
-- Engineering their agent stops seeing a quarter of the board. The postings it
-- stops seeing are not junk: `other` is where a posting lands when the
-- classifier could not place its title, which happens to plenty of ordinary
-- engineering, operations and healthcare roles. The symptom is a thin morning
-- queue, and nothing anywhere says why.
--
-- This is an OPT-IN and not a widening, deliberately. Flipping the default
-- would change what every existing mandate returns overnight, and "uncategorised"
-- genuinely does mix fields — someone searching Engineering with no title terms
-- would start seeing warehouse roles. With title terms set it is close to free,
-- because the title filter is doing the real work and the category filter can
-- only ever REMOVE postings whose title already matched. The UI says so.
--
-- AND A POSTING-AGE FLOOR, which the mandate never had.
--
-- The runner takes postings whose FIRST_SEEN is inside a 36-hour lookback —
-- new to the board. That is not the same as new to the world, and this codebase
-- has already published one false statistic on exactly that confusion:
-- first_seen is a discovery time, never a posting age. An employer's feed can
-- surface a role it posted five months ago and the agent will queue it as
-- today's find.
--
-- `max_age_days` mirrors the board's own maxAgeDays filter EXACTLY — same
-- column (posted_at), same 1..30 clamp, same consequence that undated postings
-- fall outside it because `>=` cannot be satisfied by NULL. A second definition
-- of "fresh" on the same corpus is how two surfaces start disagreeing about the
-- same posting.
--
-- NULL means no age constraint, which is what every existing row gets, so this
-- migration changes nothing until somebody sets a value.

ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS max_age_days integer,
  ADD COLUMN IF NOT EXISTS include_uncategorised boolean NOT NULL DEFAULT false;

ALTER TABLE public.agent_searches
  ADD COLUMN IF NOT EXISTS max_age_days integer,
  ADD COLUMN IF NOT EXISTS include_uncategorised boolean NOT NULL DEFAULT false;

-- The clamp lives in the runner as well; this stops a value the runner would
-- have to silently correct from being stored in the first place. A stored 400
-- that behaves as 30 is a row that lies about itself.
ALTER TABLE public.agent_mandates
  DROP CONSTRAINT IF EXISTS agent_mandates_max_age_days_range;
ALTER TABLE public.agent_mandates
  ADD CONSTRAINT agent_mandates_max_age_days_range
  CHECK (max_age_days IS NULL OR (max_age_days >= 1 AND max_age_days <= 30));

ALTER TABLE public.agent_searches
  DROP CONSTRAINT IF EXISTS agent_searches_max_age_days_range;
ALTER TABLE public.agent_searches
  ADD CONSTRAINT agent_searches_max_age_days_range
  CHECK (max_age_days IS NULL OR (max_age_days >= 1 AND max_age_days <= 30));

COMMENT ON COLUMN public.agent_mandates.max_age_days IS
  'Only queue postings the employer STATED were posted within this many days. '
  'Mirrors the board''s maxAgeDays: applies to posted_at, 1-30, and undated '
  'postings fall outside it because we never guess an age. NULL = no constraint.';
COMMENT ON COLUMN public.agent_mandates.include_uncategorised IS
  'Also search the `other` bucket, which held 27.6% of the board on 2026-08-05. '
  'Off by default: a category choice keeps meaning exactly what it meant before.';
