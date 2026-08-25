-- A SEARCH LOG WITHOUT A CLOCK CANNOT FIND A SLOW TIER.
--
-- job_board_search_events records which route answered and how many rows it
-- returned, but never how long it took — so with several retrieval tiers
-- (ranked, recency, exact-word, fuzzy, semantic) nobody could see which one
-- is expensive across real traffic.
--
-- It matters now. Measured from outside 2026-08-25: a trivial action on the
-- function answers in ~300ms and a plain REST round trip is ~200-400ms, so
-- there is no cold-start floor to blame — yet q=nurse costs 2.8-3.0s warm and
-- a twelve-query battery ran p50 3.8s, p90 5.3s. Search is the product's core
-- interaction and roughly 2.4 seconds is unaccounted for.
--
-- Nullable and defaulted, so the insert keeps working on rows written by any
-- older bundle still in flight.

ALTER TABLE public.job_board_search_events
  ADD COLUMN IF NOT EXISTS took_ms integer;

-- Reading latency by route is the whole point; without this the query is a
-- sequential scan over a growing events table.
CREATE INDEX IF NOT EXISTS job_board_search_events_route_took_idx
  ON public.job_board_search_events (route, took_ms);
