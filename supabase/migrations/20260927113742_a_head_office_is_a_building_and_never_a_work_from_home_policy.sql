-- THE BOARD PUBLISHED A LUBE TECHNICIAN AND A GRADING FOREMAN AS REMOTE
-- BECAUSE THEIR EMPLOYER CALLS ITS HEADQUARTERS THE HOME OFFICE.
--
-- MECHANISM. normalizePaylocity took the vendor's LocationName
-- unconditionally over the City/State that arrives in the SAME list payload,
-- and handed that string to the shared work-mode detector. On this vendor the
-- field is frequently a BUILDING or a COST CENTRE, not a place, and the
-- detector's remote pattern carries the head-office token because in German
-- ("Homeoffice") and in plenty of English postings it genuinely does state the
-- policy. So a site name became a work-from-home claim with no employer
-- statement of any kind behind it.
--
-- MEASURED 2026-09-27 as a CENSUS, not a sample: all 15 tenants in the
-- stratum, all 39 stored rows re-fetched from the tenants' own public board
-- payloads. The vendor's structured remote flag is FALSE on 39 of 39 rows, and
-- 36 of the 39 carry a real City/State in that same payload — Peoria IL,
-- Columbia SC, Camp Hill PA, Edina MN, Raleigh NC, Tallahassee FL, Overland
-- Park KS, Madison WI, Charleston SC, Houston TX, West Warwick RI, Agawam MA,
-- Lemoyne PA. Live values of the field: the token alone, the token behind a
-- four-digit cost-centre code, the token followed by a department word, and
-- the token behind a company name ending in a corporate-entity word.
--
-- WHY THIS FILE EXISTS, STATED CORRECTLY. An earlier draft of this header
-- claimed the bundle could not clear these rows at all, because the
-- corrections path writes work_mode through a helper that refuses a null. That
-- is only half of that path: the branch that fires when a posting's remote
-- BOOLEAN moves re-writes the re-normalised work mode WITH its nulls, and all
-- 35 doomed rows move that boolean from true to false on their board's next
-- visit. So the bundle alone does clear them, one lap at a time, and this file
-- is an ACCELERATOR plus a reach extension. Both halves of that are worth
-- having: the lap is a rotation away on a corpus this size, the corrections
-- budget is spent per visit so a big board's laps are partial, and a row whose
-- board is dormant, failing, or sitting past that board's per-pass fetch cap
-- is not reached by any lap at all. Nothing here is load-bearing for
-- CORRECTNESS — it is load-bearing for WHEN.
--
-- (The same asymmetry cuts the other way and is why the write below is
-- narrow: a stored HYBRID contradicted by the same re-read would NOT be
-- cleared by that branch, because the boolean never moves. This file does not
-- touch a stored hybrid either.)
--
-- WHAT IT WRITES: NULL, AND ONLY NULL. Not the mode the posting's own title
-- states — an earlier draft did that and it was wrong in the one direction
-- this whole change exists to forbid. SQL cannot see the vendor's own remote
-- flag, so a title-derived on-site written here could contradict a payload
-- whose structured field says remote, and "removing a claim" would have become
-- "stating a mode". It buys nothing either: for every row where the flag is
-- silent the normalizer derives the same title-stated mode on the next lap and
-- writes it, because a non-null value is written freely. So the repair only
-- ever subtracts, and the trinary it leaves behind is the normalizer's.
--
-- THE SCOPE, AND WHY IT CANNOT CATCH A GENUINELY REMOTE ROW. Four fences,
-- each one narrowing:
--   1. ONE VENDOR. Only the source whose own structured flag refuted our
--      reading 39 times out of 39. An adversarial re-check of this audit
--      REFUTED the wider rule a first draft proposed: on other vendors the
--      same token beside a place is often the employer's own statement —
--      Ashby answers workplaceType Remote on a Belfast head-office string and
--      on a Palo Alto one, a German ATS's own remote boolean confirms the
--      one-word spelling on 51 of 51 offers, and of the Workday rows in this
--      class that carry a structured remote type, 20 say Remote. Those rows
--      are out of scope here by source, and nothing in this file can reach
--      them.
--   2. THE RESIDUE TEST, not the presence of the token. A row qualifies only
--      when removing the token leaves NOTHING, or a bare three-or-more-digit
--      cost-centre number, or a residue naming an organisation or a
--      department. That last arm is deliberately not anchored, and the module
--      says why at length: two of the 39 measured labels put the entity word
--      inside a COMPANY NAME, so a rule demanding a residue of nothing but
--      entity words would leave three of them publishing a building as a
--      policy. A residue naming only a PLACE does not qualify — the two rows
--      reading as a Montana city beside the token, and the one naming three
--      Californian cities in a sentence, are deliberately untouched. A city
--      beside the token is not evidence of a building.
--   3. THE POSTING'S OWN WORDS WIN. A row whose title states a mode keeps it.
--      One of the 39 says so in its title and stays remote through this file.
--      The DEPARTMENT is read for that test with the head-office token
--      removed, exactly as the module now reads it: an employer whose site
--      labels read as head-office departments names departments the same way,
--      and an org-chart unit is not a policy. Live rows of that shape today:
--      0 of 3,646 sampled, so this keeps the two runtimes in step on a
--      population that does not exist yet rather than repairing one that does.
--   4. work_mode = 'remote' only, so a row already carrying a stated mode is
--      never rewritten, and a repaired row stops matching.
--
-- THE ONE ACCEPTED IMPRECISION, stated rather than hidden. There is no
-- per-row record of which field produced a stored value, so a row stored
-- remote from the vendor's flag rather than from the token is
-- indistinguishable here. On the measured population that set is EMPTY (the
-- flag is false on all 39). If one existed, this file would clear it to NULL
-- and the normalizer would restore it from the vendor field on that board's
-- next lap, because a non-null value is written freely. A recoverable loss of
-- a true value, never a false one.
--
-- DEPLOY ORDER: WITH OR AFTER THE BUNDLE THAT CARRIES THE CODE FIX, NEVER
-- BEFORE IT. Applied first, this write is simply undone: the still-live old
-- normalizer re-reads the site label as remote on the next visit, the
-- corrections path writes a non-null work mode freely, and the same branch
-- that clears the pair also re-sets the boolean — so every repaired row goes
-- back to a false remote, silently, one board at a time. Applied with or after
-- the fix, the re-read agrees with the write and nothing is undone.
--
-- LOCKING AND BOUNDS. The driving predicate is the work-mode enum, served by
-- the serving/posted indexes rather than a scan of the whole table, and the
-- source filter plus the regexes then keep the matched set tiny (35 rows on
-- the measured census). EVERY ROW THE DRIVING SELECT LOCKS IS A ROW THE UPDATE
-- CHANGES — the residue test and the own-words test are part of that select,
-- not applied afterwards — so a batch can never fill up with rows that do not
-- qualify and end the loop early while a residue is left behind. SKIP LOCKED
-- passes over a row the ingest is writing instead of blocking on it. The loop
-- is inside ONE DO block and a DO block is a single top-level statement, so
-- all iterations share the one timeout armed below: the batching bounds rows
-- locked per sub-statement, NOT how long the repair runs. The bound below is
-- orders of magnitude above the measured set; if it were ever exhausted a
-- residue would be LEFT and the notice would say how much was done, because a
-- partial repair is a correct outcome here and an aborted transaction is not.
--
-- IDEMPOTENT: a repaired row is no longer carrying the remote enum, so it no
-- longer matches. Re-running is a no-op, which is also how a row skipped for
-- being locked is picked up.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $repair$
DECLARE
  -- The head-office token, mirroring the exported source string in
  -- supabase/functions/job-board/normalize.ts. Postgres ARE word boundaries
  -- against JavaScript's: both treat a hyphen as a boundary, which is why the
  -- cost-centre spelling matches in either runtime.
  v_ho   constant text := $re$\mhome[[:space:]]+office\M$re$;
  -- The residue words that mean "an organisation or a department is named
  -- here, not a place". Kept to five entity words plus department: every word
  -- added here widens what stops counting as an employer statement.
  v_site constant text := $re$\m(inc|llc|corp|foundation|gmbh|departments?)\M$re$;
  -- A cost-centre number. Three digits minimum — a one- or two-digit residue
  -- is as likely to be a street number or a floor.
  v_num  constant text := $re$^[0-9]{3,}$$re$;
  -- P_NEGATED_REMOTE and P_REMOTE from the same module, transcribed exactly as
  -- the earlier negated-remote repair transcribed them. The hybrid and onsite
  -- patterns are deliberately NOT here: this file writes no mode.
  v_neg constant text := $re$(\m(non|not|no)[[:space:]-]?remote\M)|(\mnot[[:space:]]+(a[[:space:]]+|an[[:space:]]+|fully[[:space:]]+)?remote\M)|(\mnot[[:space:]]+(eligible|available|open|considered)[[:space:]]+(for|to)[[:space:]]+remote\M)|(\mremote[[:space:]]*[:=(–—-][[:space:]]*(no|none)[[:space:]]*(?=$|[).|,;·/]))|(\m(remote|wfh|work[[:space:]]+from[[:space:]]+home|home[[:space:]]?office)[[:space:]]*[:=–—-]?[[:space:]]*(not[[:space:]]+(available|offered|permitted|an[[:space:]]+option)|unavailable)\M)|(\m(non|not|no)[[:space:]-]?(wfh|work[[:space:]]+from[[:space:]]+home|home[[:space:]]?office)\M)|(\mno[[:space:]]+remote[[:space:]]+(work|option|options|opportunity|opportunities)\M)|(\m(keine|kein|nicht)[[:space:]]+(im[[:space:]]+)?home[[:space:]]?office\M)|(\m(non|sans|aucun)[[:space:]-]?t[ée]l[ée]travail\M)|(\mpas[[:space:]]+de[[:space:]]+t[ée]l[ée]travail\M)|(\mt[ée]l[ée]travail[[:space:]]*[:=(–—-][[:space:]]*non[[:space:]]*(?=$|[).|,;·/]))|(\m(no|n[ãa]o)[[:space:]-]?remoto\M)|(\m(sin|no)[[:space:]]+teletrabajo\M)|(\m(geen|niet)[[:space:]]+thuiswerken\M)$re$;
  v_pos constant text := $re$\mremote\M|\mwork from home\M|\mwfh\M|\mt[ée]l[ée]travail\M|\mhome ?office\M|\mremoto\M|\mthuiswerken\M|\mteletrabajo\M$re$;
  -- The one vendor this file is allowed to touch.
  v_src constant text := 'paylocity';
  v_batch       constant integer := 2000;
  v_max_batches constant integer := 20;   -- 40,000 rows, orders of magnitude above
                                          -- the 35 measured. Exhausting it LEAVES a
                                          -- residue on purpose (see header).
  v_done  integer;
  v_total integer := 0;
  v_i     integer;
