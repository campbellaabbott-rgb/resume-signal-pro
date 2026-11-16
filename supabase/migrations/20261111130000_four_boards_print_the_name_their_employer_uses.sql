-- SUB-HOURLY CRON REVIEW MARKER: not required. This file schedules nothing
-- (reviewed 2026-11-16 in the board .102 integration).
--
-- FOUR BOARDS PRINT THE NAME THEIR EMPLOYER USES.
--
-- The SEO/GEO audit of 2026-11-07 (B05) found four bare-token boards printing
-- a name their employer does not use: ashby creatoriq ("Creatoriq"), ashby
-- harmattan-ai ("Harmattan Ai"), personio deag-deutsche-entertainment-ag
-- (a web address, "https://www.deag.de/navi-bottom/investors/karriere.html?t=1")
-- and lever americaatwork ("Americaatwork"), which is also a search firm and
-- is labelled an agency in the same build.
--
-- WHERE EACH NAME CAME FROM. The employer's own words for itself, read on
-- 2026-11-08 by the seo-connect build (one request a second per host): the
-- board's own postings on the vendor's public feed, or a posting's own page.
-- Each was read again on 2026-11-15 and still says the same.
--
-- WHAT THIS FILE DOES AND DOES NOT. A bare token cannot take a
-- company_name_overrides row, so the names themselves are the catalogue's:
-- job-board 2026-09-09.102 renames the four entries in sources.ts (and its
-- byte-identical layoff-filings copy) and lists them in RENAMED_TOKENS, and
-- its name-sync lane (NAME_SYNC_VERSION 7) renames the stored rows. This file
-- only keeps the evidence, one company_name_evidence row per board keyed
-- vendor:token (the 20261026100000 pattern), in the table 20261025100000
-- made, which only the service role reads. It writes no override.
--
-- ORDER: before job-board deploys (docs/deploy-ledger.json migrationOrder),
-- like 20261026100000, so the evidence exists before the names change.
--
-- RE-RUNNABLE: ON CONFLICT DO NOTHING. No table is created here, so no grant
-- changes; the self-check says again that no client role can read the rows.

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '1min';

DO $$
BEGIN
  IF to_regclass('public.company_name_evidence') IS NULL THEN
    RAISE EXCEPTION 'self-check 20261111130000: public.company_name_evidence does not exist; apply 20261025100000 first';
  END IF;
END $$;

INSERT INTO public.company_name_evidence (slug, display_name, evidence, quote, read_on) VALUES
  ('ashby:creatoriq', 'CreatorIQ', ARRAY['https://api.ashbyhq.com/posting-api/job-board/creatoriq'], 'postings: "Interested about what we do at CreatorIQ?" and "CreatorIQ is seeking a strategic, revenue-driven Partner Manager"', DATE '2026-11-08'),
  ('ashby:harmattan-ai', 'Harmattan AI', ARRAY['https://api.ashbyhq.com/posting-api/job-board/harmattan-ai'], 'postings: "Harmattan AI is a next-generation defense prime building autonomous and scalable defense systems"', DATE '2026-11-08'),
  ('lever:americaatwork', 'America At Work', ARRAY['https://api.lever.co/v0/postings/americaatwork?mode=json'], 'posting "Director, Finance Business Partner – Technology Infrastructure": "America At Work is conducting this search on behalf of a confidential global organization."', DATE '2026-11-08'),
  ('personio:deag-deutsche-entertainment-ag', 'DEAG Deutsche Entertainment AG', ARRAY['https://deag-deutsche-entertainment-ag.jobs.personio.de/job/2859520'], 'posting description and og:description: "Die DEAG Deutsche Entertainment AG, gegründet 1978 in Berlin"', DATE '2026-11-08')
ON CONFLICT (slug) DO NOTHING;

-- SELF-CHECK. Raises, and so rolls the insert back, unless:
--   1. each of the four rows is there, naming the employer this file names,
--      with an http(s) link and the words read (a row an earlier run or a hand
--      left under another name fails here, since DO NOTHING would keep it);
--   2. no company_name_overrides row is keyed by these slugs (the override
--      trigger never reads a key with a ":", so one would be a dead row);
--   3. row level security is on, no client role can read or write the
--      evidence, and the service role can read it.
DO $$
DECLARE
  n int;
  bad text;
BEGIN
  SELECT count(*) INTO n FROM public.company_name_evidence
   WHERE (slug, display_name) IN (('ashby:creatoriq', 'CreatorIQ'), ('ashby:harmattan-ai', 'Harmattan AI'),
                                  ('lever:americaatwork', 'America At Work'), ('personio:deag-deutsche-entertainment-ag', 'DEAG Deutsche Entertainment AG'))
     AND length(quote) >= 10
     AND cardinality(evidence) >= 1
     AND NOT EXISTS (SELECT 1 FROM unnest(evidence) l WHERE l !~ '^https?://[^[:space:]]+$');
  IF n <> 4 THEN
    SELECT string_agg(slug || '=' || display_name, ', ') INTO bad FROM public.company_name_evidence
     WHERE slug IN ('ashby:creatoriq', 'ashby:harmattan-ai', 'lever:americaatwork', 'personio:deag-deutsche-entertainment-ag');
    RAISE EXCEPTION 'self-check 20261111130000: % of the 4 evidence rows this file writes are there as written (found: %)', n, coalesce(bad, 'none');
  END IF;
  IF EXISTS (SELECT 1 FROM public.company_name_overrides
              WHERE slug IN ('ashby:creatoriq', 'ashby:harmattan-ai', 'lever:americaatwork', 'personio:deag-deutsche-entertainment-ag')) THEN
    RAISE EXCEPTION 'self-check 20261111130000: an override is keyed vendor:token, which the override trigger never reads';
  END IF;
  IF NOT (SELECT c.relrowsecurity FROM pg_class c WHERE c.oid = 'public.company_name_evidence'::regclass) THEN
    RAISE EXCEPTION 'self-check 20261111130000: row level security is off on public.company_name_evidence';
  END IF;
  IF has_table_privilege('anon', 'public.company_name_evidence', 'SELECT')
     OR has_table_privilege('anon', 'public.company_name_evidence', 'INSERT')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'SELECT')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'INSERT')
     OR has_table_privilege('authenticated', 'public.company_name_evidence', 'UPDATE') THEN
    RAISE EXCEPTION 'self-check 20261111130000: anon or authenticated can read or write public.company_name_evidence';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.company_name_evidence', 'SELECT') THEN
    RAISE EXCEPTION 'self-check 20261111130000: the service role cannot read public.company_name_evidence';
  END IF;
  RAISE NOTICE 'self-check 20261111130000: 4 evidence rows, keyed vendor:token, no override';
END $$;
