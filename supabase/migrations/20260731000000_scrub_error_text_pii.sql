-- STAMPED 20260731 ON PURPOSE, and the reason is a trap worth knowing about.
--
-- This was first written as 20260730090000. The deploy re-stamps each migration
-- it applies with the WALL-CLOCK TIME OF APPLICATION and commits that copy back
-- to the repo — so my 20260730080000 returned as 20260730230654, which sorts
-- AFTER 090000. Both files CREATE OR REPLACE get_email_health, so in filename
-- order the older, unscrubbed body would run last and silently undo this fix.
--
-- Production is fine either way this time, because application order is what
-- counts there and this is applied after. But anything rebuilt from the
-- migration set in filename order — a fresh project, a local CLI stack — would
-- have reverted. Renaming past the re-stamp is what makes the file order and
-- the intent agree.
--
-- My own guard caught this at pre-push, which is the only reason it was not
-- shipped: it checks the LAST definition by filename, so it saw the re-stamped
-- copy and refused.
--
-- Masking the recipient column was not enough: the address is in the error text too.
--
-- 20260730080000 masked get_email_health's `recipient` to xx***@domain. Verified
-- live afterwards and the payload STILL contained a full address — in
-- `error_message`, because the provider writes it into its own error copy:
--
--   "You can only send testing emails to your own email address
--    (someone@example.com). To send emails to other recipients, please verify
--    a domain at resend.com/..."
--
-- Three of the ten most recent records carried it. So the first fix reduced the
-- count of exposed addresses and did not stop the exposure, which is the kind of
-- half-fix that reads as done.
--
-- THE GENERAL LESSON, and the reason this migration exists as its own thing:
-- redacting a STRUCTURED column does nothing about FREE TEXT that happens to
-- contain the same value. Anywhere a third party's message is stored and shown,
-- assume it can contain whatever it was told — an address, an id, a name — and
-- scrub the text itself rather than the field you were thinking about.
--
-- A helper is used rather than an inline expression so the other anon-reachable
-- functions with free-text error columns can adopt it — get_error_diagnostics,
-- get_parse_failure_stats and get_visitor_error_history all expose one. Those
-- returned no addresses when I probed them, but that was a sample taken at one
-- moment with few errors present; it is not evidence that they never will.
CREATE OR REPLACE FUNCTION public.scrub_emails(p_text text)
RETURNS text
LANGUAGE sql IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_text IS NULL THEN NULL
    ELSE regexp_replace(
      p_text,
      -- Deliberately broad. A pattern that misses is worse than one that
      -- occasionally over-matches inside an error string nobody parses.
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
        -- First two characters, then the domain: enough to recognise a test
        -- send or spot a whole domain bouncing, not enough to harvest.
        'recipient',
          CASE
            WHEN recipient IS NULL OR position('@' in recipient) = 0 THEN '***'
            ELSE left(split_part(recipient, '@', 1), 2) || '***@' || split_part(recipient, '@', 2)
          END,
        'status', status,
        -- The provider's own text, with any address stripped out.
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
  'Email delivery health. Recipient addresses are masked AND error text is scrubbed — the provider writes the address into its own error copy, so masking the column alone left it exposed.';
