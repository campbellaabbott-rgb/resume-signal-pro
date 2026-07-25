-- The user_applications status CHECK from 20260704160023 allows only
-- applied/interviewing/offer/rejected, but the shipped UI writes 'saved'
-- (every board save) and offers 'no_response'. The LIVE database was
-- evidently relaxed out-of-band (saves demonstrably work in prod) — this
-- commits that relaxation so a fresh environment replayed from migrations
-- doesn't reject the two most-written statuses (2026-07-25 audit).
DO $$
BEGIN
  ALTER TABLE public.user_applications DROP CONSTRAINT IF EXISTS user_applications_status_check;
  ALTER TABLE public.user_applications ADD CONSTRAINT user_applications_status_check
    CHECK (status IN ('saved', 'applied', 'interviewing', 'offer', 'rejected', 'no_response'));
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already widened
END $$;
