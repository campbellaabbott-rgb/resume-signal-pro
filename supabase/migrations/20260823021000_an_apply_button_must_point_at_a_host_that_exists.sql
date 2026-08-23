-- AN APPLY BUTTON MUST POINT AT A HOST THAT EXISTS.
--
-- Recruitee lets an employer serve their board from a vanity domain, and the
-- feed reports it as careers_url. The normalizer preferred it over the
-- vendor's canonical host — which sat right beside it as the fallback. A
-- vanity domain is a hostname the employer once configured and can abandon,
-- and 58 of them did: measured 2026-08-23, 47 hosts no longer resolve and 11
-- more fail TLS, stranding 233 servable postings behind an Apply button that
-- cannot load. One was not even a valid hostname (careers.ferillis, no TLD).
-- The canonical form answered HTTP 200 for every single one of the 233.
--
-- The normalizer now emits the canonical whenever a slug exists (same
-- commit). This backfill rewrites the rows already stored: every recruitee
-- posting whose apply_url is on a non-canonical host but carries the /o/{slug}
-- path the canonical needs. Rows already canonical are excluded by predicate;
-- rows with no /o/ path (none observed) are left untouched rather than
-- guessed at.
--
-- Idempotent: after one pass the predicate matches nothing.

UPDATE public.job_board_postings
SET apply_url = 'https://' || company_token || '.recruitee.com/o/'
                || split_part(apply_url, '/o/', 2)
WHERE source = 'recruitee'
  AND apply_url LIKE '%/o/%'
  AND apply_url NOT LIKE 'https://' || company_token || '.recruitee.com/%';
