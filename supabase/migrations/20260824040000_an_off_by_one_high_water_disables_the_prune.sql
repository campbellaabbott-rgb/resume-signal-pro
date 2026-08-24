-- AN OFF-BY-ONE IN THE HIGH-WATER MARK DISABLES THE ORPHAN PRUNE ENTIRELY.
--
-- The stale-bundle guard reads:
--     if (JOB_SOURCES.length < highwater) -> skip the orphan prune
-- It is a STRICT less-than against a hand-typed number, so a high-water one
-- larger than the real catalog does not degrade the prune, it turns it off.
--
-- The demo-sandbox migration set the mark to LEAST(stored, 31709) after
-- removing 111 boards. The real post-removal catalog is 31,708 — the 31,709
-- came from a looser regex count than the one the bundle itself uses. Two
-- independent measurements agree on 31,708 (2026-08-24): the deployed
-- function's own status payload reports catalogSize 31708, and counting both
-- registry entry formats the way the catalog is built gives 11,985 + 19,723.
--
-- So every refresh pass since that deploy has logged "orphan prune SKIPPED"
-- and left removed boards' postings in place. Nothing was lost — the prune
-- only deletes, and the boards removed so far had their rows deleted by
-- their own migrations — but the mechanism that makes a board removal
-- actually disappear has been off, and the next removal would linger.
--
-- job_board_meta is service-role-only (correctly), so this cannot be
-- confirmed by reading the row from outside; it is deterministic from the
-- pre-removal catalog size, which was larger than 31,709 in every deploy
-- this month. LEAST makes the correction idempotent AND a no-op in the case
-- where the stored value was already right, which is the honest way to
-- write a fix you cannot pre-verify: it cannot make a correct value wrong.
--
-- The mark still rises on its own the moment a larger catalog deploys, so
-- this number does not need maintaining. A guard test now asserts that no
-- high-water literal in any migration exceeds the catalog the bundle
-- actually carries, which is the check that would have caught this.

UPDATE public.job_board_meta
SET v = jsonb_set(v, '{size}', to_jsonb(LEAST((v->>'size')::int, 31708))),
    updated_at = now()
WHERE k = 'catalog_highwater';
