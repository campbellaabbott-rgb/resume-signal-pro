-- Migration 1: company snapshots net-new trending
CREATE TABLE IF NOT EXISTS public.job_board_company_snapshots (
  company_token text NOT NULL,
  snapshot_date date NOT NULL,
  company text NOT NULL DEFAULT '',
  open_roles integer NOT NULL DEFAULT 0,
  PRIMARY KEY (company_token, snapshot_date)
);
CREATE INDEX IF NOT EXISTS job_board_company_snapshots_date_idx
  ON public.job_board_company_snapshots (snapshot_date);

ALTER TABLE public.job_board_company_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "job_board_company_snapshots_public_read" ON public.job_board_company_snapshots;
CREATE POLICY "job_board_company_snapshots_public_read"
  ON public.job_board_company_snapshots FOR SELECT USING (true);
GRANT SELECT ON public.job_board_company_snapshots TO anon, authenticated;
GRANT ALL ON public.job_board_company_snapshots TO service_role;

CREATE OR REPLACE FUNCTION public.snapshot_company_counts()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
SET statement_timeout = '90s'
AS $$
BEGIN
  INSERT INTO public.job_board_company_snapshots (company_token, snapshot_date, company, open_roles)
  SELECT company_token, current_date, max(company), count(*)::int
  FROM public.job_board_postings
  GROUP BY company_token
  ON CONFLICT (company_token, snapshot_date)
  DO UPDATE SET open_roles = EXCLUDED.open_roles, company = EXCLUDED.company;
END;
$$;
REVOKE ALL ON FUNCTION public.snapshot_company_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_company_counts() TO service_role;

CREATE OR REPLACE FUNCTION public.get_trending_companies(p_limit int DEFAULT 12)
RETURNS TABLE (company text, company_token text, recent bigint, open_roles bigint)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH latest AS (
    SELECT max(snapshot_date) AS d FROM public.job_board_company_snapshots
  ),
  baseline AS (
    SELECT min(snapshot_date) AS d
    FROM public.job_board_company_snapshots
    WHERE snapshot_date >= (SELECT d FROM latest) - 7
      AND snapshot_date <  (SELECT d FROM latest)
  )
  SELECT n.company,
         n.company_token,
         (n.open_roles - b.open_roles)::bigint AS recent,
         n.open_roles::bigint                  AS open_roles
  FROM public.job_board_company_snapshots n
  JOIN public.job_board_company_snapshots b
    ON b.company_token = n.company_token
   AND b.snapshot_date = (SELECT d FROM baseline)
  WHERE n.snapshot_date = (SELECT d FROM latest)
    AND (n.open_roles - b.open_roles) >= 3
  ORDER BY recent DESC, n.open_roles DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION public.get_trending_companies(int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.refresh_explore_cache()
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE payload jsonb;
BEGIN
  payload := jsonb_build_object(
    'trending', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb)
                 FROM public.get_trending_companies(12) x),
    'newest', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM (
        SELECT max(company) AS company, company_token, count(*) AS open_roles, min(first_seen) AS first_added
        FROM public.job_board_postings
        GROUP BY company_token
        HAVING min(first_seen) >= now() - interval '14 days' AND count(*) >= 3
        ORDER BY min(first_seen) DESC, count(*) DESC
        LIMIT 12) x),
    'entry',  (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_entry_level_companies(12) x),
    'hiring', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_actively_hiring_companies(12) x),
    'salary', (SELECT coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) FROM public.get_salary_benchmarks() x),
    'computed_at', now()
  );
  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('explore_cache', payload, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'snapshot-company-counts') THEN
      PERFORM cron.schedule('snapshot-company-counts', '30 2 * * *',
        'SELECT public.snapshot_company_counts();');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'company-snapshots-retention') THEN
      PERFORM cron.schedule('company-snapshots-retention', '40 2 * * *',
        $job$ DELETE FROM public.job_board_company_snapshots WHERE snapshot_date < current_date - 35; $job$);
    END IF;
  END IF;
END $$;

DO $$
BEGIN
  SET LOCAL statement_timeout = '90s';
  PERFORM public.snapshot_company_counts();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Migration 2: company name overrides (Workday slug relabeling)
CREATE TABLE IF NOT EXISTS public.company_name_overrides (
  slug text PRIMARY KEY,
  display_name text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_name_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_name_overrides_public_read" ON public.company_name_overrides;
CREATE POLICY "company_name_overrides_public_read"
  ON public.company_name_overrides FOR SELECT USING (true);
GRANT SELECT ON public.company_name_overrides TO anon, authenticated;
GRANT ALL ON public.company_name_overrides TO service_role;

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('nvidia','NVIDIA'), ('cat','Caterpillar'), ('wf','Wells Fargo'), ('hyvee','Hy-Vee'),
  ('ngc','Northrop Grumman'), ('pae','Amentum'), ('uhaul','U-Haul'), ('ag','Airbus'),
  ('ccf','Cleveland Clinic'), ('fmr','Fidelity'), ('imh','Intermountain Health'),
  ('sbdinc','Stanley Black & Decker'), ('ssmh','SSM Health'), ('usbank','U.S. Bank'),
  ('td','TD Bank'), ('gehc','GE HealthCare'), ('davita','DaVita'), ('pwc','PwC'),
  ('jj','Johnson & Johnson'), ('att','AT&T'), ('sysco','Sysco'), ('sanofi','Sanofi'),
  ('meijer','Meijer'), ('lithia','Lithia'), ('mango','Mango'), ('asda','Asda'),
  ('pfizer','Pfizer'), ('amcor','Amcor'), ('maersk','Maersk'), ('disney','Disney'),
  ('belron','Belron'), ('roche','Roche'),
  ('abb','ABB'), ('bmo','BMO'), ('gdit','GDIT'), ('cibc','CIBC'), ('gsk','GSK'),
  ('hpe','HPE'), ('iqvia','IQVIA'), ('kbr','KBR'), ('pvh','PVH'), ('ppg','PPG'),
  ('rbc','RBC'), ('pnc','PNC'), ('caci','CACI'), ('bbva','BBVA'), ('kla','KLA'),
  ('ing','ING'), ('ocbc','OCBC'), ('relx','RELX'), ('kone','KONE'), ('hp','HP'),
  ('musc','MUSC'), ('vumc','VUMC'), ('jci','JCI'), ('bah','BAH')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

CREATE OR REPLACE FUNCTION public.apply_company_name_override()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE ov text;
BEGIN
  IF NEW.company_token LIKE '%~wd%' THEN
    SELECT display_name INTO ov FROM public.company_name_overrides
     WHERE slug = split_part(NEW.company_token, '~', 1);
    IF ov IS NOT NULL THEN NEW.company := ov; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_name_override ON public.job_board_postings;
CREATE TRIGGER trg_company_name_override
  BEFORE INSERT OR UPDATE ON public.job_board_postings
  FOR EACH ROW EXECUTE FUNCTION public.apply_company_name_override();

UPDATE public.job_board_postings p
   SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE p.company_token LIKE '%~wd%'
   AND split_part(p.company_token, '~', 1) = o.slug
   AND p.company <> o.display_name;

UPDATE public.job_board_closures c
   SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE c.company_token LIKE '%~wd%'
   AND split_part(c.company_token, '~', 1) = o.slug
   AND c.company <> o.display_name;

-- Refresh explore cache once more to reflect updated names
DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;