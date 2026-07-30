-- get_email_health hands real customer email addresses to anonymous callers.
--
-- FOUND BY: a sweep agent, after I had already audited this surface and cleared
-- it. My audit asked "is this function called from a hand-written frontend
-- file?" and treated yes as "the browser is meant to reach it". get_email_health
-- is called from src/pages/HealthCheck.tsx, so it passed.
--
-- That test was wrong. An ADMIN dashboard is frontend code too. "A page calls
-- it" answers a different question from "an anonymous stranger should be able to
-- call it" — and /health-check turns out to have no auth gate at all, so in this
-- case both answers were bad.
--
-- Verified live with the publishable key:
--     POST /rest/v1/rpc/get_email_health {}
--     -> 200, recent_emails[].recipient contained 2 distinct real addresses,
--        alongside email_type, status, error_message and created_at.
--
-- I then probed the other fifteen ops/health functions the same way and counted
-- email addresses in each response. Only this one returns any: the rest are
-- aggregate counters with no user data in them. So this is a narrow defect, not
-- a category one, and it gets a narrow fix.
--
-- THE FIX IS REDACTION, NOT A REVOKE. A health dashboard needs to know that a
-- purchase email failed and roughly who it was for; it does not need the
-- address. Masking removes the exposure no matter who ends up able to call the
-- function, which is worth more than a permission grant I cannot test from here
-- (I have no way to exercise a signed-in admin session).
--
-- NOT FIXED HERE, and worth a decision: /health-check is a public route with no
-- auth gate, so anyone can load the ops dashboard and read delivery counts,
-- error rates and funnel numbers. That is operational information rather than
-- user data, and gating it is a product call — not something to change silently
-- inside a migration about PII.
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
        -- Masked: first two characters, then the domain. Enough to recognise a
        -- test send or spot that a whole domain is bouncing; not enough to
        -- harvest an address. split_part on '@' is safe for the malformed and
        -- empty values that inevitably reach a log table.
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
