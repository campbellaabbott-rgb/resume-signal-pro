-- THE ONE UNCOPYABLE ASSET WAS PUBLICLY READABLE, AND HAD BEEN SINCE DAY ONE.
--
-- Found by the post-recovery coherence sweep, verified live 2026-08-18 02:20Z:
-- an anon-key REST select on job_board_closures returned real rows seconds old
-- (closed_at 02:19:51Z), with ~345,000 rows behind it. The cause is in the
-- table's ORIGINAL migration, 20260714150000:
--
--   CREATE POLICY "job_board_closures_public_read"
--     ON public.job_board_closures FOR SELECT USING (true);
--
-- So this is not a regression from today's incident. The closure log — the
-- only dataset here a competitor cannot reconstruct, because it exists only if
-- you were watching when each posting came down — has been raw-readable for 35
-- days. Every "the log itself stays private" comment written since (including
-- two by me, today) was wrong.
--
-- WHY THE WRONG BELIEF SURVIVED: a verification probe SELECTed a column named
-- `id`. This table's key is `event_id`, so PostgREST answered 400 — a
-- bad-column error indistinguishable, to a hurried reader, from "not
-- readable". The 400 was quoted as proof of privacy at least twice. A
-- permission probe must ask for a column that exists (or *), and the test
-- below probes with event_id for exactly that reason.
--
-- WHAT BREAKS: nothing. The frontend never selects the table (verified: zero
-- references outside tests); every public surface that uses closure data —
-- ghost-job stats, company hiring health, get_board_flow — is a SECURITY
-- DEFINER aggregate that bypasses RLS by design and keeps working. Only raw
-- row access closes.
DROP POLICY IF EXISTS "job_board_closures_public_read" ON public.job_board_closures;

-- RLS stays enabled; with no SELECT policy remaining, anon and authenticated
-- get nothing, and the service role (which does the writes) bypasses RLS.
ALTER TABLE public.job_board_closures ENABLE ROW LEVEL SECURITY;

-- Belt and braces: the sibling ledgers were checked and are already locked
-- (RLS enabled, no public policy) — job_board_exits since 20260726052000,
-- job_board_pool_samples since 20260818050000. Nothing to change there; this
-- comment exists so the next audit knows all three were checked TOGETHER.
