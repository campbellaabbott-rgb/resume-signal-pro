CREATE OR REPLACE FUNCTION public.scrub_emails(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_text IS NULL THEN NULL
    ELSE regexp_replace(
      p_text,
      '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
      '[email redacted]',
      'g'
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.scrub_emails(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scrub_emails(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.scrub_emails(text) IS
  'Removes email addresses from free text before it is exposed. Use on any provider-supplied error message that reaches an anon-reachable surface.';

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
        'error_message', public.scrub_emails(error_message),
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
  'Email delivery health. Recipient addresses are masked AND error text is scrubbed.';