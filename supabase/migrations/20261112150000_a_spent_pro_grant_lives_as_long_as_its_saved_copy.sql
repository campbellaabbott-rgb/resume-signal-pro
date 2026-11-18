-- lovable-cron-fallback-reviewed: no cron; this file creates or changes no cron schedule; it rewrites only the command of the once-a-day scan-cache-and-telemetry-purge job (reviewed 2026-11-16 in the bug round A integration).
--
-- A SPENT PRO GRANT LIVES AS LONG AS ITS SAVED COPY (S14X-104, M-S14-073).
--
-- WHAT WAS WRONG. 'scan-cache-and-telemetry-purge' (10 4 * * *,
-- 20260704200000 / 20260705162706, rewritten by 20261109131000) deletes every
-- Pro grant 90 days after it was spent. The copy that grant made is saved in
-- purchased_content for a year (expires_at = now() + 365 days), under the
-- reference 'pro_' followed by the grant id. Once the grant was gone:
--   - the link in the purchase mail answered 400 "Invalid session" for a copy
--     that still existed (verify-product-purchase looks the grant up first);
--   - account_erase_personal_data finds a Pro member's saved copies through
--     the grant (pro_grants.user_id), so deleting the account left that copy
--     behind for anyone whose address was not proven.
--
-- WHAT THIS CHANGES. Only the pro_grants delete of the live command: it now
-- skips a grant while an unexpired saved copy names it. The grant row, and
-- with it the account link the eraser reads, lives exactly as long as that
-- copy; a grant with no copy, or whose copy has expired, goes at 90 days as
-- before. account_erase_personal_data is not touched. The other deletes, and
-- the SET statement_timeout that 20261109131000 put in front, are kept as
-- they are; the timeout is added here when that file did not add it.
--
-- The rewrite works on the LIVE command text (two spellings exist, upper and
-- lower case), by pattern, and retypes nothing else. It counts, by NOTICE,
-- the 'pro_' copies already orphaned by the purge (still readable through
-- their address, never through a grant).
--
-- Must apply AFTER 20261109131000, which rewrites the same command. Safe to
-- re-run: a command that already keeps grants with a copy is left alone.

DO $$
DECLARE
  v_id      bigint;
  v_cmd     text;
  v_new     text;
  v_orphans bigint;
BEGIN
  IF to_regclass('public.purchased_content') IS NOT NULL AND to_regclass('public.pro_grants') IS NOT NULL THEN
    SELECT count(*) INTO v_orphans
      FROM public.purchased_content c
     WHERE c.stripe_session_id LIKE 'pro\_%'
       AND (c.expires_at IS NULL OR c.expires_at > now())
       AND NOT EXISTS (SELECT 1 FROM public.pro_grants g WHERE 'pro_' || g.id::text = c.stripe_session_id);
    RAISE NOTICE 'pro_ saved copies whose grant the purge already removed: %', v_orphans;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron is not installed here; there is no nightly purge to rewrite';
    RETURN;
  END IF;
  SELECT j.jobid, j.command INTO v_id, v_cmd FROM cron.job j WHERE j.jobname = 'scan-cache-and-telemetry-purge';
  IF v_id IS NULL THEN
    RAISE NOTICE 'no scan-cache-and-telemetry-purge job here; nothing deletes a grant, nothing to rewrite';
    RETURN;
  END IF;
  IF v_cmd ~* 'purchased_content' THEN
    RAISE NOTICE 'the nightly purge already keeps a grant whose saved copy is live';
    RETURN;
  END IF;

  v_new := regexp_replace(v_cmd,
    $re$(delete[[:space:]]+from[[:space:]]+public\.pro_grants[[:space:]]+where[[:space:]]+consumed_at[[:space:]]+is[[:space:]]+not[[:space:]]+null[[:space:]]+and[[:space:]]+consumed_at[[:space:]]*<[[:space:]]*now\(\)[[:space:]]*-[[:space:]]*interval[[:space:]]*'90 days')[[:space:]]*;$re$,
    $rep$\1 AND NOT EXISTS (SELECT 1 FROM public.purchased_content c WHERE c.stripe_session_id = 'pro_' || pro_grants.id::text AND (c.expires_at IS NULL OR c.expires_at > now()));$rep$,
    'i');
  IF v_new !~* '^[[:space:]]*SET[[:space:]]+statement_timeout' THEN
    v_new := 'SET statement_timeout = ''2min''; ' || btrim(v_new, E' \t\r\n');
  END IF;
  IF v_new IS DISTINCT FROM v_cmd THEN
    PERFORM cron.alter_job(v_id, command => v_new);
  END IF;
END $$;

-- Self-verifying: where the job exists, its command keeps a grant while a
-- live saved copy names it, still deletes spent grants, rate_limits and
-- detection_telemetry rows, and starts with its statement_timeout.
DO $$
DECLARE
  v_cmd text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RETURN;
  END IF;
  SELECT j.command INTO v_cmd FROM cron.job j WHERE j.jobname = 'scan-cache-and-telemetry-purge';
  IF v_cmd IS NULL THEN
    RETURN;
  END IF;
  IF v_cmd !~* 'delete[[:space:]]+from[[:space:]]+public\.pro_grants' THEN
    RAISE EXCEPTION 'self-check: the nightly purge no longer deletes spent grants: %', v_cmd;
  END IF;
  IF v_cmd !~* 'pro_grants[^;]*not[[:space:]]+exists[[:space:]]*\([[:space:]]*select[[:space:]]+1[[:space:]]+from[[:space:]]+public\.purchased_content' THEN
    RAISE EXCEPTION 'self-check: the nightly purge still deletes a grant whose saved copy is live (its pro_grants clause was not the one this file rewrites): %', v_cmd;
  END IF;
  IF v_cmd !~* 'delete[[:space:]]+from[[:space:]]+public\.rate_limits'
     OR v_cmd !~* 'delete[[:space:]]+from[[:space:]]+public\.detection_telemetry' THEN
    RAISE EXCEPTION 'self-check: the nightly purge lost one of the deletes it keeps: %', v_cmd;
  END IF;
  IF v_cmd !~* '^[[:space:]]*SET[[:space:]]+statement_timeout' THEN
    RAISE EXCEPTION 'self-check: the nightly purge sets no statement_timeout: %', v_cmd;
  END IF;
  RAISE NOTICE 'self-verify 20261112150000: a spent grant is purged only once no live saved copy names it';
END $$;
