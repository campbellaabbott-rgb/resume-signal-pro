-- ONE REQUISITION IS ONE POSTING, ACROSS A TENANT'S CAREER SITES.
--
-- A Workday tenant runs several career sites (external, subsidiary, campus,
-- per-language), the same requisition appears on more than one, and Workday's
-- own "-1"/"-2" discriminator makes the ids differ so nothing dedupes them.
-- Measured 2026-08-23 over all 295,823 Workday postings: 8,993 requisition
-- groups span more than one site of a tenant, contributing 9,246 redundant
-- postings — 99.9% with byte-identical titles, 100% identical locations.
-- Boeing JR2025489859 on two sites; one Allegion requisition on five language
-- sites; up to 54% of a single employer's board was the same jobs twice.
--
-- THE SUFFIXED COPY IS THE DUPLICATE. The original carries the bare
-- requisition id; the cross-site copies carry the discriminator. This deletes
-- a suffixed row only when the unsuffixed requisition exists somewhere in the
-- SAME tenant — and only when the stem left after stripping still contains
-- three digits, because a naive strip turns Brighthorizons' JR-134112 into
-- "JR" and over-merges sixty thousand rows. The digit-stem guard is
-- load-bearing.
--
-- A HARD DELETE, DELIBERATELY NOT THE ABSENCE MACHINERY. Routing these
-- through the prune would two-pass them into missing_since and write 9,246
-- fictional closure events into the lifecycle log — the one dataset this
-- board treats as its uncopyable asset. A migration delete touches nothing
-- but the rows.
--
-- The ingest path skips NEW cross-site copies from the same commit, so the
-- population this removes does not rebuild. Idempotent: on a second run the
-- suffixed rows are gone and the join matches nothing.

WITH w AS (
  SELECT id,
         split_part(company_token, '~', 1) AS tenant,
         split_part(id, ':', 3)            AS req
  FROM public.job_board_postings
  WHERE source = 'workday'
),
dupes AS (
  SELECT d.id
  FROM w d
  JOIN w k
    ON k.tenant = d.tenant
   AND k.req = regexp_replace(d.req, '-\d{1,2}$', '')
  WHERE d.req ~ '-\d{1,2}$'
    AND regexp_replace(d.req, '-\d{1,2}$', '') ~ '\d{3}'
    AND k.id <> d.id
)
DELETE FROM public.job_board_postings
WHERE id IN (SELECT id FROM dupes);
