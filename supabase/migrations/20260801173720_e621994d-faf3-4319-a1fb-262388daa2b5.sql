-- Questions the agent stopped on, so the candidate can answer them once.
CREATE TABLE IF NOT EXISTS public.agent_pending_questions (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_key   text NOT NULL,
  question_label text NOT NULL,
  answer_kind    text NOT NULL CHECK (answer_kind IN ('fill','choose','check')),
  options        jsonb NOT NULL DEFAULT '[]'::jsonb,
  refusal_reason text NOT NULL DEFAULT '',
  posting_id     text,
  company        text,
  seen_count     integer NOT NULL DEFAULT 1,
  first_seen_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_key)
);

GRANT SELECT, DELETE ON public.agent_pending_questions TO authenticated;
GRANT ALL ON public.agent_pending_questions TO service_role;

ALTER TABLE public.agent_pending_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own pending questions: select" ON public.agent_pending_questions
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own pending questions: delete" ON public.agent_pending_questions
  FOR DELETE USING (auth.uid() = user_id);
-- No INSERT or UPDATE policy for end users on purpose. These rows are written
-- by the worker with the service key, from what a real form actually asked.

CREATE INDEX IF NOT EXISTS agent_pending_questions_user_idx
  ON public.agent_pending_questions (user_id, last_seen_at DESC);

COMMENT ON TABLE public.agent_pending_questions IS
  'Screening questions the agent refused and the candidate can resolve once. '
  'Written by the worker (service key) only, and only for refusals that mean '
  '"we do not hold this" — never for refusals of principle. Answering one '
  'writes agent_learned_answers and clears the row.';