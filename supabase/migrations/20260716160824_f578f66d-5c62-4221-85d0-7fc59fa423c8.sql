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