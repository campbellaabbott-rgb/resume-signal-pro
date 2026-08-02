REVOKE ALL ON FUNCTION public.agent_sender_online(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agent_sender_online(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.agent_sender_online(integer) TO service_role;

COMMENT ON FUNCTION public.agent_sender_online(integer) IS
  'True when a worker has checked in within the window. Default 900s — comfortably longer than the worker idle sleep (30s) plus one slow application, so a busy worker is never mistaken for a dead one. Readable by authenticated users so the Account page can say "this is on us" instead of showing an unexplained idle agent; anon is revoked.';