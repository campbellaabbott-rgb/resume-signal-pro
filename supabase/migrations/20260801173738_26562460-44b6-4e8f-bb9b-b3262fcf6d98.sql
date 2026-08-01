ALTER TABLE public.agent_submissions
  ADD COLUMN IF NOT EXISTS sent_answers  jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS sent_evidence text  NOT NULL DEFAULT '';

COMMENT ON COLUMN public.agent_submissions.sent_answers IS
  'What the worker actually entered, at send time. Distinct from `answers`, '
  'which is what apply-agent prepared — a learned answer can resolve a question '
  'between preparation and send, and that difference should stay visible.';
COMMENT ON COLUMN public.agent_submissions.sent_evidence IS
  'The confirmation text the employer''s form returned. The proof a submission '
  'landed, in their words rather than ours.';