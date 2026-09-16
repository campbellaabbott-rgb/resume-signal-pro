-- THE PASS IS JUDGED BY ITS OWN NUMBERS — so the reader exists before anyone judges.
--
-- Adoption readers for the public API were still not built two weeks after
-- it shipped (project_public_data_api), and every judgement of uptake since
-- has been a guess. This one lands WITH the product: a single service-role
-- RPC that answers the questions SPEC section 8 says decide the pass's
-- future, over the last p_days. The owner runs it through Lovable's agent
-- (no service key in hand).
--
-- The one number that must be re-decided from data is the shelf life of an
-- unactivated pass (a guess with no measured basis): activation_lag_p50 and
-- _p95 minutes, over the passes that activated, are what decide it after
-- the first fifty. unactivated_backlog is all-time, not windowed — a pass
-- waiting to be activated is a fact about now.
--
-- calls_total / moat_calls_total / calls_per_pass_median join api_usage to
-- the pass through the key's user_id (the overlay is by user, so a rotation
-- mid-pass keeps counting) and bound the days to the pass's own activation
-- window. moat = get_jobs + get_job per pass: the deep reads a scraper
-- cannot do without the closure ledger.
--
-- OUT names collide with no column of any table read here (the 42702
-- trap). Every table carries an alias. Nothing here is written except
-- through the shared lazy close, so a pass that ended a minute ago is
-- counted as closed rather than open.

CREATE OR REPLACE FUNCTION public.agent_pass_metrics(p_days integer)
RETURNS TABLE (
  window_days integer,
  passes_sold bigint,
  sessions_claimed bigint,
  passes_activated bigint,
  activation_lag_p50_minutes numeric,
  activation_lag_p95_minutes numeric,
  unactivated_backlog bigint,
  shelf_expired_unused bigint,
  activated_via_key bigint,
  activated_via_oauth bigint,
  calls_total bigint,
  moat_calls_total bigint,
  calls_per_pass_median numeric,
  applications_queued bigint,
  applications_submitted bigint,
  applications_refunded bigint,
  passes_exhausted bigint,
  passes_closed_unused bigint,
  second_day_returns bigint,
  paid_undelivered bigint
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_days integer := greatest(coalesce(p_days, 1), 1);
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_days, 1), 1));
BEGIN
  -- The shared lazy close, for every user at once: the reader must not
  -- count a session that ended as still open.
  UPDATE public.agent_passes ap
     SET closed_at = now(),
         close_reason = CASE WHEN ap.activated_at IS NULL THEN 'shelf_expired' ELSE 'session_ended' END
   WHERE ap.closed_at IS NULL
     AND coalesce(ap.expires_at, ap.shelf_expires_at) <= now();

  RETURN QUERY
  WITH sold AS (
    SELECT ap.* FROM public.agent_passes ap WHERE ap.purchased_at >= v_since
  ),
  activated AS (
    SELECT ap.* FROM public.agent_passes ap WHERE ap.activated_at IS NOT NULL AND ap.activated_at >= v_since
  ),
  per_pass_calls AS (
    SELECT a.id AS pid,
           sum(u.calls)::bigint AS n_calls,
           sum(u.calls) FILTER (WHERE u.endpoint IN ('/mcp/get_jobs', '/mcp/get_job'))::bigint AS n_moat
      FROM activated a
      JOIN public.api_keys ak ON ak.user_id = a.user_id
      JOIN public.api_usage u ON u.key_id = ak.id
       AND u.day BETWEEN (a.activated_at AT TIME ZONE 'utc')::date AND (coalesce(a.expires_at, a.activated_at) AT TIME ZONE 'utc')::date
       AND u.endpoint LIKE '/mcp/%'
     GROUP BY a.id
  ),
  returns AS (
    SELECT s.id AS pid
      FROM sold s
      JOIN public.api_keys ak ON ak.user_id = s.user_id
      JOIN public.api_usage u ON u.key_id = ak.id
       AND u.day BETWEEN (s.purchased_at AT TIME ZONE 'utc')::date AND (s.purchased_at AT TIME ZONE 'utc')::date + 14
       AND u.endpoint LIKE '/mcp/%'
     GROUP BY s.id
    HAVING count(DISTINCT u.day) >= 2
  )
  SELECT
    v_days,
    (SELECT count(*) FROM sold s),
    (SELECT count(*) FROM public.used_stripe_sessions us
      WHERE us.product_type = 'agent_pass' AND us.used_at >= v_since),
    (SELECT count(*) FROM activated a),
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (a.activated_at - a.purchased_at)) / 60)
       FROM activated a)::numeric,
    (SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY extract(epoch FROM (a.activated_at - a.purchased_at)) / 60)
       FROM activated a)::numeric,
    (SELECT count(*) FROM public.agent_passes ap WHERE ap.activated_at IS NULL AND ap.closed_at IS NULL),
    (SELECT count(*) FROM public.agent_passes ap
      WHERE ap.close_reason = 'shelf_expired' AND ap.closed_at >= v_since),
    (SELECT count(*) FROM activated a WHERE a.activated_via = 'key'),
    (SELECT count(*) FROM activated a WHERE a.activated_via LIKE 'oauth:%'),
    (SELECT coalesce(sum(pc.n_calls), 0) FROM per_pass_calls pc)::bigint,
    (SELECT coalesce(sum(pc.n_moat), 0) FROM per_pass_calls pc)::bigint,
    (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY coalesce(pc.n_calls, 0))
       FROM activated a LEFT JOIN per_pass_calls pc ON pc.pid = a.id)::numeric,
    (SELECT count(*) FROM public.agent_queue q
      WHERE q.pass_id IS NOT NULL AND q.created_at >= v_since),
    (SELECT count(*) FROM public.agent_submissions sb
      WHERE sb.pass_id IS NOT NULL AND sb.status = 'submitted' AND sb.created_at >= v_since),
    (SELECT count(*) FROM public.agent_submissions sb
      WHERE sb.pass_refunded_at IS NOT NULL AND sb.pass_refunded_at >= v_since),
    (SELECT count(*) FROM sold s WHERE s.applications_used >= s.applications_total),
    (SELECT count(*) FROM public.agent_passes ap
      WHERE ap.closed_at IS NOT NULL AND ap.closed_at >= v_since AND ap.applications_used = 0),
    (SELECT count(*) FROM returns r),
    (SELECT count(*) FROM public.product_deliveries pd
      WHERE pd.product_type = 'agent_pass' AND pd.status = 'generation_failed' AND pd.created_at >= v_since);
END;
$$;

-- SERVICE ROLE ONLY. It reads purchase, key and usage tables as DEFINER.
-- REVOKE by name from PUBLIC, anon and authenticated in the same file
-- (project_definer_exposure).
REVOKE ALL ON FUNCTION public.agent_pass_metrics(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.agent_pass_metrics(integer) TO service_role;
