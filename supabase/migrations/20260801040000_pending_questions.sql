-- Questions the agent stopped on, so the candidate can answer them once.
--
-- The engine and the store shipped in 20260801030000 and 19fdef5, and they
-- measured well: 16 of 29 harvested forms completable, 25 of 29 once each
-- question has been answered once. But nothing WROTE the questions out and
-- there was no surface to answer them, so the 25 was a measurement of a
-- capability nobody could reach. In production it was still 16.
--
-- This is the missing half. When the worker refuses a posting because of a
-- question it cannot honestly answer, it records the question here. The account
-- surface lists them; answering one writes to agent_learned_answers and clears
-- the row. A refusal becomes a one-time cost instead of a permanent block.
--
-- ONLY LEARNABLE REFUSALS LAND HERE. "We do not hold this" is a gap the
-- candidate can close; "we will not do this" is a position. An ID number, a
-- date of birth, a referee's phone number are refused for what they ARE, and
-- writing them here would invite someone to answer them and quietly convert a
-- safeguard into a stored value. The allow-list lives in
-- worker/src/questions/learned.ts and is enforced before the insert.
--
-- The row is a QUESTION, never an answer. It carries what the form asked and
-- what it offered, so the candidate is answering the employer's actual words
-- rather than a paraphrase.

CREATE TABLE IF NOT EXISTS public.agent_pending_questions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Same normalisation as agent_learned_answers, so answering here resolves the
  -- same question everywhere it is asked.
  question_key   text NOT NULL,
  question_label text NOT NULL,
  -- "fill" | "choose" | "check" — what the control wants, so the UI can render
  -- the right input instead of guessing from the text.
  answer_kind    text NOT NULL CHECK (answer_kind IN ('fill','choose','check')),
  -- The options the form offered, verbatim. Empty for free text.
  options        jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Why the matcher refused, in its own words. Shown to the candidate so the
  -- ask is explained rather than bare.
  refusal_reason text NOT NULL DEFAULT '',
  -- Which posting surfaced it first — context for a question that would
  -- otherwise arrive with none.
  posting_id     text,
  company        text,
  seen_count     integer NOT NULL DEFAULT 1,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_key)
);

ALTER TABLE public.agent_pending_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own pending questions: select" ON public.agent_pending_questions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own pending questions: delete" ON public.agent_pending_questions
  FOR DELETE USING (auth.uid() = user_id);
-- No INSERT or UPDATE policy for end users on purpose. These rows are written
-- by the worker with the service key, from what a real form actually asked.
-- A user-authored row would be a question no employer posed, and answering it
-- would put an answer in the store keyed to nothing.

CREATE INDEX IF NOT EXISTS agent_pending_questions_user_idx
  ON public.agent_pending_questions (user_id, last_seen_at DESC);

COMMENT ON TABLE public.agent_pending_questions IS
  'Screening questions the agent refused and the candidate can resolve once. '
  'Written by the worker (service key) only, and only for refusals that mean '
  '"we do not hold this" — never for refusals of principle. Answering one '
  'writes agent_learned_answers and clears the row.';
