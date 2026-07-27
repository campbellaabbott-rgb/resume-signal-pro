INSERT INTO public.company_name_overrides (slug, display_name)
VALUES ('drivenbrands', 'Driven Brands')
ON CONFLICT (slug) DO UPDATE SET display_name = 'Driven Brands';

UPDATE public.job_board_postings          SET company = 'Driven Brands' WHERE company_token = 'drivenbrands~wd1~DrivenBrandsCareerSite' AND company <> 'Driven Brands';
UPDATE public.job_board_closures          SET company = 'Driven Brands' WHERE company_token = 'drivenbrands~wd1~DrivenBrandsCareerSite' AND company <> 'Driven Brands';
UPDATE public.job_board_company_snapshots SET company = 'Driven Brands' WHERE company_token = 'drivenbrands~wd1~DrivenBrandsCareerSite' AND company <> 'Driven Brands';