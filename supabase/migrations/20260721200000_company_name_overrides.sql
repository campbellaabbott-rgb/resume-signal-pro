-- Tokenish display names: the Workday census generator title-cased the FIRST
-- token segment (the host slug) as the company name, so ngc~wd1~Northrop_Grumman
-- shows as "Ngc", wf~wd1~wellsfargojobs as "Wf", abb~wd3~... as "Abb". 4,556 of
-- 23k live companies (~170k postings) carry a slug-shaped name. The real name is
-- authoritative in sources.ts (the refresh upsert writes company = src.name, and
-- an entity self-heal re-applies it), so a raw backfill would be reverted on the
-- next refresh. This override layer sits on the WRITE path instead: a tiny curated
-- map + a BEFORE trigger that re-labels the row every time it's written, so the
-- correction can't be undone by re-ingest and new names can be added with one
-- INSERT — no function redeploy.
--
-- Honest-brand rule for the map: a name is included ONLY when it is grounded —
-- either the token's own tenant path spells it (wellsfargojobs, Northrop_Grumman,
-- caterpillarcareers, Amentum_Careers, ssmhealth, IntermountainCareers) or the
-- slug is the company's unambiguous globally-known initialism-as-name (ABB, GSK,
-- HPE, IQVIA, PVH...). A blind heuristic was rejected: it produced confident-WRONG
-- names (myview->"paradox", boeing->"subsidiary", belk->"Stores"). Slugs we can't
-- ground from the feed are left as-is rather than guessed.

CREATE TABLE IF NOT EXISTS public.company_name_overrides (
  slug text PRIMARY KEY,          -- the token's first "~"-segment (the Workday host slug)
  display_name text NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.company_name_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_name_overrides_public_read" ON public.company_name_overrides;
CREATE POLICY "company_name_overrides_public_read"
  ON public.company_name_overrides FOR SELECT USING (true);

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  -- tenant-path-grounded real names
  ('nvidia','NVIDIA'), ('cat','Caterpillar'), ('wf','Wells Fargo'), ('hyvee','Hy-Vee'),
  ('ngc','Northrop Grumman'), ('pae','Amentum'), ('uhaul','U-Haul'), ('ag','Airbus'),
  ('ccf','Cleveland Clinic'), ('fmr','Fidelity'), ('imh','Intermountain Health'),
  ('sbdinc','Stanley Black & Decker'), ('ssmh','SSM Health'), ('usbank','U.S. Bank'),
  ('td','TD Bank'), ('gehc','GE HealthCare'), ('davita','DaVita'), ('pwc','PwC'),
  ('jj','Johnson & Johnson'), ('att','AT&T'), ('sysco','Sysco'), ('sanofi','Sanofi'),
  ('meijer','Meijer'), ('lithia','Lithia'), ('mango','Mango'), ('asda','Asda'),
  ('pfizer','Pfizer'), ('amcor','Amcor'), ('maersk','Maersk'), ('disney','Disney'),
  ('belron','Belron'), ('roche','Roche'),
  -- unambiguous globally-known initialism-as-name
  ('abb','ABB'), ('bmo','BMO'), ('gdit','GDIT'), ('cibc','CIBC'), ('gsk','GSK'),
  ('hpe','HPE'), ('iqvia','IQVIA'), ('kbr','KBR'), ('pvh','PVH'), ('ppg','PPG'),
  ('rbc','RBC'), ('pnc','PNC'), ('caci','CACI'), ('bbva','BBVA'), ('kla','KLA'),
  ('ing','ING'), ('ocbc','OCBC'), ('relx','RELX'), ('kone','KONE'), ('hp','HP'),
  ('musc','MUSC'), ('vumc','VUMC'), ('jci','JCI'), ('bah','BAH')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

-- Re-label on every write. Gated to Workday tokens ("~wd") so it can never touch
-- Greenhouse/Lever/etc. names, and only looks up when the slug is in the map.
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

-- One-time backfill for immediate effect (bounded: keyed on company_token, only
-- rows whose name actually changes). Row-level UPDATEs — no DDL lock, safe under
-- the live write loop. Closures table too, so hiring-health shows real names.
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
