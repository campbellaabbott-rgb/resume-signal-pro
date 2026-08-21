SELECT cron.unschedule('oneshot_title_simple_fts_idx');
SELECT cron.schedule(
  'oneshot_title_simple_fts_idx',
  '* * * * *',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_title_simple_fts_idx ON public.job_board_postings USING gin (to_tsvector(''simple'', title))'
);