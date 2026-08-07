ALTER TABLE public.agent_mandates ADD COLUMN IF NOT EXISTS countries text;
ALTER TABLE public.agent_searches ADD COLUMN IF NOT EXISTS countries text;
ALTER TABLE public.agent_mandates DROP CONSTRAINT IF EXISTS agent_mandates_countries_len;
ALTER TABLE public.agent_mandates ADD CONSTRAINT agent_mandates_countries_len CHECK (countries IS NULL OR length(countries) <= 64);
ALTER TABLE public.agent_searches DROP CONSTRAINT IF EXISTS agent_searches_countries_len;
ALTER TABLE public.agent_searches ADD CONSTRAINT agent_searches_countries_len CHECK (countries IS NULL OR length(countries) <= 64);
COMMENT ON COLUMN public.agent_mandates.countries IS 'Comma-separated ISO-3166-1 alpha-2 codes the agent may apply in, e.g. "DE,AT,CH". Matched against job_board_postings.country. NULL or empty means no country constraint. Validated in _shared/mandate-reach.ts.';
COMMENT ON COLUMN public.agent_searches.countries IS 'Per-search override of the same country scope. See agent_mandates.countries.';