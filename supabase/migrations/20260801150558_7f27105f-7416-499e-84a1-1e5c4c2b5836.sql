CREATE TABLE IF NOT EXISTS public.agent_learned_answers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_key   text NOT NULL,
  question_label text NOT NULL,
  answer_kind    text NOT NULL CHECK (answer_kind IN ('fill','choose','check')),
  answer_value   text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, question_key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_learned_answers TO authenticated;
GRANT ALL ON public.agent_learned_answers TO service_role;

ALTER TABLE public.agent_learned_answers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own learned answers: select" ON public.agent_learned_answers
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own learned answers: insert" ON public.agent_learned_answers
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own learned answers: update" ON public.agent_learned_answers
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own learned answers: delete" ON public.agent_learned_answers
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS agent_learned_answers_user_idx
  ON public.agent_learned_answers (user_id);

COMMENT ON TABLE public.agent_learned_answers IS
  'Screening answers the candidate supplied once, reused on later forms asking the same question. Keyed on the whole normalised question, never a category. Refusals of principle (ID numbers, DOB, nationality, demographics, referees) are never stored; see worker/src/questions/learned.ts.';