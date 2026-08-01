-- Work authorisation is country-specific. A single boolean was not.
--
-- THE BUG, found 2026-08-01 in code shipped that morning. `work_authorized` is
-- one global boolean, and every authorisation question was answered from it.
-- A candidate authorised in the UK answered "Yes" to:
--
--     Are you legally authorized to work in the US?
--     Work authorization in Germany:
--     Are you legally authorised to work in Australia?
--
-- All three false, stated to an employer under a real person's name, on the
-- question employers filter hardest on. That is not a wasted application — it
-- is a false claim about someone's immigration status.
--
-- Being authorised somewhere is not being authorised everywhere. The boolean
-- can honestly speak for the country the candidate said they are in, and
-- nothing else; anywhere else has to be stated explicitly.
ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS work_authorized_countries text[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.agent_mandates.work_authorized_countries IS
  'Country codes the candidate has EXPLICITLY stated they may work in (US, GB, '
  'DE, ...). Never inferred. Empty means work_authorized speaks only for the '
  'country column; a question naming any other country is refused rather than '
  'answered. See worker/src/questions/countries.ts.';