-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-16 in the bug round A integration).
--
-- A WAGE FILING UNDER A REFUSED OR UNPLACED EMPLOYER IS NEVER SERVED
-- (S14X-067, S14X-068, RC-OI-21).
--
-- The rejected-pair ledger (LCA_REFUSED_TOKENS in
-- supabase/functions/layoff-filings/lca-cells.ts) kept a refused token's
-- cells out of the next quarterly load, and nothing else: no migration
-- deleted the cells already loaded and the reader had no refusal, so the
-- live reader still printed socialfinance's WA cells (n=66) and
-- sigmasoftware2's TX cells (n=11, its US-posting gate open again since the
-- board gained one US posting), and the twin-vendor token sunday kept its CA
-- cells. Two more name matches are added to the ledger here: a Missouri
-- health network's filings (MO cells) on a same-named California care
-- provider's board, and a Minnesota distributor's filings (MN/TX) on a
-- same-named Florida employer's board.
--
-- So:
--   1. public.lca_refused_tokens holds the ledger in the database
--      (service_role only; a cross-runtime guard keeps this seed equal to
--      Object.keys(LCA_REFUSED_TOKENS));
--   2. the loaded cells of the ledger and of today's four twin-vendor tokens
--      (echo, lockwood, roadrunner, sunday) are deleted;
--   3. get_employer_lca_wages answers the no-cell row for a ledger token,
--      and admits a board whose live postings all leave the country blank
--      when one of them names, by region code or by a comma part of its
--      location (", GA" or ", Georgia"), a state its cells were filed in
--      (Hisense USA's postings say "Alpharetta, Georgia" with no country;
--      its cells are GA). A board with a live US posting is admitted as
--      before; a board with any other country and no US posting is not.
--
-- DECLINED HERE: refusing a board whose US postings name states none of its
-- cells were filed in. It could not be measured over the payload's 1,442
-- tokens read-only, an employer that files for its headquarters and hires
-- elsewhere would be hidden, and the two boards it was written for are in
-- the ledger above.
--
-- The reader is rewritten from the catalogue (one anchor, refused if the
-- live body drifted from 20261009160300). Signature, DEFINER, search_path,
-- timeout and grants are unchanged. Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '1min';

