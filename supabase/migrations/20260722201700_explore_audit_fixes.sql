-- Explore accuracy audit fixes (live-audited 2026-07-22, every section).
-- Five boards confirmed by sampling their own postings as staffing/gig/agent
-- recruitment — excluded from positive showcases (still searchable):
--   kimmel-associates:  executive search firm (client placements: "General
--                       Manager-Restoration Construction" across cities)
--   temporing:          Spanish temp agency (warehouse/dishwasher gigs)
--   qodeworld:          recruitment platform (client roles across countries)
--   nachhilfeunterricht: tutoring gig marketplace ("X Tutor | Flexible Hours")
--   horacemannagents:   mass commission-agent recruitment (328x "Insurance
--                       Agent - <city>")
INSERT INTO public.showcase_excluded (company_token, reason) VALUES
  ('kimmel-associates', 'executive search firm - client placements (sampled 2026-07-22)'),
  ('temporing', 'temp staffing agency - gig placements (sampled 2026-07-22)'),
  ('qodeworld', 'recruitment platform - client placements (sampled 2026-07-22)'),
  ('nachhilfeunterricht', 'tutoring gig marketplace - platform slots, not corporate hiring (sampled 2026-07-22)'),
  ('horacemannagents', 'mass commission-agent recruitment board (sampled 2026-07-22)')
ON CONFLICT (company_token) DO UPDATE SET reason = EXCLUDED.reason;

-- "Cc" -> Chanel: feed-grounded (the token's own tenant path spells it:
-- cc~wd3~ChanelCareers). Override + trigger handle future writes; backfill
-- makes it immediate across all three tables.
INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('cc', 'Chanel')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;

UPDATE public.job_board_postings p SET company = 'Chanel'
 WHERE split_part(p.company_token,'~',1) = 'cc' AND p.company <> 'Chanel';
UPDATE public.job_board_closures c SET company = 'Chanel'
 WHERE split_part(c.company_token,'~',1) = 'cc' AND c.company <> 'Chanel';
UPDATE public.job_board_company_snapshots s SET company = 'Chanel'
 WHERE split_part(s.company_token,'~',1) = 'cc' AND s.company <> 'Chanel';

-- BJAK (ashby token bjakcareer, no ~wd so the override trigger doesn't apply):
-- display authority is sources.ts, renamed to "BJAK" in the same ship; this
-- backfill makes existing rows match immediately instead of waiting for the
-- next refresh pass to re-upsert them.
UPDATE public.job_board_postings p SET company = 'BJAK'
 WHERE p.company_token = 'bjakcareer' AND p.company <> 'BJAK';
UPDATE public.job_board_closures c SET company = 'BJAK'
 WHERE c.company_token = 'bjakcareer' AND c.company <> 'BJAK';
UPDATE public.job_board_company_snapshots s SET company = 'BJAK'
 WHERE s.company_token = 'bjakcareer' AND s.company <> 'BJAK';

DO $$
BEGIN
  SET LOCAL statement_timeout = '55s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

NOTIFY pgrst, 'reload schema';
