-- Freshness observability: the re-verification age distribution across all
-- stamped boards, computed from the per-board verification stamps. This is
-- the MEASURED number behind the public "every feed is re-verified within a
-- few hours" claim — published on the Ghost Job Index and watched by the
-- heartbeat, so the claim can never silently drift from reality again (the
-- catalog grew 70% in rung 3 and rotation slipped from ~1h to ~3h with no
-- alarm; the adaptive rotation SLA followed the drift instead of flagging it).
CREATE OR REPLACE FUNCTION public.get_freshness_stats()
RETURNS TABLE (boards integer, p50_min numeric, p95_min numeric, max_min numeric)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public
SET statement_timeout = '20s'
AS $$
  SELECT
    count(*)::int AS boards,
    round((percentile_cont(0.5) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (now() - verified_at)) / 60.0))::numeric, 1) AS p50_min,
    round((percentile_cont(0.95) WITHIN GROUP (
      ORDER BY EXTRACT(EPOCH FROM (now() - verified_at)) / 60.0))::numeric, 1) AS p95_min,
    round((max(EXTRACT(EPOCH FROM (now() - verified_at)) / 60.0))::numeric, 1) AS max_min
  FROM public.job_board_verifications;
$$;
GRANT EXECUTE ON FUNCTION public.get_freshness_stats() TO anon, authenticated;
