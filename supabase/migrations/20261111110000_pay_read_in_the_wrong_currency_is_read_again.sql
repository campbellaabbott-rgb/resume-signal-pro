-- PAY READ IN THE WRONG CURRENCY IS READ AGAIN.
--
-- Board .102, VF-BMS. A row's pay is parsed under the country the row had
-- when its salary was read. When a later sweep moved the row's place to the
-- United States, a bare '$' figure read earlier under a Canadian place kept
-- salary_currency 'CAD' (Bristol Myers Squibb, New Brunswick NJ, read as New
-- Brunswick, Canada, among them). job-board .102 re-reads the pay whenever a
-- sweep moves the country; this file heals the rows already stored that way.
--
-- THE ROWS: country 'US', salary_currency 'CAD', a salary text that starts
-- with '$', and names no Canadian marker (cad, c$, ca$, can$, canad). For a
-- bare '$' figure in the United States the parser answers USD, so the heal
-- sets exactly what a re-read would: salary_currency 'USD'. The annual
-- figures are the same number in either currency and stay as they are.
-- salary_rank_usd is a generated column on main (20260716180000); where the
-- live table holds it as a plain column, it is set in the same UPDATE from the
-- generated expression's USD arm (salary_min_annual * 1.0).
--
-- It COUNTS FIRST and prints the count and the ten tokens with the most rows.
-- Above 5,000 rows it raises and changes nothing: the class seen on
-- 2026-11-14 is a handful of rows, and a larger match means the rule is not
-- the rule this file was written for.
--
-- Chosen over a SALARY_PARSE_VERSION bump, which would re-sweep about 178k
-- rows. The UPDATE touches no description, so the description-embed trigger
-- (AFTER UPDATE OF description) does not fire.
--
-- ORDER: after fn:job-board@2026-09-09.102, so no sweep running the old code
-- writes a new row of this class behind it.
--
-- Re-runnable: a second run matches zero rows and changes nothing.

DO $$
DECLARE
  n bigint;
  top text;
  plain_rank boolean;
BEGIN
  SELECT count(*) INTO n
    FROM public.job_board_postings
   WHERE country = 'US' AND salary_currency = 'CAD'
     AND ltrim(salary) LIKE '$%'
     AND lower(salary) !~ '(cad|c\$|ca\$|can\$|canad)';
  SELECT string_agg(company_token || ' ' || c, ', ' ORDER BY c DESC, company_token) INTO top
    FROM (SELECT company_token, count(*) AS c
            FROM public.job_board_postings
           WHERE country = 'US' AND salary_currency = 'CAD'
             AND ltrim(salary) LIKE '$%'
             AND lower(salary) !~ '(cad|c\$|ca\$|can\$|canad)'
           GROUP BY company_token
           ORDER BY count(*) DESC, company_token
           LIMIT 10) t;
  RAISE NOTICE '20261111110000: % row(s) read in CAD under a US place; top tokens: %', n, COALESCE(top, 'none');
  IF n > 5000 THEN
    RAISE EXCEPTION '20261111110000: % rows match, more than the 5,000 this heal was written for; nothing was changed', n;
  END IF;
  IF n = 0 THEN
    RETURN;
  END IF;

  plain_rank := EXISTS (SELECT 1 FROM information_schema.columns
                         WHERE table_schema = 'public' AND table_name = 'job_board_postings'
                           AND column_name = 'salary_rank_usd' AND is_generated = 'NEVER');
  IF plain_rank THEN
    UPDATE public.job_board_postings
       SET salary_currency = 'USD', salary_rank_usd = salary_min_annual * 1.0
     WHERE country = 'US' AND salary_currency = 'CAD'
       AND ltrim(salary) LIKE '$%'
       AND lower(salary) !~ '(cad|c\$|ca\$|can\$|canad)';
  ELSE
    UPDATE public.job_board_postings
       SET salary_currency = 'USD'
     WHERE country = 'US' AND salary_currency = 'CAD'
       AND ltrim(salary) LIKE '$%'
       AND lower(salary) !~ '(cad|c\$|ca\$|can\$|canad)';
  END IF;
END $$;

-- Self-check: no row of the class is left.
DO $$
DECLARE
  n bigint;
BEGIN
  SELECT count(*) INTO n
    FROM public.job_board_postings
   WHERE country = 'US' AND salary_currency = 'CAD'
     AND ltrim(salary) LIKE '$%'
     AND lower(salary) !~ '(cad|c\$|ca\$|can\$|canad)';
  IF n <> 0 THEN
    RAISE EXCEPTION '20261111110000: % row(s) still read in CAD under a US place', n;
  END IF;
END $$;
