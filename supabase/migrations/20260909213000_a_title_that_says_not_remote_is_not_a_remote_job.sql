-- THE REMOTE FILTER SERVED ROLES WHOSE OWN TITLE SAYS THEY ARE NOT REMOTE.
--
-- Measured live 2026-09-09 against deployed job-board .67 —
--   POST job-board {"action":"list","q":"non-remote","workMode":"remote"}
--     -> "Application Analyst II-Full Time- Days - Cupid/Radiant- NON-REMOTE" (workday)
--     -> "RN (PRN - Not Remote)"                                             (icims)
--
-- MECHANISM: normalize.ts's detectWorkMode tested a bare \bremote\b with no
-- negation arm. In "NON-REMOTE" the hyphen is a word boundary, so the pattern
-- matched and the row was stored work_mode='remote'. iCIMS reproduced it a
-- second way, reading its own location_type with `lt.includes("remote")`.
-- Both are fixed in the same deploy as this migration: the detector now
-- removes negated-remote phrases before the positive ladder runs, and every
-- vendor arm delegates to it instead of carrying a ladder of its own.
--
-- WHY 20260817210000 DID NOT ALREADY CATCH THESE. That repair required
--   COALESCE(remote,false) = false  AND  title/location contain no remote token
-- — it was aimed at rows tagged remote from a 4,000-character DESCRIPTION,
-- where the title says nothing. These rows are the opposite shape: the remote
-- token IS in the title (that is the whole defect) and the boolean agrees with
-- the enum, because both were computed from the same wrong answer. Every row
-- this file targets passed cleanly through that WHERE clause.
--
-- WHY A REPAIR IS WARRANTED AT ALL. A code fix only reaches a row when that
-- posting is next re-normalised by a feed sweep. A posting the feed drops
-- before its board's next lap is never re-normalised — it keeps the false
-- value until it closes, and it is served under the Remote filter the whole
-- time. The falsehood is on the board today; the fix alone does not take it
-- off.
--
-- WHAT IT TOUCHES, and nothing else: a row currently tagged remote whose own
-- title+location contains a negated-remote phrase AND, once that phrase is
-- removed, contains no remote token at all. That is the new detector's rule
-- transcribed into POSIX (\m..\M are Postgres's word boundaries, and like
-- JavaScript's \b they treat "-" as a boundary, which is precisely why
-- "NON-REMOTE" matched in the first place).
--
-- THE VALUE WRITTEN is what the text states once the negation is removed:
-- hybrid or onsite if the posting says so, otherwise NULL. NULL and not
-- 'onsite' for the bare case: we know it is not remote, we do not know which
-- of the other two it is, and the board's rule is that a posting which does
-- not state a mode is excluded from work-mode filters rather than guessed at.
--
-- ONE ACCEPTED IMPRECISION, stated rather than hidden. A few vendor arms take
-- work_mode from a STRUCTURED field in preference to text, so in principle a
-- row could be here because its ATS field said REMOTE while its title says
-- NON-REMOTE. This file rewrites it anyway. A posting that contradicts itself
-- cannot be published under Remote on the strength of the half a reader
-- cannot see, and NULL is the board's documented answer for "the posting does
-- not say". There is no per-row record of which field produced a stored value,
-- so this cannot be narrowed further in SQL.
--
-- LOCKING. The driving predicate is work_mode = 'remote', which is served by
-- job_board_postings_work_mode_serving_idx / _work_mode_posted_idx rather than
-- a scan of all ~945k rows, and the regex then keeps the matched set tiny.
-- SKIP LOCKED passes over a row the ingest is writing instead of blocking on
-- it, and lock_timeout means this can never queue behind a long writer on a
-- hot table.
--
-- WHAT THE BATCHING DOES AND DOES NOT BOUND, stated exactly. The loop is
-- inside ONE `DO` block, and a DO block is a single top-level statement, so
-- all 100 iterations share the single statement_timeout armed below — the
-- batching bounds how many rows are locked per sub-statement, NOT how long the
-- repair runs. The whole repair has 120 seconds. An earlier draft of this
-- header claimed "no single statement runs long", which is the opposite of
-- true: the DO *is* the single statement. If the match set is larger than the
-- 60s the first draft allowed, the block aborts with 57014, the migration is
-- one transaction so nothing commits, and a re-run repeats the identical work
-- from zero — it could never converge. The timeout is therefore set to 120s
-- and v_max_batches cut to 40 (80,000 rows), a bound that provably fits: if
-- the loop exhausts it, a residue is LEFT, the NOTICE says how much was done,
-- and the deployed code fix absorbs the rest on each board's next lap. A
-- partial repair is a correct outcome here; an aborted transaction is not.
--
-- IDEMPOTENT: a repaired row is no longer work_mode='remote', so it no longer
-- matches. Re-running is a no-op, which is also how any row skipped for being
-- locked gets picked up.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $repair$
DECLARE
  -- The negated-remote phrases, mirroring P_NEGATED_REMOTE in
  -- supabase/functions/job-board/normalize.ts. English is backed by observed
  -- strings; DE/FR/ES/PT/NL are the standard negations of the tokens the
  -- positive pattern already carries, written narrowly (adjacent negator +
  -- token) for exactly that reason.
  v_neg constant text := $re$(\m(non|not|no)[[:space:]-]?remote\M)|(\mnot[[:space:]]+(a[[:space:]]+|an[[:space:]]+|fully[[:space:]]+)?remote\M)|(\mnot[[:space:]]+(eligible|available|open|considered)[[:space:]]+(for|to)[[:space:]]+remote\M)|(\mremote[[:space:]]*[:=(–—-][[:space:]]*(no|none)[[:space:]]*(?=$|[).|,;·/]))|(\m(remote|wfh|work[[:space:]]+from[[:space:]]+home|home[[:space:]]?office)[[:space:]]*[:=–—-]?[[:space:]]*(not[[:space:]]+(available|offered|permitted|an[[:space:]]+option)|unavailable)\M)|(\m(non|not|no)[[:space:]-]?(wfh|work[[:space:]]+from[[:space:]]+home|home[[:space:]]?office)\M)|(\mno[[:space:]]+remote[[:space:]]+(work|option|options|opportunity|opportunities)\M)|(\m(keine|kein|nicht)[[:space:]]+(im[[:space:]]+)?home[[:space:]]?office\M)|(\m(non|sans|aucun)[[:space:]-]?t[ée]l[ée]travail\M)|(\mpas[[:space:]]+de[[:space:]]+t[ée]l[ée]travail\M)|(\mt[ée]l[ée]travail[[:space:]]*[:=(–—-][[:space:]]*non[[:space:]]*(?=$|[).|,;·/]))|(\m(no|n[ãa]o)[[:space:]-]?remoto\M)|(\m(sin|no)[[:space:]]+teletrabajo\M)|(\m(geen|niet)[[:space:]]+thuiswerken\M)$re$;
  -- P_REMOTE, P_HYBRID, P_ONSITE from the same file.
  v_pos constant text := $re$\mremote\M|\mwork from home\M|\mwfh\M|\mt[ée]l[ée]travail\M|\mhome ?office\M|\mremoto\M|\mthuiswerken\M|\mteletrabajo\M$re$;
  v_hyb constant text := $re$\mhybrid\M|\mhybride\M|\mh[íi]brido?\M$re$;
  v_ons constant text := $re$\mon-?site\M|\min-?office\M|\mvor ort\M|\mpresencial\M|\msur site\M$re$;
  -- SAMPLE/BOUND GATES, this file's own constants.
  v_batch        constant integer := 2000;
  v_max_batches  constant integer := 40;    -- 80,000 rows; a bound that fits the 120s budget.
                                            -- Exhausting it LEAVES A RESIDUE on purpose (see header):
                                            -- the deployed code fix clears the rest on the next lap.
  v_done    integer;
  v_total   integer := 0;
  v_i       integer;
