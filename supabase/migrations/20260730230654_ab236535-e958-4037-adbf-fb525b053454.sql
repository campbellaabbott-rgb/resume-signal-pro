CREATE OR REPLACE FUNCTION public.get_email_health(p_hours_back INTEGER DEFAULT 24)
RETURNS TABLE(
  total_emails BIGINT,
  successful_emails BIGINT,
  failed_emails BIGINT,
  success_rate NUMERIC,
  recent_emails JSONB
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  WITH stats AS (
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'sent') as success,
      COUNT(*) FILTER (WHERE status = 'failed') as failed
    FROM public.email_logs
    WHERE created_at > now() - (p_hours_back || ' hours')::INTERVAL
  ),
  recent AS (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'id', id,
        'email_type', email_type,
        'recipient',
          CASE
            WHEN recipient IS NULL OR position('@' in recipient) = 0 THEN '***'
            ELSE left(split_part(recipient, '@', 1), 2) || '***@' || split_part(recipient, '@', 2)
          END,
        'status', status,
        'error_message', error_message,
        'created_at', created_at
      ) ORDER BY created_at DESC
    ), '[]'::jsonb) as emails
    FROM (
      SELECT * FROM public.email_logs
      ORDER BY created_at DESC
      LIMIT 10
    ) e
  )
  SELECT
    stats.total,
    stats.success,
    stats.failed,
    ROUND((stats.success::NUMERIC / NULLIF(stats.total, 0) * 100), 1),
    recent.emails
  FROM stats, recent;
END;
$$;

COMMENT ON FUNCTION public.get_email_health(integer) IS
  'Email delivery health. Recipient addresses are MASKED (xx***@domain) — this is reachable by anon and the raw address is never needed for a health check.';