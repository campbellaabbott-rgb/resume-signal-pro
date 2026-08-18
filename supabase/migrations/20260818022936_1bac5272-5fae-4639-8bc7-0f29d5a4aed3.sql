DROP POLICY IF EXISTS "job_board_closures_public_read" ON public.job_board_closures;
ALTER TABLE public.job_board_closures ENABLE ROW LEVEL SECURITY;