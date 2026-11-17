-- lovable-cron-fallback-reviewed: no cron; this file schedules nothing (reviewed 2026-11-16 in the bug round A integration).
--
-- THE WEEKLY-TIPS ADDRESSES ARE DELETED, AND NONE IS KEPT AGAIN (S14X-101,
-- the owner's answer 'remove' of 2026-11-15, which approved this purge).
--
-- WHAT WAS WRONG. public.free_scan_leads holds the addresses the free
-- report's weekly-tips box posted to save-lead, and the address
-- send-scan-report copied in beside every report mail. Nothing mailed,
-- confirmed or expired them: no job reads the table, and no tips were ever
-- sent. The round removed the box (FreeKeywordResults.tsx), but the rows
-- already held stayed, and save_free_scan_lead still added a row for anyone
-- who reached it: a tab still running the old page, a script, or
-- send-scan-report on every report mail.
--
-- WHAT THIS CHANGES.
--   1. save_free_scan_lead keeps its name, arguments, return type, owner
--      rights and grants, so a function still calling it is answered as
--      before, but it stores nothing and answers false. save-lead and
--      send-scan-report 2026-11-12.1 no longer call it; until they serve,
--      their calls keep nothing.
--   2. Every row of public.free_scan_leads is deleted. The table stays,
--      empty: the account export and the account deletion still read it.
--
-- Safe to re-run: the function is replaced with the same text and an empty
-- table has nothing to delete. Self-verifying: the function must hold no
-- INSERT, and the table must be empty.

SET LOCAL statement_timeout = '2min';

-- 1. The writer keeps nothing.
CREATE OR REPLACE FUNCTION public.save_free_scan_lead(p_email text, p_industry text DEFAULT NULL::text, p_ats_score integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- S14X-101 'remove': no address is kept, so the arguments are not read.
  RETURN false;
END;
$function$;

-- 2. The addresses already held.
DELETE FROM public.free_scan_leads;

-- Self-verifying.
DO $verify$
DECLARE
  v_left bigint;
  v_src  text;
BEGIN
  SELECT count(*) INTO v_left FROM public.free_scan_leads;
  IF v_left > 0 THEN
    RAISE EXCEPTION 'self-check: % free_scan_leads row(s) are left', v_left;
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_proc p
   WHERE p.oid = 'public.save_free_scan_lead(text,text,integer)'::regprocedure;
  IF v_src ~* 'insert[[:space:]]+into' THEN
    RAISE EXCEPTION 'self-check: save_free_scan_lead still stores an address';
  END IF;
  RAISE NOTICE 'self-verify 20261112103000: free_scan_leads is empty and save_free_scan_lead keeps nothing';
END
$verify$;
