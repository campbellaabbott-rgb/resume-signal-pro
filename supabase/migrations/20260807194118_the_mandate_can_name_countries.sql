-- "ANYWHERE IN GERMANY" COULD NOT BE SAID.
--
-- A mandate matched place by substring on each posting's own location TEXT.
-- Measured against production 2026-08-07:
--
--     country = DE           11,511 postings    what the BOARD can express
--     location ~ 'Germany'    7,594             what a MANDATE could express
--     location ~ 'Berlin'     2,604
--
--     country = GB           21,126
--     location ~ 'London'    10,195
--
-- A third of German postings never spell the country in their location line —
-- they say "Berlin", or "Munich, Bavaria" — so a person job-hunting in Germany
-- either named every city or lost the rest of the country. The board has had a
-- normalised `country` column all along, filled by the same parser that fills
-- the board's country facet; the mandate simply had no field for it.
--
-- TEXT, COMMA-SEPARATED, exactly like `q` and `location` already are. The agent
-- has one convention for "several of these" and this follows it rather than
-- inventing an array column beside two text ones. A value with no comma is a
-- single country, and NULL or '' is NO country predicate at all — which is
-- today's behaviour, so this migration changes nothing until somebody picks a
-- country.
--
-- NOT A FOREIGN KEY to any country table, and no CHECK on the contents. The
-- validation that matters is `parseCountries` in _shared/mandate-reach.ts,
-- which drops anything that is not two letters BEFORE it becomes a predicate —
-- because the failure to avoid is a filter that silently matches nothing, and a
-- constraint here would instead reject the whole save and lose the user's other
-- edits. Length is bounded so a pasted essay cannot become a mandate.

ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS countries text;

ALTER TABLE public.agent_searches
  ADD COLUMN IF NOT EXISTS countries text;

ALTER TABLE public.agent_mandates
  DROP CONSTRAINT IF EXISTS agent_mandates_countries_len;
ALTER TABLE public.agent_mandates
  ADD CONSTRAINT agent_mandates_countries_len
  CHECK (countries IS NULL OR length(countries) <= 64);

ALTER TABLE public.agent_searches
  DROP CONSTRAINT IF EXISTS agent_searches_countries_len;
ALTER TABLE public.agent_searches
  ADD CONSTRAINT agent_searches_countries_len
  CHECK (countries IS NULL OR length(countries) <= 64);

COMMENT ON COLUMN public.agent_mandates.countries IS
  'Comma-separated ISO-3166-1 alpha-2 codes the agent may apply in, e.g. '
  '"DE,AT,CH". Matched against job_board_postings.country, the same normalised '
  'column the board''s country filter uses — location text alone missed a third '
  'of German postings because they name only the city. NULL or empty means no '
  'country constraint. Validated in _shared/mandate-reach.ts, not here: an '
  'unrecognised code must be dropped, never turned into a filter that matches '
  'nothing.';
COMMENT ON COLUMN public.agent_searches.countries IS
  'Per-search override of the same country scope. See agent_mandates.countries.';
