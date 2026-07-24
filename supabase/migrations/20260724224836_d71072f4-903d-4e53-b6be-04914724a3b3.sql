CREATE OR REPLACE FUNCTION public.apply_company_name_override()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE ov text;
BEGIN
  SELECT display_name INTO ov FROM public.company_name_overrides
   WHERE slug = NEW.company_token;
  IF ov IS NULL AND NEW.company_token LIKE '%~wd%' THEN
    SELECT display_name INTO ov FROM public.company_name_overrides
     WHERE slug = split_part(NEW.company_token, '~', 1);
  END IF;
  IF ov IS NOT NULL THEN NEW.company := ov; END IF;
  RETURN NEW;
END;
$$;

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('ebqb~us2~CX_1', 'BDO USA')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

UPDATE public.job_board_postings p SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE p.company_token = o.slug AND p.company <> o.display_name;

UPDATE public.job_board_closures c SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE c.company_token = o.slug AND c.company <> o.display_name;

UPDATE public.job_board_company_snapshots s SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE s.company_token = o.slug AND s.company <> o.display_name;