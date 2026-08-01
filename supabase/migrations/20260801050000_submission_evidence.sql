-- What the agent actually did, kept as evidence rather than as a claim.
--
-- agent_submissions already carries `answers` — what apply-agent PREPARED. It
-- does not carry what the worker actually put on the form, or the confirmation
-- text that proved the form accepted it. Those were computed and thrown away:
-- applyToPosting returns `evidence` on a confirmed send, and the worker
-- discarded it.
--
-- Both columns are added rather than reusing `answers`, because "what we
-- planned to say" and "what we said" are different facts and conflating them
-- would destroy the only comparison worth making. A packet prepared with one
-- answer and submitted with another — because a learned answer resolved it at
-- send time — is a normal, correct outcome that should still be visible.
--
-- WHY THIS MATTERS MORE THAN IT LOOKS. The whole product rests on the claim
-- that the agent never invents an answer. Today that claim is enforced in code
-- and provable only by reading it. With these columns the candidate can see, per
-- application, the exact answers submitted under their name and the employer's
-- own words confirming receipt. An honest agent that cannot show its work asks
-- for the same trust as a dishonest one.

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
