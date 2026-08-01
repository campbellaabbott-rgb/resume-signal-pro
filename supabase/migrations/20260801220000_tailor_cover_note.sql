-- Per-posting cover notes: the opt-in switch.
--
-- DEFAULT FALSE, and that is the whole point of the column existing.
--
-- `cover_note` has always been sent to employers exactly as the candidate typed
-- it. Turning on tailoring for everyone would mean a language model rewriting
-- their words and sending the result under their name to a stranger, without
-- them ever agreeing to it. That is a trust decision belonging to the person
-- whose name is on the application, so it is opt-in, off until they say
-- otherwise, and every existing mandate keeps the behaviour it already had.
--
-- When it is on and a draft fails the grounding gate, apply-agent falls back to
-- this same `cover_note`. The column is never a replacement for the note — it
-- only decides whether an attempt is made.

ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS tailor_cover_note boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.agent_mandates.tailor_cover_note IS
  'Opt-in: rewrite cover_note per posting, grounded in the resume and the posting. Falls back to cover_note verbatim when the grounding gate rejects the draft.';
