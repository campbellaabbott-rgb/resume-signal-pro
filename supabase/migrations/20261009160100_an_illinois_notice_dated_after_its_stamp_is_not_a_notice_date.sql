-- AN ILLINOIS NOTICE DATED AFTER ITS STAMP IS NOT A NOTICE DATE (sweep S8-025).
--
-- Illinois lists "Notification Date(s)" newest first ("8/10/2026, 5/1/2026"),
-- and layoff-filings took the FIRST date as the notice. So UnityPoint's May
-- notice was stored as event_date 2026-08-10 under warn_notice_date ("dated
-- 2026-08-10 ... listed on 2026-05-01"), kept past the 90-day window, and,
-- because the notice date is part of the dedupe key, every date Illinois
-- appended minted a new active filing_id while the old one stayed active.
-- On 2026-10-08: 37 IL rows with event_date > public_date, 11 of them in the
-- window, 10 of the 11 outside it if dated correctly; T-Mobile's cell already
-- carried a second active id. The same rows fed a NEGATIVE stamp lag into the
-- Ghost Index's published warn_lag_p50_days.
--
-- layoff-filings 2026-10-09.1 reads the earliest date (warn-maps/il.ts) and
-- refuses any notice date later than the state's stamp (warn.ts), so its
-- rows get new, stable ids on the next nightly read. This migration:
--   1. supersedes the misdated rows already stored (every active state_warn
--      row whose notice date is later than its own public stamp -- by
--      construction no correct row is), so they stop printing and stop
--      counting; the next read re-creates each notice under its true date.
--      APPLY AFTER layoff-filings 2026-10-09.1 serves: an older build would
--      re-upsert the same ids as active on its next read.
--   2. makes the published stamp lag count active notices only, and never a
--      notice dated after its stamp (catalogue rewrite of
--      refresh_layoff_partition, one anchor, refused if the live body drifted).
--
-- Self-verifying, safe to re-run.

SET LOCAL statement_timeout = '2min';

UPDATE public.layoff_filings
   SET status = 'superseded'
 WHERE source = 'state_warn'
   AND status = 'active'
   AND event_basis = 'warn_notice_date'
   AND event_date > public_date;

DO $mig$
DECLARE
  v_def    text := pg_get_functiondef('public.refresh_layoff_partition()'::regprocedure);
  v_anchor text := E'     AND f.event_basis = ''warn_notice_date''\n     AND f.event_date >= current_date - 90;';
  v_new    text := E'     AND f.event_basis = ''warn_notice_date''\n     AND f.status = ''active''\n     AND f.event_date <= f.public_date\n     AND f.event_date >= current_date - 90;';
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RAISE NOTICE 'refresh_layoff_partition already counts only active, correctly dated notices in the stamp lag';
  ELSIF position(v_anchor IN v_def) = 0 THEN
    RAISE EXCEPTION 'refresh_layoff_partition: the stamp-lag anchor is not in the live definition; it drifted -- refusing to rewrite it';
  ELSE
    EXECUTE replace(v_def, v_anchor, v_new);
  END IF;
END
$mig$;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.layoff_filings
     WHERE source = 'state_warn' AND status = 'active'
       AND event_basis = 'warn_notice_date' AND event_date > public_date
  ) THEN
    RAISE EXCEPTION 'an active WARN notice is still dated after its own stamp';
  END IF;
  IF position('AND f.event_date <= f.public_date' IN pg_get_functiondef('public.refresh_layoff_partition()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the published stamp lag still admits a notice dated after its stamp';
  END IF;
END
$verify$;
