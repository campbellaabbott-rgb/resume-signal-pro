ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS salary text;
NOTIFY pgrst, 'reload schema';