-- Screening-question answering: the one standing answer that was missing.
--
-- Most employer forms that block unattended applying ask things the candidate
-- has already told us — work authorisation, sponsorship, notice period, salary
-- expectation. Two of the eight live Breezy forms sampled on 2026-07-31 instead
-- asked the candidate to ACCEPT something: a privacy notice, or a declaration
-- that the information given is true.
--
-- Those are not facts to look up. They are acts performed in someone's name, so
-- they need their own opt-in rather than riding along on the apply mandate.
-- Without this column set true, the agent refuses any form carrying one and
-- routes the packet to the review queue, where the person can tick it
-- themselves.
--
-- DEFAULT FALSE, deliberately. Somebody who set up an auto-apply mandate before
-- this column existed must not discover afterwards that an agent has been
-- agreeing to employers' data-processing terms on their behalf. Same reasoning
-- as share_demographics and as apply_mode defaulting to 'review'.
ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS consent_to_processing boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.agent_mandates.consent_to_processing IS
  'Explicit opt-in allowing the apply agent to accept an employer''s privacy '
  'notice / data-processing consent / truthfulness declaration on the '
  'candidate''s behalf. False = the agent refuses those forms and queues them '
  'for the person to complete. Never inferred from any other setting.';
