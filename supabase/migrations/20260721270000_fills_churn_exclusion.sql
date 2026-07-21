-- Explore believability: "Companies that actually fill roles" and "Serial
-- re-posters" OVERLAPPED (Hibu was #1 filler AND #3 reposter; ALTEN in both) —
-- self-contradictory on its face. Measured live: Hibu 117 fills vs 257 repost
-- events (69% churn), ALTEN 74%, METRO/MAKRO 61%, Securitas 57%. A company
-- whose takedowns are mostly re-listings runs churn machinery that
-- contaminates its "fills" (relists under varied titles evade the same-title
-- superseded check), so it cannot honestly rank as a genuine filler. Rule:
-- companies with more superseded (re-list) events than genuine fills are
-- DISQUALIFIED from the fills list. The two lists become disjoint in practice:
-- churn-dominated boards appear only under Serial re-posters.
--
-- Also in this migration:
--  * sggovterp~wd102~PublicServiceCareers purged: Singapore Public Service
--    Careers is a GOVERNMENT board — violates the corporate-only catalog rule
--    (removed from sources.ts in the same commit so it cannot re-ingest).
--  * gsknch -> GSK (tenant path is GSKCareers; postings are GSK sites).

DROP FUNCTION IF EXISTS public.get_actively_hiring_companies(int);
CREATE FUNCTION public.get_actively_hiring_companies(p_limit int DEFAULT 20)
RETURNS TABLE (company text, company_token text, closed_90d bigint, open_roles bigint, tracking_days int)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
SET statement_timeout = '15s'
AS $$
  WITH span AS (
    SELECT LEAST(GREATEST(EXTRACT(DAY FROM now() - min(closed_at))::int, 1), 30) AS days
    FROM public.job_board_closures
  ),
  fills AS (
    SELECT c.company_token, max(c.company) AS company,
           count(*) FILTER (
             WHERE NOT c.superseded
               AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
           ) AS filled,
           count(*) FILTER (WHERE c.superseded) AS churn
    FROM public.job_board_closures c
    WHERE c.closed_at > now() - interval '30 days'
      AND c.company <> ''
    GROUP BY c.company_token
    HAVING count(*) FILTER (
             WHERE NOT c.superseded
               AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
           ) >= 3
       -- churn-domination disqualifier: more re-list events than genuine fills
       AND count(*) FILTER (WHERE c.superseded)
           <= count(*) FILTER (
                WHERE NOT c.superseded
                  AND c.closed_at - COALESCE(c.posted_at, c.first_seen) >= interval '7 days'
              )
    ORDER BY 3 DESC
    LIMIT GREATEST(p_limit, 1) * 3   -- headroom: some drop below on the open-roles gate
  )
  SELECT f.company, f.company_token, f.filled AS closed_90d, o.n AS open_roles,
         (SELECT days FROM span) AS tracking_days
  FROM fills f
  JOIN LATERAL (
    SELECT count(*) AS n FROM public.job_board_postings p WHERE p.company_token = f.company_token
  ) o ON true
  WHERE o.n > 0
  ORDER BY f.filled DESC, o.n DESC
  LIMIT GREATEST(p_limit, 1);
$$;
GRANT EXECUTE ON FUNCTION public.get_actively_hiring_companies(int) TO anon, authenticated;

-- Government board purge (catalog entry removed in the same commit).
DELETE FROM public.job_board_postings WHERE company_token = 'sggovterp~wd102~PublicServiceCareers';
DELETE FROM public.job_board_closures WHERE company_token = 'sggovterp~wd102~PublicServiceCareers';
DELETE FROM public.job_board_company_snapshots WHERE company_token = 'sggovterp~wd102~PublicServiceCareers';

-- gsknch is GSK (tenant GSKCareers). Trigger keeps it durable on re-ingest.
INSERT INTO public.company_name_overrides (slug, display_name) VALUES ('gsknch','GSK')
ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name;
UPDATE public.job_board_postings p SET company = 'GSK'
 WHERE split_part(p.company_token,'~',1) = 'gsknch' AND p.company <> 'GSK';
UPDATE public.job_board_closures c SET company = 'GSK'
 WHERE split_part(c.company_token,'~',1) = 'gsknch' AND c.company <> 'GSK';
UPDATE public.job_board_company_snapshots s SET company = 'GSK'
 WHERE split_part(s.company_token,'~',1) = 'gsknch' AND s.company <> 'GSK';

-- Immediate display fixes whose durable authority is sources.ts (same commit):
-- the refresh re-applies these names; the UPDATE just makes them instant.
UPDATE public.job_board_postings SET company = 'Remote.com'  WHERE company_token = 'remotecom'  AND company <> 'Remote.com';
UPDATE public.job_board_closures SET company = 'Remote.com'  WHERE company_token = 'remotecom'  AND company <> 'Remote.com';
UPDATE public.job_board_company_snapshots SET company = 'Remote.com' WHERE company_token = 'remotecom' AND company <> 'Remote.com';
UPDATE public.job_board_postings SET company = '10,000 Black Interns' WHERE company_token = '10kbi' AND company <> '10,000 Black Interns';
UPDATE public.job_board_closures SET company = '10,000 Black Interns' WHERE company_token = '10kbi' AND company <> '10,000 Black Interns';
UPDATE public.job_board_company_snapshots SET company = '10,000 Black Interns' WHERE company_token = '10kbi' AND company <> '10,000 Black Interns';

DO $$
BEGIN
  SET LOCAL statement_timeout = '40s';
  PERFORM public.refresh_explore_cache();
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;
