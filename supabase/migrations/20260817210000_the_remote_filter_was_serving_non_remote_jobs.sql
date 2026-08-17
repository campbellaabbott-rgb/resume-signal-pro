-- THE REMOTE FILTER WAS SERVING JOBS THAT SAY THEY ARE NOT REMOTE.
--
-- Two writers put work_mode='remote' on rows the employer never described that
-- way, and both are fixed in the same deploy as this migration. This repairs
-- what they already wrote.
--
-- WRITER 1 — the Workday remoteType classifier, a substring test with no
-- negation arm. Nike's live tenant publishes the literal string "Non-Remote
-- Posting"; /remote/ matches it and stored the exact inverse of what the
-- employer said.
--
-- WRITER 2 — two call sites passed the 4,000-character description into
-- detectWorkMode, whose remote pattern is a bare \bremote\b. normalize.ts:156
-- states the contract those sites violated: "clear words only; descriptions are
-- never inferred from". Real rows this produced, verified against the
-- employers' own payloads:
--
--   "Sample Handling Assistant", Huntingdon UK
--     -> "due to the remote location of this site, there are no public
--         transport links available"
--   "Rock Truck Operator", La Loche SK
--     -> "a major civil earthworks project in remote Northern Saskatchewan"
--   "Cardiac Device Specialist", East Stroudsburg PA
--     -> "the technical component of remote cardiac device monitoring"
--   "Practical Nursing Instructor", St. Cloud
--     -> "There is no option for this position to be remote."
--
-- Measured drift at the time of writing: 37 of 181 rows on one sampled page,
-- 225 of 996 over the preceding 24 hours. Page 1 of the Remote filter was
-- clean, which is why this survived — the wrong rows sit deeper in the result
-- set, where a casual check never looks.
--
-- THE REPAIR TARGETS THE DRIFT SET EXACTLY, and nothing else: rows tagged
-- remote whose own title and location contain no remote token AND whose legacy
-- boolean disagrees. A row that genuinely states remote in its title or
-- location is untouched; so is any row a vendor's structured field marked.
--
-- NULL is the honest value, not 'onsite'. The board's documented rule is that a
-- posting which does not state a mode is EXCLUDED from work-mode filters rather
-- than guessed at, and the UI already discloses that. Writing 'onsite' here
-- would replace one guess with another.

UPDATE public.job_board_postings
SET work_mode = NULL,
    remote = false
WHERE work_mode = 'remote'
  AND COALESCE(remote, false) = false
  AND COALESCE(title, '') !~* '\mremote\M|\mwork from home\M|\mwfh\M|\mtelework\M|\mremoto\M|\mthuiswerken\M|\mteletrabajo\M'
  AND COALESCE(location, '') !~* '\mremote\M|\mwork from home\M|\mwfh\M|\mtelework\M|\mremoto\M|\mthuiswerken\M|\mteletrabajo\M';

-- Rows whose vendor said "Non-Remote Posting" and were stored as remote: the
-- boolean and the enum disagree in the other direction too. Same honesty rule.
UPDATE public.job_board_postings
SET work_mode = NULL
WHERE work_mode = 'remote'
  AND COALESCE(remote, false) = false
  AND COALESCE(title, '') !~* '\mremote\M'
  AND COALESCE(location, '') !~* '\mremote\M';
