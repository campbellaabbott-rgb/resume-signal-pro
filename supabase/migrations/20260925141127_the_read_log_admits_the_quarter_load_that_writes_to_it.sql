-- THE READ LOG ADMITS THE QUARTER LOAD THAT WRITES TO IT.
--
-- public.layoff_read_log is the ledger the heartbeat reads instead of the
-- function logs: one row per run, naming what was fetched, what was kept, what
-- was new, whether it worked and how long it took. Its kind column is barred to
-- a fixed list, and the deployed layoff-filings function has grown one more run
-- to record -- the once-a-quarter load of the Department's certified H-1B wage
-- cells into public.oflc_lca_wages, carried in the function's own bundle
-- because its writer is service_role only and no service-role key exists
-- outside the platform.
--
-- A row refused by the bar is not a small thing here. The load is a single
-- manual POST after a deploy, it replaces a whole quarter, and the log row is
-- the only durable record that it ran, how many cells it wrote and which
-- quarter they came from. If the insert is refused the function swallows the
-- error by design (a failed log must never fail a load that already succeeded),
-- so the load would look fine and leave no trace at all.
--
-- WHY THE LIST IS REBUILT RATHER THAN EXTENDED. A CHECK constraint holds an
-- expression, not a set, so there is nothing to append to: the widening drops
-- whichever kind constraint is present and writes the whole list again. The
-- list is therefore spelled once, in the statement below, and every kind the
-- function has ever written has to appear in it -- the guard beside the
-- function reads this file and the function's own union of kinds and requires
-- the two to agree, so a kind added to the code without a migration fails
-- before it can be refused in production.
--
-- Idempotent: it drops the bar it owns and the membership test it supersedes,
-- by name or by the shape Postgres prints them in, so applying it twice leaves
-- one constraint rather than two, and applying it to a database that never saw
-- the mirror widening produces the same result as applying it to one that did.
-- It does NOT drop every check that happens to mention the column: a later
-- unrelated rule about the same column survives this file being re-applied.
--
-- No function is defined here. This is a constraint, and the writer it admits
-- rows for already exists (20260923114719).

SET LOCAL statement_timeout = '5min';

DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('public.layoff_read_log') IS NULL THEN
    RAISE NOTICE 'layoff_read_log is absent here; the kind check was not widened';
    RETURN;
  END IF;
  -- ONLY THE BAR THIS MIGRATION OWNS AND THE ONE IT SUPERSEDES. Matching every
  -- check whose definition merely mentions the column would silently delete a
  -- later, unrelated rule about the same column -- and this file is
  -- deliberately re-appliable, so it would delete it again on every run. The
  -- lane-A table declared its bar inline (an auto-named check on the column
  -- whose definition is the membership test), and the mirror widening named
  -- one; both shapes are matched, nothing else is.
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.layoff_read_log'::regclass
       AND c.contype = 'c'
       AND (
             c.conname = 'layoff_read_log_kind_check'
             OR pg_get_constraintdef(c.oid) ~ 'CHECK \(\(kind = ANY \(ARRAY\['
           )
  LOOP
    EXECUTE format('ALTER TABLE public.layoff_read_log DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.layoff_read_log
    ADD CONSTRAINT layoff_read_log_kind_check
    CHECK (kind IN ('edgar_atom', 'edgar_fts_audit', 'edgar_backfill', 'warn', 'matcher', 'partition', 'mirror', 'lca_wages'));
END $$;

-- Self-check: the constraint exists and admits the new run, and the eight kinds
-- are all the column takes. A migration that claims a widening it did not make
-- is worse than none, because the next deploy stops looking.
DO $$
DECLARE
  def text;
BEGIN
  IF to_regclass('public.layoff_read_log') IS NULL THEN
    RETURN;
  END IF;
  SELECT pg_get_constraintdef(c.oid) INTO def
    FROM pg_constraint c
   WHERE c.conrelid = 'public.layoff_read_log'::regclass AND c.conname = 'layoff_read_log_kind_check';
  IF def IS NULL THEN
    RAISE EXCEPTION 'layoff_read_log has no kind check after the widening';
  END IF;
  IF def NOT LIKE '%lca_wages%' THEN
    RAISE EXCEPTION 'layoff_read_log kind check does not admit the wage-load kind: %', def;
  END IF;
  IF def NOT LIKE '%mirror%' OR def NOT LIKE '%matcher%' OR def NOT LIKE '%partition%'
     OR def NOT LIKE '%edgar_atom%' OR def NOT LIKE '%edgar_fts_audit%'
     OR def NOT LIKE '%edgar_backfill%' OR def NOT LIKE '%warn%' THEN
    RAISE EXCEPTION 'the widening dropped a kind the poller already writes: %', def;
  END IF;
END $$;

COMMENT ON COLUMN public.layoff_read_log.kind IS
  'Which run wrote this row: the EDGAR reads, the WARN read, the matcher, the partition writer, the '
  'catalogue mirror, and the once-a-quarter load of the certified wage cells the deploy carries. '
  'Barred to that list so an unnamed writer cannot quietly start logging under a kind no heartbeat '
  'reads.';
