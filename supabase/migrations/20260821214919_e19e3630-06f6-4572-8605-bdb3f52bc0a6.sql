SELECT cron.schedule(
  'oneshot_company_simple_fts_idx',
  '* * * * *',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_company_simple_fts_idx ON public.job_board_postings USING gin (to_tsvector(''simple'', company))'
);