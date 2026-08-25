-- A LOGIN PAGE IS NOT A JOB FEED.
--
-- 11 board failures reported `Unexpected token '<', "<!DOCTYPE "...`, which
-- reads like a bug in our parser. Probed 2026-08-24: every one is a BambooHR
-- tenant answering 302 -> /login.php on its careers list. The employers turned
-- public access off. We use public feeds only and never authenticate, so this
-- is a terminal state for the board rather than a transient error.
--
-- 10 distinct tokens, ALL HOLDING ZERO POSTINGS — nothing is deleted with
-- them, which is why this migration only moves the high-water mark. They are
-- removed from the registry so they stop consuming a fetch slot every
-- rotation and stop filling the failure list.
--
-- THE HIGH-WATER MARK MOVES BECAUSE THE CATALOG SHRANK. The stale-bundle
-- guard is a STRICT less-than, so leaving the mark above the catalog would
-- disable the orphan prune entirely — the off-by-one that shipped earlier
-- today. New catalog size is 31,621.
--
-- The fetcher now names this case directly ("careers list is not public
-- (redirected to /login.php)") instead of surfacing a JSON parser's
-- complaint, so the next one is one line to diagnose rather than a probe.

UPDATE public.job_board_meta
SET v = jsonb_set(v, '{size}', to_jsonb(LEAST((v->>'size')::int, 31621))),
    updated_at = now()
WHERE k = 'catalog_highwater';