CREATE TABLE IF NOT EXISTS public.lca_refused_tokens (
  company_token text PRIMARY KEY,
  evidence      text NOT NULL CHECK (btrim(evidence) <> ''),
  refused_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lca_refused_tokens IS
  'Board tokens a name match joined to another company''s H-1B/H-1B1/E-3 labor condition filings, '
  'verified by reading the board''s own postings. get_employer_lca_wages answers the no-cell row for '
  'them, whatever oflc_lca_wages holds. Mirrors LCA_REFUSED_TOKENS in '
  'supabase/functions/layoff-filings/lca-cells.ts (a cross-runtime guard keeps the two equal). '
  'service_role only.';

ALTER TABLE public.lca_refused_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lca_refused_tokens FROM PUBLIC;
REVOKE ALL ON TABLE public.lca_refused_tokens FROM anon;
REVOKE ALL ON TABLE public.lca_refused_tokens FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lca_refused_tokens TO service_role;

INSERT INTO public.lca_refused_tokens (company_token, evidence) VALUES
  ('socialfinance', 'SoFi''s filings ("SOCIAL FINANCE LLC") on a Boston nonprofit''s board'),
  ('sigmasoftware2', 'two US filers ("SIGMA SOFTWARE LLC" and "SIGMA SOFTWARE INC") name-matched to a Ukrainian and Polish firm''s board'),
  ('ebb9e98a-78f1-47eb-a562-c52b36b09dd3', 'a Missouri health network''s filings (MO cells) on a same-named California care provider''s board'),
  ('32d78507-2175-47fb-8427-a89a691203be', 'a Minnesota distributor''s filings (MN/TX cells) on a same-named Florida employer''s board')
ON CONFLICT (company_token) DO NOTHING;

DELETE FROM public.oflc_lca_wages w
 WHERE w.company_token IN (SELECT rt.company_token FROM public.lca_refused_tokens rt)
    OR w.company_token IN ('echo', 'lockwood', 'roadrunner', 'sunday');

DO $mig$
DECLARE
  v_def  text := pg_get_functiondef('public.get_employer_lca_wages(text[], text, text)'::regprocedure);
  v_gate text := E'      AND EXISTS (SELECT 1 FROM public.job_board_postings jp\n                   WHERE jp.company_token = w.company_token AND jp.missing_since IS NULL AND jp.country = ''US'')\n';
  v_new  text := $gate$      AND NOT EXISTS (SELECT 1 FROM public.lca_refused_tokens rt WHERE rt.company_token = w.company_token)
      AND CASE
            WHEN EXISTS (SELECT 1 FROM public.job_board_postings jp
                   WHERE jp.company_token = w.company_token AND jp.missing_since IS NULL AND jp.country = 'US') THEN true
            WHEN EXISTS (SELECT 1 FROM public.job_board_postings jx
                          WHERE jx.company_token = w.company_token AND jx.missing_since IS NULL
                            AND NULLIF(btrim(jx.country), '') IS NOT NULL) THEN false
            ELSE EXISTS (
              SELECT 1
                FROM public.job_board_postings jb
                JOIN public.oflc_lca_wages wc
                  ON wc.company_token = jb.company_token AND wc.fiscal_quarter = w.fiscal_quarter
                JOIN (VALUES
                  ('AL','ALABAMA'),('AK','ALASKA'),('AZ','ARIZONA'),('AR','ARKANSAS'),('CA','CALIFORNIA'),('CO','COLORADO'),
                  ('CT','CONNECTICUT'),('DE','DELAWARE'),('DC','DISTRICT OF COLUMBIA'),('FL','FLORIDA'),('GA','GEORGIA'),
                  ('HI','HAWAII'),('ID','IDAHO'),('IL','ILLINOIS'),('IN','INDIANA'),('IA','IOWA'),('KS','KANSAS'),
                  ('KY','KENTUCKY'),('LA','LOUISIANA'),('ME','MAINE'),('MD','MARYLAND'),('MA','MASSACHUSETTS'),
                  ('MI','MICHIGAN'),('MN','MINNESOTA'),('MS','MISSISSIPPI'),('MO','MISSOURI'),('MT','MONTANA'),
                  ('NE','NEBRASKA'),('NV','NEVADA'),('NH','NEW HAMPSHIRE'),('NJ','NEW JERSEY'),('NM','NEW MEXICO'),
                  ('NY','NEW YORK'),('NC','NORTH CAROLINA'),('ND','NORTH DAKOTA'),('OH','OHIO'),('OK','OKLAHOMA'),
                  ('OR','OREGON'),('PA','PENNSYLVANIA'),('PR','PUERTO RICO'),('RI','RHODE ISLAND'),('SC','SOUTH CAROLINA'),
                  ('SD','SOUTH DAKOTA'),('TN','TENNESSEE'),('TX','TEXAS'),('UT','UTAH'),('VT','VERMONT'),('VA','VIRGINIA'),
                  ('WA','WASHINGTON'),('WV','WEST VIRGINIA'),('WI','WISCONSIN'),('WY','WYOMING')
                ) AS us(code, name) ON us.code = wc.worksite_state
               WHERE jb.company_token = w.company_token AND jb.missing_since IS NULL
                 AND (jb.region_code = 'US-' || us.code
                      OR EXISTS (SELECT 1
                                   FROM unnest(string_to_array(COALESCE(jb.location, ''), ',')) WITH ORDINALITY AS s(part, i)
                                  WHERE s.i > 1
                                    AND upper(regexp_replace(btrim(s.part), '\s+\d{5}(-\d{4})?$', '')) IN (us.code, us.name)))
            )
          END
$gate$;
BEGIN
  IF position('lca_refused_tokens' IN v_def) > 0 THEN
    RAISE NOTICE 'get_employer_lca_wages already refuses the ledger and reads blank-country boards';
  ELSIF position(v_gate IN v_def) = 0 THEN
    RAISE EXCEPTION 'get_employer_lca_wages: the US-posting gate is not in the live definition; it drifted -- refusing to rewrite it';
  ELSE
    EXECUTE replace(v_def, v_gate, v_new);
  END IF;
END
$mig$;

DO $verify$
DECLARE
  v_def text := pg_get_functiondef('public.get_employer_lca_wages(text[], text, text)'::regprocedure);
  v_n   int;
BEGIN
  IF position('lca_refused_tokens' IN v_def) = 0 OR position('region_code' IN v_def) = 0 THEN
    RAISE EXCEPTION 'get_employer_lca_wages does not refuse the ledger or read a blank-country board''s place';
  END IF;
  IF position('jp.country = ''US''' IN v_def) = 0 THEN
    RAISE EXCEPTION 'get_employer_lca_wages lost its US-posting arm';
  END IF;
  IF NOT has_function_privilege('anon', 'public.get_employer_lca_wages(text[], text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'get_employer_lca_wages lost its anon grant';
  END IF;
  IF has_table_privilege('anon', 'public.lca_refused_tokens', 'SELECT')
     OR has_table_privilege('authenticated', 'public.lca_refused_tokens', 'SELECT')
     OR has_table_privilege('anon', 'public.lca_refused_tokens', 'INSERT')
     OR has_table_privilege('authenticated', 'public.lca_refused_tokens', 'INSERT') THEN
    RAISE EXCEPTION 'lca_refused_tokens is readable or writable by a caller other than service_role';
  END IF;
  SELECT count(*) INTO v_n FROM public.lca_refused_tokens
   WHERE company_token IN ('socialfinance', 'sigmasoftware2', 'ebb9e98a-78f1-47eb-a562-c52b36b09dd3', '32d78507-2175-47fb-8427-a89a691203be');
  IF v_n <> 4 THEN
    RAISE EXCEPTION 'lca_refused_tokens holds % of the four ledger tokens', v_n;
  END IF;
  SELECT count(*) INTO v_n FROM public.oflc_lca_wages w
   WHERE w.company_token IN (SELECT rt.company_token FROM public.lca_refused_tokens rt)
      OR w.company_token IN ('echo', 'lockwood', 'roadrunner', 'sunday');
  IF v_n <> 0 THEN
    RAISE EXCEPTION '% refused or twin-vendor wage cells are still loaded', v_n;
  END IF;
END
$verify$;
