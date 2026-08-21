DROP POLICY IF EXISTS "job_board_company_snapshots_public_read" ON public.job_board_company_snapshots;
REVOKE SELECT ON public.job_board_company_snapshots FROM anon;
ALTER TABLE public.job_board_company_snapshots ENABLE ROW LEVEL SECURITY;