BEGIN
  FOR v_i IN 1..v_max_batches LOOP
    WITH locked AS (
      SELECT p.id
        FROM public.job_board_postings p
       WHERE p.work_mode = 'remote'
         AND p.source = v_src
         AND p.location ~* v_ho
         -- THE RESIDUE TEST, inside the select that locks the rows: nothing
         -- left, a bare cost-centre number, or an organisation / department
         -- word. A string with only a place left in it does not qualify.
         AND btrim(regexp_replace(regexp_replace(p.location, v_ho, ' ', 'gi'),
                                  '[^[:alnum:]]+', ' ', 'g'))
             ~* ('^$|' || v_num || '|' || v_site)
         -- THE POSTING'S OWN WORDS WIN, with the department read the way the
         -- module reads it. The fix replaces the site label with the payload's
         -- City/State, which is not stored and cannot be read here; it is a
         -- place string carrying no mode token on any of the 39 measured rows,
         -- so the evidence is the title and the department.
         AND regexp_replace(
               p.title || ' · ' || COALESCE(regexp_replace(p.department, v_ho, ' ', 'gi'), ''),
               v_neg, ' ', 'gi') !~* v_pos
       LIMIT v_batch
         FOR UPDATE SKIP LOCKED
    )
    UPDATE public.job_board_postings t
       SET work_mode = NULL,
           remote = false
      FROM locked l
     WHERE t.id = l.id;
    GET DIAGNOSTICS v_done = ROW_COUNT;
    v_total := v_total + v_done;
    EXIT WHEN v_done = 0;
  END LOOP;

  RAISE NOTICE 'head-office site-label repair: % row(s) no longer claim work-from-home from a building name', v_total;
END
$repair$;
