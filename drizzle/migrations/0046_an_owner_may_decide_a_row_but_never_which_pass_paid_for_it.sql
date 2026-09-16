REVOKE UPDATE ON public.agent_queue FROM authenticated;
GRANT UPDATE (status, decided_at) ON public.agent_queue TO authenticated;

REVOKE UPDATE ON public.agent_submissions FROM authenticated;
GRANT UPDATE (status, submitted_at, submitted_via, attempts, claimed_at, claimed_by)
  ON public.agent_submissions TO authenticated;