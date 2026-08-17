DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'job_board_postings_undated_draw_idx'
  ) THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-undated-draw-idx') THEN
      PERFORM cron.unschedule('oneshot-undated-draw-idx');
      RAISE NOTICE 'unscheduled oneshot-undated-draw-idx (index present)';
    END IF;
  ELSE
    RAISE NOTICE 'index job_board_postings_undated_draw_idx ABSENT — leaving the cron in place to keep retrying';
  END IF;
END $$;