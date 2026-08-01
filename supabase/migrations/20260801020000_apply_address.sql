-- The agent can be asked for a street address and a postcode. It holds neither.
--
-- MEASURED 2026-08-01 across 29 live application forms harvested from Breezy,
-- Pinpoint and Teamtailor:
--
--   * "Zipcode" was required on 3 forms and was the SOLE remaining blocker on
--     all 3 — fix it and those postings ship.
--   * "What is your current residential address?" was required on a Breezy
--     form carrying 27 custom required fields.
--
-- The worker had a comment where the address should be:
--
--     // No address column exists. Left empty on purpose so that a form
--     // requiring an address refuses rather than receiving a city where a
--     // street should be.
--
-- That was the right call with no column, and the wrong long-term answer: the
-- refusal is honest but it is still a lost application, and the candidate is
-- perfectly able to tell us their address. So the column is added rather than
-- the refusal being loosened.
--
-- ON MEASUREMENT HONESTY. The coverage run that produced "13 of 29 forms
-- completable" used a test profile carrying an address — data the product had
-- no way to store. That number was therefore about a candidate who cannot
-- exist. Adding these columns is what makes it true, not a way of scoring
-- better against it.
--
-- NOT DERIVED, ever. A postcode is not parsed out of a free-text address and an
-- address is not assembled from city + country. A wrong postcode on an
-- application is worse than an admitted blank, and the matcher refuses rather
-- than guessing when either is empty.

ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS address  text,
  ADD COLUMN IF NOT EXISTS postcode text;

COMMENT ON COLUMN public.agent_mandates.address IS
  'Street address as the candidate wrote it. Never assembled from city/country.';
COMMENT ON COLUMN public.agent_mandates.postcode IS
  'Postal/ZIP code, stated separately. Never parsed out of address — a wrong '
  'postcode on an application is worse than an admitted blank.';
