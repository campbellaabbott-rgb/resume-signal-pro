-- Fit-ranked board: store each posting's (trimmed) description so the
-- deterministic fit scorer can rank many postings in one call, plus a
-- freeform salary summary where the source feed provides one (Ashby
-- compensation tiers, Lever salary ranges). Both written by the refresh
-- pass; description is deliberately excluded from list responses.

ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS salary text;
