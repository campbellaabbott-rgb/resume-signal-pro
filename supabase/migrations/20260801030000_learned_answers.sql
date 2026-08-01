-- Answers the candidate gave once, so the agent never has to ask twice.
--
-- MEASURED 2026-08-01 across 29 live forms: the matcher answers 51 of 103
-- required questions, and 16 of 29 forms complete end to end. Everything still
-- blocking is role-specific — "Do you have a Journeyman Electrician License?",
-- "years of experience in a GMP-regulated pharmaceutical environment", "Have
-- you personally advised senior executives…". No pattern can answer those, and
-- one that tried would be inventing facts about someone's career.
--
-- So the lever is memory, not cleverness. The agent asks once; the answer is
-- the candidate's own words; every later form asking the same question is
-- answered from it.
--
-- KEYED ON THE WHOLE QUESTION, deliberately. "years of experience" as a key
-- would answer "…in commercial electrical work" from "…in GMP pharmaceutical
-- manufacturing" — the single-global-value bug that made a UK candidate claim
-- US work authorisation, in a new costume. The full normalised label is the key.
--
-- WHAT IS NOT STORED HERE. Refusals of PRINCIPLE never become rows: ID numbers,
-- date of birth, nationality, demographics, referees' contact details. Those
-- are refused because auto-filling them is wrong, not because nobody typed
-- them in, and a table would quietly convert a safeguard into a feature. The
-- allow-list lives in worker/src/questions/learned.ts and is enforced there.

CREATE TABLE IF NOT EXISTS public.agent_learned_answers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Normalised question text. Requiredness markers and punctuation stripped so
  -- "Available weekends?*Required" and "Available weekends?" are one question.
  question_key   text NOT NULL,
  -- The question as actually worded when answered, so the account UI can show
  -- a real sentence instead of a normalised key.
  question_label text NOT NULL,
  answer_kind    text NOT NULL CHECK (answer_kind IN ('fill','choose','check')),
  answer_value   text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_key)
);

ALTER TABLE public.agent_learned_answers ENABLE ROW LEVEL SECURITY;

-- These are the candidate's own statements about themselves. Nobody else reads
-- or writes them, including other signed-in users.
CREATE POLICY "own learned answers: select" ON public.agent_learned_answers
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own learned answers: insert" ON public.agent_learned_answers
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own learned answers: update" ON public.agent_learned_answers
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own learned answers: delete" ON public.agent_learned_answers
  FOR DELETE USING (auth.uid() = user_id);

-- The worker reads these with the service key at submit time, one user at a
-- time, so the lookup is always user_id-scoped.
CREATE INDEX IF NOT EXISTS agent_learned_answers_user_idx
  ON public.agent_learned_answers (user_id);

COMMENT ON TABLE public.agent_learned_answers IS
  'Screening answers the candidate supplied once, reused on later forms asking '
  'the same question. Keyed on the whole normalised question, never a category '
  '— a shared key would answer one role-specific question from another. '
  'Refusals of principle (ID numbers, DOB, nationality, demographics, referees) '
  'are never stored; see worker/src/questions/learned.ts.';
