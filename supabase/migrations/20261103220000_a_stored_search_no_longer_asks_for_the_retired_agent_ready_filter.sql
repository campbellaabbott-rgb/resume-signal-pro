-- A STORED SEARCH NO LONGER ASKS FOR THE RETIRED AGENT-READY FILTER (audit-rest
-- S13-118).
--
-- The board's "agent-ready" filter narrowed a search to the four vendors the
-- apply agent could send to. The agent is retired and the page has no such
-- control, but job-board kept honouring the flag, so a search someone saved
-- while it existed kept returning a fraction of the board in their digest, and
-- nothing on any page could show them why or switch it off.
--
-- job-board .101 ignores the flag and names it in ignoredFilters. This file
-- removes it from the stored searches, so no digest and no later reader meets
-- it. The contract the digest sender relies on: after this file no row carries
-- the key.
--
-- Touches that one key and nothing else: not the search's name (a search named
-- "agent-ready" keeps its name, it is the owner's), not last_seen_at (so it
-- does not read as a search with something new to mail), not another key.
-- Only an object is edited: on a jsonb array, the same operators would match
-- and remove an array element of that spelling.
--
-- APPLY ORDER: any. Safe to re-run: a second run finds no row to change.
DO $$
DECLARE
  v_changed bigint;
  v_left bigint;
BEGIN
  IF to_regclass('public.user_job_searches') IS NULL THEN
    RAISE NOTICE 'public.user_job_searches is not here; nothing to strip';
    RETURN;
  END IF;

  UPDATE public.user_job_searches s
     SET params = s.params - 'sendableOnly'
   WHERE jsonb_typeof(s.params) = 'object'
     AND s.params ? 'sendableOnly';
  GET DIAGNOSTICS v_changed = ROW_COUNT;

  SELECT count(*) INTO v_left
    FROM public.user_job_searches s
   WHERE jsonb_typeof(s.params) = 'object'
     AND s.params ? 'sendableOnly';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'S13-118: % stored searches still carry the retired filter', v_left;
  END IF;

  RAISE NOTICE 'S13-118: the retired filter was removed from % stored searches', v_changed;
END $$;
