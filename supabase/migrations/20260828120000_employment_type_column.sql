-- EMPLOYMENT TYPE — the filter every job board has and this one never carried.
--
-- Nine of sixteen vendors state it STRUCTURALLY in the list payloads the
-- ingest already fetches (measured live 2026-08-28: ashby employmentType
-- "FullTime", lever categories.commitment "Full-time", workable
-- employment_type, smartrecruiters typeOfEmployment {id,label}, recruitee
-- employment_type_code, personio <schedule>, pinpoint employment_type_text,
-- icims data.employment_type, usajobs PositionSchedule). Two of those were
-- already threaded through the salary refusal logic and then thrown away.
--
-- SAME CONTRACT AS work_mode, closed-domain-or-nothing: a value only when the
-- vendor's structured field states one — never inferred from posting prose —
-- and NULL means "not stated", which the UI renders as nothing and the filter
-- excludes with a coverage disclosure saying how much it excludes.
ALTER TABLE public.job_board_postings
  ADD COLUMN IF NOT EXISTS employment_type text
  CHECK (employment_type IN ('full_time','part_time','contract','temporary','internship'));

COMMENT ON COLUMN public.job_board_postings.employment_type IS
  'Employment type from the vendor''s STRUCTURED field only (nine vendors carry one); NULL = not stated. Closed domain full_time|part_time|contract|temporary|internship. Filled at ingest; existing rows fill as rotation re-ingests them (~a wrap).';
