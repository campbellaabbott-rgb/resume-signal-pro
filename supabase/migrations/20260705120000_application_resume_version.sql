-- Pro workspace: tie each tracked application to the resume version (saved
-- scan) it was sent with, so the tracker can answer "which resume gets
-- interviews". user_scans already acts as the version store (labels, scores,
-- fix plans) — no separate versions table needed.

alter table public.user_applications
  add column if not exists scan_id uuid references public.user_scans(id) on delete set null;

create index if not exists user_applications_scan_idx
  on public.user_applications (scan_id);
