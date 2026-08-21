SELECT cron.schedule(
  'oneshot_title_simple_fts_idx',
  '* * * * *',
  $$
  DO $do$
  BEGIN
    PERFORM set_config('statement_timeout','0',false);
    IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'job_board_postings_title_simple_fts_idx') THEN
      EXECUTE 'CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_title_simple_fts_idx ON public.job_board_postings USING gin (to_tsvector(''simple'', title))';
    END IF;
    PERFORM cron.unschedule('oneshot_title_simple_fts_idx');
  END
  $do$;
  $$
);