-- Salary sort ranked raw numbers across currencies, so ₹2,000,000/yr (~$24k)
-- outranked a $300k USD role the moment the sort went live. Displayed salaries
-- stay exactly as the posting states them — this column exists ONLY to order
-- results, using deliberately approximate FX factors (ordering needs magnitude,
-- not precision; a stale rate reorders neighbors, it never changes a shown
-- number). Postings whose currency we can't identify get a NULL rank: they
-- stay listed, sorted after ranked ones — unlabeled is honest, mislabeled isn't.
ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS salary_rank_usd numeric
GENERATED ALWAYS AS (
  salary_min_annual * CASE salary_currency
    WHEN 'USD' THEN 1.0
    WHEN 'EUR' THEN 1.08
    WHEN 'GBP' THEN 1.27
    WHEN 'CAD' THEN 0.73
    WHEN 'AUD' THEN 0.66
    WHEN 'NZD' THEN 0.61
    WHEN 'CHF' THEN 1.12
    WHEN 'SEK' THEN 0.095
    WHEN 'DKK' THEN 0.145
    WHEN 'NOK' THEN 0.094
    WHEN 'PLN' THEN 0.25
    WHEN 'INR' THEN 0.012
    WHEN 'SGD' THEN 0.74
    WHEN 'JPY' THEN 0.0066
    WHEN 'BRL' THEN 0.18
    WHEN 'MXN' THEN 0.055
    WHEN 'PHP' THEN 0.017
    ELSE NULL
  END
) STORED;

CREATE INDEX IF NOT EXISTS job_board_postings_salary_rank_idx
  ON public.job_board_postings (salary_rank_usd DESC)
  WHERE salary_rank_usd IS NOT NULL;
