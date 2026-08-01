ALTER TABLE public.agent_mandates
  ADD COLUMN IF NOT EXISTS tailor_cover_note boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.agent_mandates.tailor_cover_note IS
  'Opt-in: rewrite cover_note per posting, grounded in the resume and the posting. Falls back to cover_note verbatim when the grounding gate rejects the draft.';