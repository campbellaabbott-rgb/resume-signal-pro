-- Company-name overrides for ANY vendor, and the BDO member-firm fix.
--
-- WHY: the override trigger only fired for Workday tokens ('%~wd%'), matching on
-- the token's first segment. Oracle Recruiting Cloud tokens look like
-- 'ebqb~us2~CX_1' — no '~wd' — so an ORC board's display name could only be
-- changed by editing sources.ts and redeploying the edge function. That made a
-- live data defect hostage to a deploy: the ORC tenant ebqb is BDO USA, but it
-- is ingesting as plain "BDO" and therefore MERGING with three other BDO member
-- firms already on the board (BDO4 on SmartRecruiters, bdoau, bdozambia). BDO is
-- a network of legally separate firms, so that single name silently combines
-- four employers into one company page, one open-roles count, and one
-- Hiring-Health score.
--
-- FIX: the trigger now also honours an EXACT full-token override, which works
-- for every vendor and cannot collide (a full token is unique), while leaving
-- the existing Workday slug behaviour untouched. Adding or correcting a name is
-- then one INSERT — no function redeploy — which is the same property the
-- Workday override table was built for.

CREATE OR REPLACE FUNCTION public.apply_company_name_override()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE ov text;
BEGIN
  -- 1. Exact full-token override: unambiguous, any vendor.
  SELECT display_name INTO ov FROM public.company_name_overrides
   WHERE slug = NEW.company_token;
  -- 2. Workday slug override (unchanged): tenant is the token's first segment.
  IF ov IS NULL AND NEW.company_token LIKE '%~wd%' THEN
    SELECT display_name INTO ov FROM public.company_name_overrides
     WHERE slug = split_part(NEW.company_token, '~', 1);
  END IF;
  IF ov IS NOT NULL THEN NEW.company := ov; END IF;
  RETURN NEW;
END;
$$;

-- The ORC tenant's postings are 100% US (sampled 60/60: "Tax Manager, Private
-- Client & Family Office Services", "Transaction Advisory Senior Manager"),
-- which grounds "BDO USA" as its name rather than the bare network brand.
INSERT INTO public.company_name_overrides (slug, display_name) VALUES
  ('ebqb~us2~CX_1', 'BDO USA')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

-- Repair rows already ingested under the merged name.
UPDATE public.job_board_postings p SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE p.company_token = o.slug AND p.company <> o.display_name;
UPDATE public.job_board_closures c SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE c.company_token = o.slug AND c.company <> o.display_name;
UPDATE public.job_board_company_snapshots s SET company = o.display_name
  FROM public.company_name_overrides o
 WHERE s.company_token = o.slug AND s.company <> o.display_name;

DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'explore cache refresh deferred to the next scheduled run: %', SQLERRM;
END $$;
