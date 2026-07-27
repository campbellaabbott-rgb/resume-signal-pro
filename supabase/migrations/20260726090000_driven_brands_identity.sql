-- Driven Brands identity (2026-07-26 bug-sweep browser-walk finding): the
-- workday feed name "Drivenbrands" is a title-cased tenant slug, not how the
-- company writes itself (Driven Brands — the car-care franchise group).
-- Same class and same protocol as the Haleon fix: override row FIRST (the
-- enforcement trigger re-stamps company from this table, so a data-only
-- UPDATE would be silently reverted), then the stored rows.
INSERT INTO public.company_name_overrides (slug, display_name)
VALUES ('drivenbrands', 'Driven Brands')
ON CONFLICT (slug) DO UPDATE SET display_name = 'Driven Brands';

UPDATE public.job_board_postings          SET company = 'Driven Brands' WHERE company_token = 'drivenbrands~wd1~DrivenBrandsCareerSite' AND company <> 'Driven Brands';
UPDATE public.job_board_closures          SET company = 'Driven Brands' WHERE company_token = 'drivenbrands~wd1~DrivenBrandsCareerSite' AND company <> 'Driven Brands';
UPDATE public.job_board_company_snapshots SET company = 'Driven Brands' WHERE company_token = 'drivenbrands~wd1~DrivenBrandsCareerSite' AND company <> 'Driven Brands';
