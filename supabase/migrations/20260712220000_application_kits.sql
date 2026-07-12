-- Apply co-pilot: persist the generated tailored kit (resume + cover letter +
-- checklist) on the tracked application, so batch-prepped kits survive a
-- refresh and don't cost a regeneration to re-open. Owner-only via the
-- existing user_applications RLS.
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS kit jsonb;
ALTER TABLE public.user_applications ADD COLUMN IF NOT EXISTS kit_generated_at timestamptz;
