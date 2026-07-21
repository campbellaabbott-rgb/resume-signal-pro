-- Post-deploy sweep. (1) The old function bundle logged a handful of windowed-
-- board closures in its final pass between the 20260721230000 purge (13:01Z)
-- and the new bundle taking over (~13:05Z) — e.g. 2 Caterpillar rows at
-- 13:03Z, posted_at pinned at the window edge. Re-run the same purge; it is
-- idempotent and catches exactly these stragglers. Verified live: all probed
-- windowed boards log ZERO closures under the new bundle, so this cannot
-- recur. (2) Name overrides batch 3: two more slug-grounded names surfaced by
-- the rebuilt fills list (blueorigin spells Blue Origin; AEP is American
-- Electric Power's real ticker/brand initialism). gsknch is left as-is —
-- its real entity (GSK vs former consumer arm) is not groundable from the
-- token alone.

DELETE FROM public.job_board_closures
WHERE company_token IN (
  SELECT company_token
  FROM public.job_board_postings
  WHERE company_token LIKE '%~wd%'
  GROUP BY company_token
  HAVING count(*) >= 450
);

INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('blueorigin','Blue Origin'),
  ('aep','AEP')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

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

UPDATE public.job_board_company_snapshots s
   SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE s.company_token LIKE '%~wd%'
   AND split_part(s.company_token, '~', 1) = o.slug
   AND s.company <> o.display_name;

DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
