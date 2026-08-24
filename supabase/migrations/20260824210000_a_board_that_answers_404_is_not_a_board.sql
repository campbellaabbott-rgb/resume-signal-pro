-- A BOARD THAT ANSWERS 404 IS NOT A BOARD.
--
-- 110 registered boards were failing on every rotation, reported as a wall of
-- "(vendor)" entries in failedSources. Probed individually against their own
-- vendor APIs on 2026-08-24, they split cleanly:
--
--   76 x HTTP 404 and 1 x HTTP 410  -> the employer closed the ATS account or
--                                      renamed the token. Genuinely gone.
--   10 x HTTP 500, 3 x 422, 1 x 403, 1 x 429, 1 network -> vendor-side or
--                                      transient; left in place to recover.
--    9 x empty 200                  -> the feed works and has no openings.
--    8 x LIVE JOBS (248 postings)   -> our fetch fails where a direct probe
--                                      succeeds. NOT removed — that is our
--                                      bug to find, not their board to drop.
--
-- This removes only the 77 that are gone. Each was burning a fetch slot every
-- rotation and filling the failure list with noise, which is how real breakage
-- stays hidden.
--
-- THE HIGH-WATER MARK MOVES IN THE SAME MIGRATION, and that is not optional:
-- the stale-bundle guard is a STRICT less-than, so a catalog that shrinks
-- below the stored mark disables the orphan prune entirely. That exact
-- off-by-one shipped earlier today. New catalog size is 31,631.
--
-- Postings are deleted directly rather than left to the orphan prune, so the
-- rows go with the boards in one step. Keyed on (source, token) — a token
-- string can repeat across vendors.

DELETE FROM public.job_board_postings p
USING (VALUES
  ('ashby', 'AtomicSemi'),
  ('ashby', 'TerraFirma'),
  ('ashby', 'airapps'),
  ('ashby', 'arcada'),
  ('ashby', 'aviator'),
  ('ashby', 'casap'),
  ('ashby', 'clove'),
  ('ashby', 'continue'),
  ('ashby', 'deltia'),
  ('ashby', 'foresite-labs-fl2024-006'),
  ('ashby', 'fractional-ai'),
  ('ashby', 'generalintuition'),
  ('ashby', 'manusai'),
  ('ashby', 'medal'),
  ('ashby', 'miso'),
  ('ashby', 'prox'),
  ('ashby', 'queue'),
  ('ashby', 'windmill'),
  ('greenhouse', '10xgenomics'),
  ('greenhouse', 'aerospike'),
  ('greenhouse', 'arine'),
  ('greenhouse', 'armracolostrum'),
  ('greenhouse', 'artefactus'),
  ('greenhouse', 'aurorainnovation'),
  ('greenhouse', 'beauhurst'),
  ('greenhouse', 'bootcampinstructionalengagement'),
  ('greenhouse', 'brooklinen'),
  ('greenhouse', 'camusenergy'),
  ('greenhouse', 'capitalrx'),
  ('greenhouse', 'cerebral'),
  ('greenhouse', 'civilscience'),
  ('greenhouse', 'dmcengineering2024'),
  ('greenhouse', 'embrace'),
  ('greenhouse', 'fireworksai'),
  ('greenhouse', 'flyflat'),
  ('greenhouse', 'galileofinancialtechnologies'),
  ('greenhouse', 'harmonic'),
  ('greenhouse', 'heycar'),
  ('greenhouse', 'hibu'),
  ('greenhouse', 'iherb'),
  ('greenhouse', 'interviewkickstart'),
  ('greenhouse', 'jumo'),
  ('greenhouse', 'junglescout'),
  ('greenhouse', 'matx'),
  ('greenhouse', 'maxinsurance'),
  ('greenhouse', 'nanonets'),
  ('greenhouse', 'objectstream'),
  ('greenhouse', 'openly'),
  ('greenhouse', 'ottoaviation'),
  ('greenhouse', 'oxosmedical'),
  ('greenhouse', 'scsfinancial'),
  ('greenhouse', 'syncro'),
  ('greenhouse', 'tekion'),
  ('greenhouse', 'thelearningvine'),
  ('greenhouse', 'thinkingmachines'),
  ('greenhouse', 'thirtymadison'),
  ('greenhouse', 'trueclassicteesllc'),
  ('greenhouse', 'underdogfantasy'),
  ('greenhouse', 'wyndlabs'),
  ('lever', '11855760-canada-inc'),
  ('lever', 'addx'),
  ('lever', 'graviticsspace'),
  ('lever', 'petvisor'),
  ('lever', 'quokka'),
  ('lever', 'regrello'),
  ('lever', 'scoperecruiting'),
  ('lever', 'unstructuredtechnologies'),
  ('lever', 'voodoo'),
  ('recruitee', 'dentaaltotaal'),
  ('recruitee', 'hiltermannconsumentenfinancieringen'),
  ('teamtailor', 'humantower'),
  ('teamtailor', 'twincity'),
  ('workable', 'blueprint-bryanjohnson'),
  ('workable', 'forward-march-inc'),
  ('workable', 'gallagher-flynnand-company'),
  ('workable', 'soulbound'),
  ('workday', 'comcast~wd5~Comcast_Careers')
) AS v(source, token)
WHERE p.source = v.source AND p.company_token = v.token;

UPDATE public.job_board_meta
SET v = jsonb_set(v, '{size}', to_jsonb(LEAST((v->>'size')::int, 31631))),
    updated_at = now()
WHERE k = 'catalog_highwater';
