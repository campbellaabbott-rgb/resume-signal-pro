SET LOCAL statement_timeout = '30min';
CREATE INDEX IF NOT EXISTS job_board_postings_company_token_idx ON public.job_board_postings (company_token);
CREATE INDEX IF NOT EXISTS job_board_postings_source_posted_idx ON public.job_board_postings (source, posted_at);