BEGIN
  FOR v_i IN 1..v_max_batches LOOP
    WITH doomed AS (
      SELECT p.id,
             regexp_replace(p.title || ' · ' || p.location, v_neg, ' ', 'gi') AS stripped
        FROM public.job_board_postings p
       WHERE p.work_mode = 'remote'
         AND (p.title || ' · ' || p.location) ~* v_neg
         AND regexp_replace(p.title || ' · ' || p.location, v_neg, ' ', 'gi') !~* v_pos
       LIMIT v_batch
         FOR UPDATE SKIP LOCKED
    )
    UPDATE public.job_board_postings t
       SET work_mode = CASE
                         WHEN d.stripped ~* v_hyb THEN 'hybrid'
                         WHEN d.stripped ~* v_ons THEN 'onsite'
                         ELSE NULL
                       END,
           remote = false
      FROM doomed d
     WHERE t.id = d.id;
    GET DIAGNOSTICS v_done = ROW_COUNT;
    v_total := v_total + v_done;
    EXIT WHEN v_done = 0;
  END LOOP;

  RAISE NOTICE 'negated-remote repair: % rows reclassified out of work_mode=remote', v_total;
END
$repair$;

-- The boolean must never outlive the enum it was derived from. THE SAME
-- predicate, byte for byte — not a shortened one; two nearly-identical regexes
-- in one file is how the next drift starts.
--
-- SCOPE, NARROWED HONESTLY. An earlier draft of this comment said this block
-- covers "any row the earlier drift left with remote=true while work_mode said
-- something else". It does not, and the predicate below is the proof: it also
-- requires a NEGATED phrase in title+location. The boolean/trinary drift this
-- deploy removes at write time came mostly from POSITIVE remote text —
-- pre-fix smartrecruiters/recruitee/rippling could store work_mode='hybrid'
-- with remote=true from a "Remote" token in the title and no negation
-- anywhere. Those rows match NEITHER block here and clear only when their
-- board is next re-normalised by the fixed bundle.
--
-- WHY THIS FILE DOES NOT ALSO SWEEP THEM. The general correction would be
-- `remote = true AND work_mode IS DISTINCT FROM 'remote' -> remote = false`,
-- with no regex. It is very likely right, and it is deliberately NOT run here:
-- its population cannot be measured from this machine (no service key, no live
-- probing), it would rewrite rows on a predicate this build has no count for,
-- and remote=true with work_mode NULL may still hold rows flagged from a
-- DESCRIPTION by an older enrichment path, which that sweep would silently
-- unflag. Prefer silence to a guess: the write-time invariant plus one
-- rotation converges it, and a later build that can COUNT the population first
-- may sweep the remainder.
--
-- CONSEQUENCE FOR VERIFICATION, so a non-zero reading is not misread as a
-- failed deploy: `SELECT count(*) FROM job_board_postings WHERE remote <>
-- (work_mode = 'remote')` will NOT be 0 immediately after this migration. It
-- should fall monotonically over a rotation and reach 0; that trend, not the
-- first reading, is the check.
--
-- Narrow by construction and idempotent: a repaired row has remote=false and
-- stops matching.
DO $bool$
DECLARE
  v_neg constant text := $re$(\m(non|not|no)[[:space:]-]?remote\M)|(\mnot[[:space:]]+(a[[:space:]]+|an[[:space:]]+|fully[[:space:]]+)?remote\M)|(\mnot[[:space:]]+(eligible|available|open|considered)[[:space:]]+(for|to)[[:space:]]+remote\M)|(\mremote[[:space:]]*[:=(–—-][[:space:]]*(no|none)[[:space:]]*(?=$|[).|,;·/]))|(\m(remote|wfh|work[[:space:]]+from[[:space:]]+home|home[[:space:]]?office)[[:space:]]*[:=–—-]?[[:space:]]*(not[[:space:]]+(available|offered|permitted|an[[:space:]]+option)|unavailable)\M)|(\m(non|not|no)[[:space:]-]?(wfh|work[[:space:]]+from[[:space:]]+home|home[[:space:]]?office)\M)|(\mno[[:space:]]+remote[[:space:]]+(work|option|options|opportunity|opportunities)\M)|(\m(keine|kein|nicht)[[:space:]]+(im[[:space:]]+)?home[[:space:]]?office\M)|(\m(non|sans|aucun)[[:space:]-]?t[ée]l[ée]travail\M)|(\mpas[[:space:]]+de[[:space:]]+t[ée]l[ée]travail\M)|(\mt[ée]l[ée]travail[[:space:]]*[:=(–—-][[:space:]]*non[[:space:]]*(?=$|[).|,;·/]))|(\m(no|n[ãa]o)[[:space:]-]?remoto\M)|(\m(sin|no)[[:space:]]+teletrabajo\M)|(\m(geen|niet)[[:space:]]+thuiswerken\M)$re$;
  v_pos constant text := $re$\mremote\M|\mwork from home\M|\mwfh\M|\mt[ée]l[ée]travail\M|\mhome ?office\M|\mremoto\M|\mthuiswerken\M|\mteletrabajo\M$re$;
  v_done integer;
BEGIN
  WITH doomed AS (
    SELECT p.id
      FROM public.job_board_postings p
     WHERE p.remote = true
       AND p.work_mode IS DISTINCT FROM 'remote'
       AND (p.title || ' · ' || p.location) ~* v_neg
       AND regexp_replace(p.title || ' · ' || p.location, v_neg, ' ', 'gi') !~* v_pos
     LIMIT 20000
       FOR UPDATE SKIP LOCKED
  )
  UPDATE public.job_board_postings t
     SET remote = false
    FROM doomed d
   WHERE t.id = d.id;
  GET DIAGNOSTICS v_done = ROW_COUNT;
  RAISE NOTICE 'negated-remote repair: % rows had the stale boolean cleared', v_done;
END
$bool$;
