-- AN OWNER MAY DECIDE A ROW, BUT NEVER WHO PAID FOR IT.
--
-- agent_queue and agent_submissions were granted whole-row UPDATE to
-- authenticated (20260721185654:44, 20260730202510:29) with owner-scoped RLS,
-- when every column was the owner's to decide. The pass added two that are
-- not: pass_id names the pass that paid for a row, and pass_refunded_at is
-- the receipt that says the refund already happened. Under the whole-row
-- grant an owner could stamp their own pass onto a dismissed queue row from
-- an earlier subscription (prepared and sent with no application consumed),
-- or clear the receipt and collect the refund again.
--
-- The grant is narrowed to exactly what the account panels write:
--   agent_queue        status, decided_at              (Morning Queue decide)
--   agent_submissions  status, submitted_at,           (Recorded as sent)
--                      submitted_via, attempts,        (Try again)
--                      claimed_at, claimed_by
-- REVOKE first — a GRANT never restricts (project_definer_exposure). SELECT is
-- untouched; RLS still scopes rows to their owner; service_role keeps ALL.
-- No function in this file.

REVOKE UPDATE ON public.agent_queue FROM authenticated;
GRANT UPDATE (status, decided_at) ON public.agent_queue TO authenticated;

REVOKE UPDATE ON public.agent_submissions FROM authenticated;
GRANT UPDATE (status, submitted_at, submitted_via, attempts, claimed_at, claimed_by)
  ON public.agent_submissions TO authenticated;
