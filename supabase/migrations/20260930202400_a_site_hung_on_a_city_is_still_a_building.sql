-- A HEAD OFFICE HUNG OFF A CITY IS STILL A BUILDING. TWO POSTINGS AT A
-- RANCH-SUPPLY STORE WERE STILL PUBLISHED AS REMOTE.
--
-- WHAT THE FIRST REPAIR (20260927113742) LEFT, AND WHY IT LEFT IT. That file
-- clears a head-office label only when REMOVING the token leaves nothing, a
-- bare cost-centre number, or an organisation/department word. Its own header
-- names the rows it declines: "the two rows reading as a Montana city beside
-- the token". The residue of "Bozeman, MT - Home Office" is a PLACE, and a
-- place beside the token was refuted as evidence of a building — Ashby answers
-- workplaceType Remote on "Home Office (Belfast)", 20 of 24 Workday rows in the
-- jurisdiction class say Remote. So the exclusion was right on the evidence it
-- had. This file does not overturn it and does not widen the word list; it adds
-- the evidence that was missing and reads ONE further grammar.
--
-- THE EVIDENCE, MEASURED 2026-09-30 AND NOT INFERRED. The employer's own board
-- was re-read whole rather than the two rows that were wrong. Ranch and Home
-- Supply publishes 89 postings and writes LocationName as "City, ST" optionally
-- followed by " - <site>". Its site vocabulary, live:
--     Bozeman, MT - Home Office          (4 rows)
--     Bozeman, MT - Four Corners         (3 rows)
--     Butte, MT - Distribution Center    (2 rows)
--     Laramie, WY - Distribution Center  (1 row)
-- The head-office token occupies the SAME slot as a distribution centre, and on
-- the head-office rows the payload states City "Bozeman" and State "MT"
-- structurally in the same object. Nobody reads "Butte, MT - Distribution
-- Center" as a work-from-home policy; the field does not change meaning between
-- two rows of one employer's site list.
--
-- THE VENDOR'S FLAG, RE-FETCHED THE SAME DAY, WITH THE POSITIVE CONTROL THE
-- FIRST CENSUS DID NOT PRINT. Across the 15 tenants of that census, 54 live
-- rows now carry the token and IsRemote is false on 54 of 54. A flag no
-- employer ever sets would be silence rather than a refutation, so: 3 of those
-- 15 tenants DO set it true on other postings (6 of 13, 1 of 5, 1 of 4), which
-- makes the field live on this vendor — but THIS employer sets it on none of
-- its 89 rows. That is why the rule below rests on the label grammar and not on
-- the flag, and why this header says so instead of quoting 54-of-54 as though
-- it settled the row by itself.
--
-- AND A WIDER SWEEP FOUND NO SECOND POPULATION: every 12th token of the 6,236
-- paylocity tenants, 520 boards and 10,583 live postings read on 2026-09-30,
-- carries the token 0 times. The shape is rare and concentrated, which is also
-- why this file is a two-row correctness fix and not an incident.
--
-- THE RULE, AND WHY IT IS A SUFFIX RULE. A place, a comma, a two-letter code, a
-- dash, the token, END OF FIELD. It is deliberately not "a place beside the
-- token", which stays refuted: every string on that audit's refuted list
-- answers no here — "Home Office (Belfast)" and "Palo Alto Home Office" have no
-- separator before the token, "FL - Home Office" and "TX Home Office" put no
-- city before the code, "Home Office, Columbus, OH, US" leads with the token,
-- "US-CA California Los Angeles/Orange County Home Office" has no separator.
-- The third row the first repair declined, "San Jose, Watsonville, or Salinas
-- (the applicant's choice of home office)", also answers no, and it should: the
-- token there is inside the employer's own sentence about where the applicant
-- may work, which is a statement and not a site name.
--
-- AND THE PLACE ITSELF MAY NOT STATE REMOTE, so a "Remote, US - Home Office"
-- keeps its claim. 0 of the 54 measured labels carry a second mode token, so
-- this arm costs nothing today; it is the one way this grammar could delete a
-- statement, so it is written down and mutated in the guard rather than
-- assumed.
--
-- WHAT IT WRITES: NULL, AND ONLY NULL, for every reason the first file gives.
-- SQL cannot see the vendor's remote flag, so a title-derived mode written here
-- could contradict a payload that says remote; the normalizer re-derives any
-- stated mode on the next lap and writes it freely. The repair only subtracts.
--
-- THE POSTING'S OWN WORDS STILL WIN, read exactly as the first file reads them
-- and exactly as the module reads them: the title plus the department with the
-- head-office token masked out, negations stripped before the positive test.
--
-- DEPLOY ORDER: WITH OR AFTER THE BUNDLE CARRYING THE normalizePaylocity
-- CHANGE, NEVER BEFORE IT. Applied first, the still-live old normalizer reads
-- the label as remote on the board's next visit and the corrections path puts
-- the claim straight back. Ranch and Home Supply is a live board (re-read
-- 2026-09-30), so the bundle alone would also clear these two on its next lap:
-- as with the first file, NOTHING HERE IS LOAD-BEARING FOR CORRECTNESS, only
-- for when.
--
-- THE ONE ACCEPTED IMPRECISION, unchanged from the first file and stated again
-- because this rule reaches a new shape. There is no per-row record of which
-- field produced a stored value, and SQL cannot see City/State, so a row stored
-- remote from the vendor's own flag whose label happens to be written in this
-- grammar would be cleared here and restored by the normalizer on the next lap,
-- because a non-null value is written freely. A recoverable loss of a true
-- value, never a false one. On the measured population that set is empty.
--
-- LOCKING AND BOUNDS: the shape the first file's review settled on, unchanged.
-- Every predicate sits INSIDE the locking select, so a batch can never fill
-- with rows the update does not change and end the loop with a residue left.
-- SKIP LOCKED passes over a row the ingest is writing. One DO block is one
-- top-level statement, so all iterations share the timeout armed below.
--
-- IDEMPOTENT: a repaired row no longer carries the remote enum, so it no longer
-- matches. Re-running is a no-op, which is also how a skipped row is picked up.

SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '120s';

DO $repair$
DECLARE
  -- Mirrors HOME_OFFICE_PLACE_SUFFIX_SOURCE in
  -- supabase/functions/job-board/normalize.ts. Postgres ARE against
  -- JavaScript: [[:space:]] is \s, and the capture is the place the site name
  -- is hung on.
  v_place constant text := $re$^(.+,[[:space:]]*[A-Za-z]{2})[[:space:]]*[-–—][[:space:]]*home[[:space:]]+office[[:space:]]*$$re$;
  -- The head-office token, mirroring HOME_OFFICE_TOKEN_SOURCE. Used here ONLY
  -- to mask the department in the evidence string, exactly as the first repair
  -- and the module both mask it: an org-chart unit is not a policy.
  v_ho    constant text := $re$\mhome[[:space:]]+office\M$re$;
  -- P_NEGATED_REMOTE and P_REMOTE, transcribed as the first repair transcribes
  -- them. The hybrid and onsite patterns are deliberately absent: this file
  -- writes no mode.
  v_neg constant text := $re$(\m(non|not|no)[[:space:]-]?remote\M)|(\mnot[[:space:]]+(a[[:space:]]+|an[[:space:]]+|fully[[:space:]]+)?remote\M)|(\mnot[[:space:]]+(eligible|available|open|considered)[[:space:]]+(for|to)[[:space:]]+remote\M)|(\mremote[[:space:]]*[:=(–—-][[:space:]]*(no|none)[[:space:]]*(?=$|[).|,;·/]))|(\m(remote|wfh|work[[:space:]]+from[[:space:]]+home|home[[:space:]]?office)[[:space:]]*[:=–—-]?[[:space:]]*(not[[:space:]]+(available|offered|permitted|an[[:space:]]+option)|unavailable)\M)|(\m(non|not|no)[[:space:]-]?(wfh|work[[:space:]]+from[[:space:]]+home|home[[:space:]]?office)\M)|(\mno[[:space:]]+remote[[:space:]]+(work|option|options|opportunity|opportunities)\M)|(\m(keine|kein|nicht)[[:space:]]+(im[[:space:]]+)?home[[:space:]]?office\M)|(\m(non|sans|aucun)[[:space:]-]?t[ée]l[ée]travail\M)|(\mpas[[:space:]]+de[[:space:]]+t[ée]l[ée]travail\M)|(\mt[ée]l[ée]travail[[:space:]]*[:=(–—-][[:space:]]*non[[:space:]]*(?=$|[).|,;·/]))|(\m(no|n[ãa]o)[[:space:]-]?remoto\M)|(\m(sin|no)[[:space:]]+teletrabajo\M)|(\m(geen|niet)[[:space:]]+thuiswerken\M)$re$;
  v_pos constant text := $re$\mremote\M|\mwork from home\M|\mwfh\M|\mt[ée]l[ée]travail\M|\mhome ?office\M|\mremoto\M|\mthuiswerken\M|\mteletrabajo\M$re$;
  -- The one vendor either half of this build is allowed to touch.
  v_src constant text := 'paylocity';
  v_batch       constant integer := 2000;
  v_max_batches constant integer := 20;
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
         -- THE SUFFIX GRAMMAR, and nothing wider. A label that merely CONTAINS
         -- the token beside a place is untouched here, which is the first
         -- repair's conservatism kept rather than replaced.
         AND p.location ~* v_place
         -- THE PLACE THE SITE IS HUNG ON MAY NOT ITSELF STATE REMOTE.
         AND regexp_replace(regexp_replace(p.location, v_place, '\1', 'i'),
                            v_neg, ' ', 'gi') !~* v_pos
         -- THE POSTING'S OWN WORDS WIN, with the department masked the way both
         -- other runtimes mask it.
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

  RAISE NOTICE 'head-office suffix repair: % row(s) no longer read a site name hung on a city as a work-from-home policy', v_total;
END
$repair$;
