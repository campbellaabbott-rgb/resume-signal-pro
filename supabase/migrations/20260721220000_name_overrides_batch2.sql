-- Name overrides, batch 2: the rebuilt genuine-fills list surfaced more
-- slug-cased Workday names ("Astrazeneca", "Msd", "Fourseasons", "Cvshealth").
-- Same honesty bar as batch 1 (20260721200000): every name here is grounded in
-- the token itself — the slug is the company's own name run together
-- (astrazeneca, fourseasons, dollartree...) or its real initialism brand (MSD is
-- Merck's ex-US trading name), or the tenant path spells it (abglobal →
-- AllianceBernstein via alliancebernsteincareers). Ungroundable slugs (aah,
-- sggovterp, wustl...) stay as-is — never guessed. The existing ~wd-gated
-- trigger + this backfill make it durable and immediate.

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('astrazeneca','AstraZeneca'),
  ('fourseasons','Four Seasons'),
  ('trinityhealth','Trinity Health'),
  ('cvshealth','CVS Health'),
  ('dickssportinggoods','Dick''s Sporting Goods'),
  ('freseniusmedicalcare','Fresenius Medical Care'),
  ('dollartree','Dollar Tree'),
  ('msd','MSD'),
  ('acehardware','Ace Hardware'),
  ('adventisthealthcare','Adventist HealthCare'),
  ('lifespacecommunities','Lifespace Communities'),
  ('abglobal','AllianceBernstein')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

-- Same bounded row-level backfill as batch 1 (no DDL locks).
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

-- Snapshots carry a display name too (feeds "Just added") — keep it consistent.
UPDATE public.job_board_company_snapshots s
   SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE s.company_token LIKE '%~wd%'
   AND split_part(s.company_token, '~', 1) = o.slug
   AND s.company <> o.display_name;

-- Rebuild the explore cache so the cached hiring rows show the corrected names.
DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
