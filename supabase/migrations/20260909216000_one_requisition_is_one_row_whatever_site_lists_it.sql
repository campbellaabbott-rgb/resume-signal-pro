-- ONE REQUISITION IS ONE ROW, WHATEVER SITE LISTS IT.
--
-- THE FINDING (verified live 2026-09-09, anon list calls, exact per-token
-- totals). An Oracle Recruiting Cloud tenant publishes the SAME requisition on
-- several "career sites" -- CX_1, CX_3, CX_1001 -- and the catalog carries
-- each site as its own token. The posting id is oracle:<token>:<reqId>, so
-- nothing deduped across sites and every mirror stored a full second copy:
--
--   Clean Harbors  epyc~us2~CX_1 (EN) 703   epyc~us2~CX_3 (FR) 703
--                  200 of 200 sampled requisition ids identical, same order.
--   Cummins        seven audience views of one ~710-requisition tenant
--                  (Technicians 707, All Functions 706, DEI 706, Veterans 706
--                  ...); 200/200 of "Women in Manufacturing" inside All Functions.
--   Hearst         CX, CX_1, CX_14001: 148 = 148 = 148, exact 148/148 overlap.
--   Tremco (RPM)   CX_6 66 vs CX_5001 "French" 66: exact 66/66.
--
-- Every duplicate row inflates that employer's open count, the field facets
-- and any per-employer rate. 723 of the catalog's 1,343 Oracle tokens sit on
-- multi-site tenants (160 tenants).
--
-- THE ESTIMATE THIS FILE MUST NOT TRUST. From a 9-tenant / 32-token sample:
-- ~23,000 duplicate SERVABLE rows board-wide, defensible range 12,000-52,000
-- (~1.5-6% of the 810k servable). Tracked rows run ~16% above servable and
-- the same tenants' missing_since rows duplicate the same way, so this sweep
-- should expect roughly 15-20% MORE than the servable figure: point ~27,000,
-- range ~14,000-60,000. The sample cannot confirm above ~30,000 servable. A
-- DESTRUCTIVE PATH COMPUTES ITS OWN INPUT: the function below never reads
-- these numbers. It groups the live table by (tenant, reqId) itself and
-- reports what it found, so the figure that gets published is the measured
-- one, not this one.
--
-- THE RULE IS PER (tenant, reqId), NEVER PER SITE NAME. The same sample
-- refuted every name-based shortcut: "French" sites were exact mirrors at
-- Clean Harbors and Tremco and DISJOINT at Chartwell (its own reqIds, 0/102
-- overlap) and Penske (0/3); eexs' "All" site was NOT a superset of its "All
-- Community" site (19 of 78 reqs unique to the latter); Coherent's country
-- sites overlap 0/61; Tenet's subsidiaries 0/14. Five of nine tenants had at
-- least one sub-site with zero overlap, and every one of those rows must
-- survive. So: sites are RANKED (job-board/index.ts ORACLE_SITE_RANK, from
-- catalog order plus sources.ts ORACLE_CANONICAL_SITES), a requisition is kept
-- ONCE under the best-ranked site holding it, and a requisition held by no
-- better-ranked site is simply kept where it is. This file applies exactly
-- that rule to rows already stored; the ingest applies it to every visit from
-- 2026-09-09.68 on.
--
-- WHY THE RANK TABLE IS READ FROM job_board_meta AND NOT WRITTEN HERE. The
-- ingest and this sweep must agree on the keeper or they would move a
-- tenant's rows back and forth between sites forever. The ingest publishes
-- its table to job_board_meta.oracle_site_rank on every pass (hash-gated);
-- this file SEEDS the same key with the same table (generated from the same
-- helper over the same sources.ts, hash 508846df9725cd0e) so the sweep can
-- start before the .68 bundle serves, and never overwrites a fresher one.
--
-- THE EXIT REASON IS OURS. A row this sweep removes was NOT taken down by the
-- employer: the requisition is still open, on a sibling site we now store it
-- under. It leaves through job_board_exits under 'untracked' -- the reason a
-- board removed from the catalog already uses (CHECK in 20260817222407) --
-- and NEVER through job_board_closures: no closed_at, no absence_basis,
-- nothing get_company_fill_curve or the closure population can count as a
-- fill. The growth clock (20260909212000) books these as
-- departures_untracked, a gross column that is never netted against
-- arrivals; the ageout arm (20260908137000) treats 'untracked' as censoring,
-- not an event. A reader that sees a burst of departures_untracked on Oracle
-- boards dated today is seeing this sweep, and the row says so.
--
-- SHAPE OF THE WORK, AND WHY IT IS BATCHED.
--   1. job_board_postings.req_key (nullable text): oracle:<tenant>:<reqId>,
--      written by the .68 ingest on every new Oracle row and backfilled here
--      from the id for rows already stored. Taken with the lock-retry pattern
--      of 20260909010000; a nullable column with no default rewrites nothing.
--   2. A PARTIAL btree on req_key WHERE req_key IS NOT NULL, built
--      CONCURRENTLY by a one-minute pg_cron job because CREATE INDEX
--      CONCURRENTLY cannot run inside this transaction (the undated-draw
--      precedent, 20260817154614) -- with a watcher that unschedules BOTH jobs
--      once the index is valid, so nothing runs every minute forever
--      (20260817230000's lesson). The ingest's holder lookup and the verify
--      pass both need this index; the sweep refuses to enter its delete phase
--      until it exists and is valid.
--   3. repair_oracle_subsite_duplicates(p_max_rows): a state machine in
--      job_board_meta.oracle_subsite_repair -- backfill (per token, by the
--      company_token index) -> dedupe (per tenant: group by req_key, keep the
--      best rank, exit and delete the rest, at most p_max_rows deletes per
--      call) -> verify (recount duplicates over the whole table; loop back if
--      the old bundle wrote key-less rows meanwhile) -> done. Every call is
--      its own short transaction under an advisory lock, holds row locks
--      only on the rows it deletes, and is idempotent: re-running a finished
--      sweep is a no-op that re-reports its counts.
--   4. A two-minute pg_cron job drives it and is unscheduled by the function
--      itself when it reaches 'done'.
--   5. THE HIGH-WATER MARK. sources.ts shrinks 44,542 -> 44,519 in .68 (19
--      dev/test-tenant tokens: eodr-dev5 x4, fa-exrr-dev2 x8, efzu-dev8,
--      hdbt-dev1, iaasbk-dev1, iazmqy-dev2 x2, ibwsjb-dev2, fa-exdu-dev2;
--      plus 4 measured pure mirrors: epyc CX_3, eevd CX_1 and CX_14001, hcwx
--      CX_5001). The orphan prune is what exits their rows -- as 'untracked'
--      -- and the stale-bundle guard blocks that prune after ANY shrink until
--      the mark is lowered by {action:"refresh", resetCatalogHighwater:true}
--      with the chain key (20260909220000's mechanism, derived from the vault
--      without ever printing the key). The reset sets the mark to the LIVE
--      bundle's size, so it must fire AFTER .68 serves: a five-minute cron
--      re-issues it until job_board_meta.catalog_highwater shows a reset
--      newer than this file's start that lowered the mark below 44,542 and
--      that stayed lowered for two consecutive ticks (a pass draining on the
--      old isolate writes the old size back), then unschedules itself; it
--      gives up after 72 hours and says so in meta.
--   6. THE ORDER. Deploy job-board .68 FIRST, verify status.version, THEN
--      apply this file. The delete phase refuses to run until a bundle that
--      dedupes at ingest has stamped oracle_site_rank.version or lowered the
--      high-water mark (either is a receipt only .68+ can write), because the
--      pre-.68 bundle re-inserts every copy this function deletes -- key-less,
--      with a fresh first_seen -- and books an arrival plus a second untracked
--      departure per copy per pass on the growth clock. Applying first is
--      safe (the sweep backfills and waits, saying so in waiting_for) but
--      does no deleting until .68 answers.
--      NOTHING HERE LOWERS THE MARK BY HAND, and nothing here deletes a row
--      the prune owns.
--
-- WHAT THE BOARD SHOULD READ AFTER (verify live, anon list calls):
--   epyc~us2~CX_3 -> not in catalog, 0 rows; epyc~us2~CX_1001 -> only its
--   unique reqs (<= ~22 measured); fa-espx CX_2001 -> 0 or a handful;
--   fa-espx CX_1006 -> ~706 (unchanged); eevd CX_6 -> 2; hcwx CX_5001 -> 0;
--   hcwx CX_1 -> 35 (unchanged); hcwp CX_7009 -> 61 (unchanged); hcrw CX_1001
--   -> 102 (unchanged); fa-euyk CX_1001 -> 3 (unchanged); eodr-dev5 -> 0.
--   totalAllCompanies ~810k -> ~787k (range 758k-798k); trackedTotal down by
--   the function's rows_exited plus the prune's dev/mirror rows;
--   status.oracleSubsiteRepair.phase = 'done', duplicates_remaining = 0,
--   status.orphanPruneBlocked = false, status.catalogSize = 44519.
--
-- NEVER EDIT THIS FILE ONCE APPLIED. Re-running it is safe (every step is
-- guarded), but a change belongs in a new stamp.

-- ═════════════════════════════════════════════════════════════════════════
-- 1. THE COLUMN.
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE attempt int := 0;
BEGIN
  SET LOCAL lock_timeout = '3s';
  LOOP
    attempt := attempt + 1;
    BEGIN
      ALTER TABLE public.job_board_postings ADD COLUMN IF NOT EXISTS req_key text;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF attempt >= 10 THEN
        RAISE EXCEPTION 'could not take the lock to add job_board_postings.req_key after % attempts; re-run when the ingest is quieter', attempt;
      END IF;
      RAISE NOTICE 'lock busy, retrying req_key add (attempt %)', attempt;
      PERFORM pg_sleep(2);
    END;
  END LOOP;
END $$;

COMMENT ON COLUMN public.job_board_postings.req_key IS
  'ORACLE ONLY: the tenant-level identity of a requisition, oracle:<tenant>:<reqId>, '
  'derived from the id (oracle:<tenant~region~site>:<reqId>) by dropping the site. '
  'The same requisition listed on several of a tenant''s career sites shares one '
  'req_key; the ingest stores it once, under the best-ranked site (job_board_meta '
  'oracle_site_rank), and repair_oracle_subsite_duplicates removes the copies '
  'already stored. NULL for every other vendor and for Oracle rows written before '
  'the backfill reached them. Not unique by constraint -- a transient second copy '
  'exists between one site''s visit and its sibling''s -- so readers must not '
  'assume one row per key; the ingest and the repair converge it to one.';

-- ═════════════════════════════════════════════════════════════════════════
-- 2. THE INDEX, BUILT OUTSIDE THIS TRANSACTION, WITH A WATCHER THAT STOPS IT.
-- ═════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent: build job_board_postings_req_key_idx by hand (CREATE INDEX CONCURRENTLY ... WHERE req_key IS NOT NULL)';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'job_board_postings_req_key_idx') THEN
    RAISE NOTICE 'job_board_postings_req_key_idx already present';
    RETURN;
  END IF;
  -- ONE statement, no SET in front of it: a multi-statement command string
  -- runs as one implicit transaction and CREATE INDEX CONCURRENTLY refuses it.
  PERFORM cron.schedule(
    'oneshot-oracle-req-key-idx', '* * * * *',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_req_key_idx ON public.job_board_postings (req_key) WHERE req_key IS NOT NULL');
  -- The watcher: a valid index unschedules both jobs; an INVALID one is
  -- dropped so the builder can try again -- BUT ONLY WHEN NO BUILD IS IN
  -- FLIGHT. A CONCURRENTLY build reads indisvalid = false for its whole
  -- duration (two heap scans of ~940k rows plus two waits for open
  -- transactions, routinely longer than the one-minute tick), and a plain
  -- DROP INDEX against it queues an ACCESS EXCLUSIVE lock on the hot table
  -- behind the builder's lock: every list query and every ingest write
  -- stalls until the build ends, the just-valid index is then dropped, and
  -- the builder starts over -- a livelock with a periodic whole-table stall.
  -- So the drop is refused while pg_stat_progress_create_index shows the
  -- build, and it runs under a 2-second lock_timeout so a race can never
  -- queue that lock: lock_not_available is swallowed and the next tick
  -- looks again.
  PERFORM cron.schedule(
    'oneshot-oracle-req-key-idx-watch', '* * * * *',
    $job$
    DO $w$
    DECLARE
      v_valid    boolean;
      v_building boolean;
    BEGIN
      SELECT i.indisvalid INTO v_valid
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = 'job_board_postings_req_key_idx';
      IF v_valid IS TRUE THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-oracle-req-key-idx') THEN
          PERFORM cron.unschedule('oneshot-oracle-req-key-idx');
        END IF;
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-oracle-req-key-idx-watch') THEN
          PERFORM cron.unschedule('oneshot-oracle-req-key-idx-watch');
        END IF;
      ELSIF v_valid IS FALSE THEN
        SELECT EXISTS (
          SELECT 1
            FROM pg_stat_progress_create_index p
            JOIN pg_class c ON c.oid = p.index_relid
           WHERE c.relname = 'job_board_postings_req_key_idx'
        ) INTO v_building;
        IF NOT v_building THEN
          BEGIN
            SET LOCAL lock_timeout = '2s';
            DROP INDEX IF EXISTS public.job_board_postings_req_key_idx;
          EXCEPTION WHEN lock_not_available THEN
            RAISE NOTICE 'job_board_postings_req_key_idx is invalid but locked (a build may have just started); the next tick looks again';
          END;
        END IF;
      END IF;
    END $w$;
    $job$);
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. THE RANK TABLE SEED. Same helper, same catalog, same hash as the .68
--    bundle publishes; written ONLY if the key is absent.
-- ═════════════════════════════════════════════════════════════════════════
INSERT INTO public.job_board_meta (k, v, updated_at)
VALUES ('oracle_site_rank',
        ($seed${"hash":"508846df9725cd0e","ranks":{"ejwl~us2~CX":0,"ejwl~us2~CX_1001":1,"ejwl~us2~CX_1":2,"eigx~us6~CX":0,"eigx~us6~CX_13":1,"eigx~us6~CX_9":2,"eigx~us6~CX_5":3,"ebwh~us2~CX_1001":0,"ebwh~us2~CX_1002":1,"ebwh~us2~CX_4001":2,"fa-etjg-saasfaprod1~ocs~CX_1003":0,"fa-etjg-saasfaprod1~ocs~CX_1001":1,"fa-etjg-saasfaprod1~ocs~CX_1002":2,"eodr~us2~CX_1001":0,"eodr~us2~CX_2001":1,"eodr~us2~CX_1004":2,"eodr~us2~CX_5001":3,"ibwsjb~ocs~CX_1":0,"ibwsjb~ocs~CX_1004":1,"fa-erar-saasfaprod1~ocs~CX_9":0,"fa-erar-saasfaprod1~ocs~CX_2":1,"fa-euyk-saasfaprod1~ocs~CX_3":0,"fa-euyk-saasfaprod1~ocs~CX_1001":1,"edmn~us2~CX_1":0,"edmn~us2~CX_6001":1,"edmn~us2~CX_8001":2,"eppr~us2~CX_2":0,"eppr~us2~CX_1":1,"eppr~us2~CX_1001":2,"epyc~us2~CX_1":0,"epyc~us2~CX_1001":1,"epyc~us2~CX_2001":2,"epyc~us2~CX_1003":3,"epyc~us2~CX_5001":4,"fa-evzu-saasfaprod1~ocs~CX_1":0,"fa-evzu-saasfaprod1~ocs~CX_1001":1,"ejrz~us2~CX_5001":0,"ejrz~us2~CX_6001":1,"fa-espx-saasfaprod1~ocs~CX_1006":0,"fa-espx-saasfaprod1~ocs~CX_3001":1,"fa-espx-saasfaprod1~ocs~CX_1002":2,"fa-espx-saasfaprod1~ocs~CX_1004":3,"fa-espx-saasfaprod1~ocs~CX_1005":4,"fa-espx-saasfaprod1~ocs~CX_1007":5,"fa-espx-saasfaprod1~ocs~CX_2001":6,"fa-espx-saasfaprod1~ocs~CX_1003":7,"fa-espx-saasfaprod1~ocs~CX_1001":8,"fa-espx-saasfaprod1~ocs~CX_1":9,"fa-exhh-saasfaprod1~ocs~CX_3004":0,"fa-exhh-saasfaprod1~ocs~CX_2001":1,"fa-exhh-saasfaprod1~ocs~CX_2002":2,"fa-exhh-saasfaprod1~ocs~CX_2003":3,"eibd~em2~CX_1":0,"eibd~em2~CX_3003":1,"eibd~em2~CX_2009":2,"eibd~em2~CX_1001":3,"eibd~em2~CX_2011":4,"eibd~em2~CX_4001":5,"eibd~em2~CX_2021":6,"eibd~em2~CX_2025":7,"eibd~em2~CX_2033":8,"eibd~em2~CX_2001":9,"eibd~em2~CX_2027":10,"eibd~em2~CX_2023":11,"eibd~em2~CX_2029":12,"eibd~em2~CX_2005":13,"eibd~em2~CX_2015":14,"emfg~em4~CX_1001":0,"emfg~em4~CX_4001":1,"emfg~em4~CX_5001":2,"efds~em5~CX_1":0,"efds~em5~CX_5001":1,"efds~em5~CX_7001":2,"eexs~us2~CX_3001":0,"eexs~us2~CX_11009":1,"eexs~us2~CX_14023":2,"eexs~us2~CX_12081":3,"eexs~us2~CX_12093":4,"eexs~us2~CX_12075":5,"eexs~us2~CX_12047":6,"eexs~us2~CX_14027":7,"eexs~us2~CX_10015":8,"eexs~us2~CX_10013":9,"eexs~us2~CX_1":10,"eexs~us2~CX_12095":11,"eexs~us2~CX_14035":12,"eexs~us2~CX_6001":13,"eexs~us2~CX_15017":14,"eexs~us2~CX_12085":15,"eexs~us2~CX_35005":16,"eexs~us2~CX_11013":17,"eexs~us2~CX_12029":18,"eexs~us2~CX_12083":19,"eexs~us2~CX_14013":20,"eexs~us2~CX_12023":21,"eexs~us2~CX_11017":22,"eexs~us2~CX_9001":23,"eexs~us2~CX_14015":24,"eexs~us2~CX_14011":25,"eexs~us2~CX_11015":26,"eexs~us2~CX_12091":27,"eexs~us2~CX_26007":28,"eexs~us2~CX_8003":29,"eexs~us2~CX_10001":30,"eexs~us2~CX_12051":31,"eexs~us2~CX_14033":32,"eexs~us2~CX_22005":33,"eexs~us2~CX_12089":34,"eexs~us2~CX_12041":35,"eexs~us2~CX_12073":36,"eexs~us2~CX_15007":37,"eexs~us2~CX_14021":38,"eexs~us2~CX_16011":39,"eexs~us2~CX_12061":40,"eexs~us2~CX_12079":41,"eexs~us2~CX_16013":42,"eexs~us2~CX_8005":43,"eexs~us2~CX_12033":44,"eexs~us2~CX_12043":45,"eexs~us2~CX_10017":46,"eexs~us2~CX_13005":47,"eexs~us2~CX_12019":48,"eexs~us2~CX_21005":49,"eexs~us2~CX_12071":50,"eexs~us2~CX_28005":51,"eexs~us2~CX_10005":52,"eexs~us2~CX_12013":53,"eexs~us2~CX_12067":54,"eexs~us2~CX_5001":55,"eexs~us2~CX_15013":56,"eexs~us2~CX_15011":57,"eexs~us2~CX_15015":58,"eexs~us2~CX_34007":59,"eexs~us2~CX_12035":60,"eexs~us2~CX_15005":61,"eexs~us2~CX_16005":62,"eexs~us2~CX_17009":63,"eexs~us2~CX_12017":64,"eexs~us2~CX_14019":65,"eexs~us2~CX_27007":66,"eexs~us2~CX_1001":67,"eexs~us2~CX_8001":68,"eexs~us2~CX_10033":69,"eexs~us2~CX_12009":70,"eexs~us2~CX_12045":71,"eexs~us2~CX_17005":72,"eexs~us2~CX_10009":73,"eexs~us2~CX_8017":74,"eexs~us2~CX_11019":75,"eexs~us2~CX_12021":76,"eexs~us2~CX_15009":77,"eexs~us2~CX_17007":78,"eexs~us2~CX_20005":79,"eexs~us2~CX_12007":80,"eexs~us2~CX_12015":81,"eexs~us2~CX_12011":82,"eexs~us2~CX_16007":83,"eexs~us2~CX_23005":84,"eexs~us2~CX_8015":85,"eexs~us2~CX_14005":86,"eexs~us2~CX_12087":87,"eexs~us2~CX_10031":88,"eexs~us2~CX_10037":89,"eexs~us2~CX_12027":90,"eexs~us2~CX_16015":91,"eexs~us2~CX_11011":92,"eexs~us2~CX_17011":93,"eexs~us2~CX_19005":94,"eexs~us2~CX_26005":95,"eexs~us2~CX_12025":96,"eexs~us2~CX_16009":97,"eexs~us2~CX_11005":98,"eexs~us2~CX_30007":99,"eexs~us2~CX_10007":100,"eexs~us2~CX_12053":101,"eexs~us2~CX_12063":102,"eexs~us2~CX_12077":103,"eexs~us2~CX_9003":104,"eexs~us2~CX_12065":105,"eexs~us2~CX_34005":106,"eexs~us2~CX_11007":107,"eexs~us2~CX_18005":108,"fa-exty-saasfaprod1~ocs~CX_1":0,"fa-exty-saasfaprod1~ocs~CX_1001":1,"hcwp~us2~CX_2004":0,"hcwp~us2~CX_1":1,"hcwp~us2~CX_7009":2,"hcwp~us2~CX_7011":3,"hcwp~us2~CX_7013":4,"hcwp~us2~CX_10001":5,"hcwp~us2~CX_3004":6,"hcwp~us2~CX_7010":7,"hcwp~us2~CX_8001":8,"hcwp~us2~CX_7012":9,"hcwp~us2~CX_2001":10,"hcwp~us2~CX_4001":11,"hcwp~us2~CX_9001":12,"hcwp~us2~CX_7007":13,"hcwp~us2~CX_7008":14,"hcwp~us2~CX_11001":15,"hcwp~us2~CX_7006":16,"eklm~us2~CX":0,"eklm~us2~CX_1001":1,"eklm~us2~CX_1":2,"fa-evlf-saasfaprod1~ocs~CX_1":0,"fa-evlf-saasfaprod1~ocs~CX_2001":1,"elar~us2~CX_14001":0,"elar~us2~CX_1":1,"ejgk~em2~CX_3":0,"ejgk~em2~CX_3001":1,"fa-ewgu-saasfaprod1~ocs~CX_2001":0,"fa-ewgu-saasfaprod1~ocs~CX_5001":1,"fa-ewgu-saasfaprod1~ocs~CX_3001":2,"fa-ewji-saasfaprod1~ocs~CX_1":0,"fa-ewji-saasfaprod1~ocs~CX_1001":1,"fa-ewji-saasfaprod1~ocs~CX_2001":2,"hcrw~us2~CX_1":0,"hcrw~us2~CX_1001":1,"fa-eotc-saasfaprod1~ocs~CX_25001":0,"fa-eotc-saasfaprod1~ocs~CX_34001":1,"fa-eotc-saasfaprod1~ocs~CX_1001":2,"fa-eotc-saasfaprod1~ocs~CX_4001":3,"fa-eotc-saasfaprod1~ocs~CX_23001":4,"fa-eotc-saasfaprod1~ocs~CX_26004":5,"fa-eotc-saasfaprod1~ocs~CX_32001":6,"fa-eotc-saasfaprod1~ocs~CX_14001":7,"fa-eotc-saasfaprod1~ocs~CX_29009":8,"fa-eotc-saasfaprod1~ocs~CX_26001":9,"fa-eotc-saasfaprod1~ocs~CX_29003":10,"fa-eotc-saasfaprod1~ocs~CX_29012":11,"fa-eotc-saasfaprod1~ocs~CX_30007":12,"fa-eotc-saasfaprod1~ocs~CX_27001":13,"fa-eotc-saasfaprod1~ocs~CX_29006":14,"fa-eotc-saasfaprod1~ocs~CX_12001":15,"fa-eotc-saasfaprod1~ocs~CX_16004":16,"fa-eotc-saasfaprod1~ocs~CX_30001":17,"fa-eotc-saasfaprod1~ocs~CX_35001":18,"fa-eotc-saasfaprod1~ocs~CX_33001":19,"fa-eotc-saasfaprod1~ocs~CX_18007":20,"fa-eotc-saasfaprod1~ocs~CX_13001":21,"fa-eotc-saasfaprod1~ocs~CX_17007":22,"fa-eotc-saasfaprod1~ocs~CX_18001":23,"fa-eotc-saasfaprod1~ocs~CX_36004":24,"fa-eotc-saasfaprod1~ocs~CX_35004":25,"fa-eotc-saasfaprod1~ocs~CX_36001":26,"fa-eotc-saasfaprod1~ocs~CX_18004":27,"fa-eotc-saasfaprod1~ocs~CX_15001":28,"fa-eotc-saasfaprod1~ocs~CX_29024":29,"fa-eotc-saasfaprod1~ocs~CX_17001":30,"fa-eotc-saasfaprod1~ocs~CX_16001":31,"fa-eotc-saasfaprod1~ocs~CX_21001":32,"fa-eotc-saasfaprod1~ocs~CX_31001":33,"fa-eotc-saasfaprod1~ocs~CX_30010":34,"fa-eotc-saasfaprod1~ocs~CX_4004":35,"fa-eotc-saasfaprod1~ocs~CX_17004":36,"fa-eotc-saasfaprod1~ocs~CX_24001":37,"fa-eotc-saasfaprod1~ocs~CX_5001":38,"fa-eotc-saasfaprod1~ocs~CX_19001":39,"fa-eotc-saasfaprod1~ocs~CX_18010":40,"fa-eotc-saasfaprod1~ocs~CX_29015":41,"fa-eotc-saasfaprod1~ocs~CX_18013":42,"fa-eotc-saasfaprod1~ocs~CX_29027":43,"fa-eotc-saasfaprod1~ocs~CX_22001":44,"elcn~us2~CX":0,"elcn~us2~CX_1001":1,"fa-elxu-saasfaprod1~ocs~CX_1008":0,"fa-elxu-saasfaprod1~ocs~CX_1001":1,"fa-elxu-saasfaprod1~ocs~CX_1012":2,"fa-elxu-saasfaprod1~ocs~CX_1024":3,"fa-elxu-saasfaprod1~ocs~CX_3005":4,"fa-elxu-saasfaprod1~ocs~CX_1036":5,"fa-elxu-saasfaprod1~ocs~CX_2001":6,"fa-elxu-saasfaprod1~ocs~CX_10001":7,"fa-elxu-saasfaprod1~ocs~CX_4001":8,"fa-elxu-saasfaprod1~ocs~CX_6001":9,"fa-elxu-saasfaprod1~ocs~CX_3013":10,"fa-elxu-saasfaprod1~ocs~CX_1016":11,"ehpv~em2~CX_1":0,"ehpv~em2~CX":1,"ejox~ap1~CX_1":0,"ejox~ap1~CX_5":1,"ejox~ap1~CX_7":2,"ejox~ap1~CX_6":3,"ejox~ap1~CX_2":4,"ejox~ap1~CX_11":5,"ejox~ap1~CX_1001":6,"ejox~ap1~CX_1004":7,"fa-exrr-saasfaprod1~ocs~CX_1":0,"fa-exrr-saasfaprod1~ocs~CX_8":1,"fa-exrr-saasfaprod1~ocs~CX_7":2,"fa-exrr-saasfaprod1~ocs~CX_5":3,"fa-exrr-saasfaprod1~ocs~CX_3":4,"fa-exrr-saasfaprod1~ocs~CX_9":5,"fa-exrr-saasfaprod1~ocs~CX_10":6,"fa-eqgc-saasfaprod1~ocs~CX_1":0,"fa-eqgc-saasfaprod1~ocs~CX_2":1,"fa-eqgc-saasfaprod1~ocs~CX_6":2,"fa-eqgc-saasfaprod1~ocs~CX_9":3,"eljs~us2~CX":0,"eljs~us2~CX_11001":1,"eedu~em3~CX_1003":0,"eedu~em3~CX_3001":1,"erhk~us2~CX_1001":0,"erhk~us2~CX_1":1,"erhk~us2~CX_4":2,"erhk~us2~CX_2001":3,"erhk~us2~CX_7":4,"ebez~us2~CX_1":0,"ebez~us2~CX_4":1,"fa-euxw-saasfaprod1~ocs~CX_1":0,"fa-euxw-saasfaprod1~ocs~CX_1001":1,"fa-euxw-saasfaprod1~ocs~CX_4001":2,"fa-euxw-saasfaprod1~ocs~CX_5001":3,"fa-euxw-saasfaprod1~ocs~CX_3001":4,"eevd~us6~CX":0,"eevd~us6~CX_6":1,"eevd~us6~CX_8004":2,"eevd~us6~CX_15":3,"eevd~us6~CX_8010":4,"eevd~us6~CX_8007":5,"eevd~us6~CX_9":6,"eevd~us6~CX_11":7,"eevd~us6~CX_2":8,"eevd~us6~CX_1001":9,"eevd~us6~CX_5":10,"eevd~us6~CX_7":11,"eevd~us6~CX_4":12,"eevd~us6~CX_15001":13,"eevd~us6~CX_10001":14,"eevd~us6~CX_18":15,"eevd~us6~CX_11001":16,"eevd~us6~CX_14":17,"eevd~us6~CX_12":18,"eevd~us6~CX_10007":19,"eevd~us6~CX_10004":20,"eevd~us6~CX_20":21,"eevd~us6~CX_10":22,"eevd~us6~CX_11007":23,"eevd~us6~CX_11004":24,"eevd~us6~CX_13001":25,"eevd~us6~CX_13":26,"eevd~us6~CX_3":27,"eevd~us6~CX_11010":28,"eevd~us6~CX_2001":29,"eevd~us6~CX_8":30,"eevd~us6~CX_16":31,"ibtcjb~ocs~CX_2":0,"ibtcjb~ocs~CX_4001":1,"hcxs~us2~CX_1":0,"hcxs~us2~CX_1001":1,"epuc~ap1~CX_4":0,"epuc~ap1~CX_1":1,"epuc~ap1~CX_7":2,"hcwx~us2~CX_6":0,"hcwx~us2~CX_1":1,"hcwx~us2~CX_15":2,"hcwx~us2~CX_7":3,"hcwx~us2~CX_20":4,"hcwx~us2~CX_12":5,"hcwx~us2~CX_2":6,"hcwx~us2~CX_5":7,"hcwx~us2~CX_14":8,"hcwx~us2~CX_19":9,"hcwx~us2~CX_8":10,"hcwx~us2~CX_13":11,"hcwx~us2~CX_18":12,"hcwx~us2~CX_17":13,"hcwx~us2~CX_16":14,"hcwx~us2~CX_6001":15,"ehzq~us2~CX_4":0,"ehzq~us2~CX_1":1,"ehzq~us2~CX_1001":2,"ehzq~us2~CX_3001":3,"ehzq~us2~CX_2004":4,"ehzq~us2~CX_3007":5,"ehzq~us2~CX_1004":6,"fa-etnv-saasfaprod1~ocs~CX_2017":0,"fa-etnv-saasfaprod1~ocs~CX_1001":1,"fa-etnv-saasfaprod1~ocs~CX_4003":2,"fa-etnv-saasfaprod1~ocs~CX_2009":3,"fa-etnv-saasfaprod1~ocs~CX_2007":4,"fa-etnv-saasfaprod1~ocs~CX_5":5,"fa-etnv-saasfaprod1~ocs~CX_2003":6,"fa-etnv-saasfaprod1~ocs~CX_4001":7,"fa-etnv-saasfaprod1~ocs~CX_3001":8,"fa-etnv-saasfaprod1~ocs~CX_2005":9,"fa-etnv-saasfaprod1~ocs~CX_7":10,"fa-etnv-saasfaprod1~ocs~CX_2015":11,"fa-etnv-saasfaprod1~ocs~CX_2011":12,"fa-etnv-saasfaprod1~ocs~CX_2001":13,"eewl~us6~CX":0,"eewl~us6~CX_1001":1,"eewl~us6~CX_1":2,"eewl~us6~CX_1004":3,"elyb~us2~CX_1001":0,"elyb~us2~CX_3001":1,"ekkt~us2~CX_1":0,"ekkt~us2~CX_4":1,"ekkt~us2~CX_4001":2,"ekkt~us2~CX_11001":3,"hdow~us6~CX_1001":0,"hdow~us6~CX_1003":1,"fa-esbv-saasfaprod1~ocs~CX_1":0,"fa-esbv-saasfaprod1~ocs~CX_2001":1,"fa-esbv-saasfaprod1~ocs~CX_4":2,"fa-eqgp-saasfaprod1~ocs~CX_1001":0,"fa-eqgp-saasfaprod1~ocs~CX_2001":1,"fa-eugp-saasfaprod1~ocs~CX_1":0,"fa-eugp-saasfaprod1~ocs~CX_3001":1,"fa-eutv-saasfaprod1~ocs~CX_1001":0,"fa-eutv-saasfaprod1~ocs~CX_1":1,"fa-eutv-saasfaprod1~ocs~CX_8001":2,"fa-eutv-saasfaprod1~ocs~CX_6007":3,"eicl~em5~CX_4001":0,"eicl~em5~CX_5001":1,"eicl~em5~CX_6001":2,"eicl~em5~CX_7001":3,"eicl~em5~CX_2001":4,"tulane-ibqejb~ocs~CX_1":0,"tulane-ibqejb~ocs~CX_2":1,"tulane-ibqejb~ocs~CX_1001":2,"ejof~us2~CX_1":0,"ejof~us2~CX":1,"eify~us6~CX_1004":0,"eify~us6~CX_1001":1,"eczd~us2~CX_1":0,"eczd~us2~CX_17021":1,"eczd~us2~CX_4001":2,"eczd~us2~CX_9001":3,"eczd~us2~CX_13001":4,"eczd~us2~CX_19001":5,"fa-esfy-saasfaprod1~ocs~CX_3001":0,"fa-esfy-saasfaprod1~ocs~CX_2001":1,"fa-esfy-saasfaprod1~ocs~CX_4001":2,"fa-esfy-saasfaprod1~ocs~CX_4004":3,"fa-esfy-saasfaprod1~ocs~CX_10":4,"iaaxey~ocs~CX_1":0,"iaaxey~ocs~CX_1001":1,"eoce~em3~CX_1004":0,"eoce~em3~CX_4001":1,"eoce~em3~CX_3001":2,"eoce~em3~CX_13001":3,"eoce~em3~CX_3007":4,"eoce~em3~CX_6001":5,"eoce~em3~CX_30001":6,"eoce~em3~CX_20001":7,"eoce~em3~CX_20004":8,"eoce~em3~CX_25001":9,"eoce~em3~CX_17001":10,"eoce~em3~CX_2001":11,"fa-exea-saasfaprod1~ocs~CX_1001":0,"fa-exea-saasfaprod1~ocs~CX_2":1,"ehwy~us2~CX":0,"ehwy~us2~CX_1":1,"fa-elhu-saasfaprod1~ocs~CX":0,"fa-elhu-saasfaprod1~ocs~CX_1005":1,"fa-elhu-saasfaprod1~ocs~CX_2001":2,"fa-elhu-saasfaprod1~ocs~CX_4013":3,"fa-elhu-saasfaprod1~ocs~CX_4005":4,"fa-elhu-saasfaprod1~ocs~CX_4009":5,"fa-elhu-saasfaprod1~ocs~CX_3005":6,"fa-elhu-saasfaprod1~ocs~CX_5009":7,"fda~us1~CX_1":0,"fda~us1~CX_1001":1,"erou~us2~CX_1":0,"erou~us2~CX_2001":1,"ehnn~us2~CX_3001":0,"ehnn~us2~CX_4":1,"ehnn~us2~CX_2001":2,"ehnn~us2~CX_7":3,"ehnn~us2~CX_10":4,"ehnn~us2~CX_1001":5,"ehnn~us2~CX":6,"ehnn~us2~CX_1":7,"etud~us8~CX_1":0,"etud~us8~CX_1001":1,"fa-exvu-saasfaprod1~ocs~CX_1":0,"fa-exvu-saasfaprod1~ocs~CX_1003":1,"fa-exvu-saasfaprod1~ocs~CX_1002":2,"estm~em2~CX_3001":0,"estm~em2~CX_1":1,"estm~em2~CX_1001":2,"estm~em2~CX_2003":3,"estm~em2~CX_5001":4,"estm~em2~CX_10001":5,"hdrc~ca3~CX_7002":0,"hdrc~ca3~CX_3001":1,"hdrc~ca3~CX_2002":2,"hdrc~ca3~CX_4001":3,"hdrc~ca3~CX_8002":4,"hdrc~ca3~CX_1":5,"hdrc~ca3~CX_1001":6,"fa-euzi-saasfaprod1~ocs~CX_1":0,"fa-euzi-saasfaprod1~ocs~CX_4":1,"fa-ewur-saasfaprod1~ocs~CX_1":0,"fa-ewur-saasfaprod1~ocs~CX_3":1,"ecge~us2~CX_1003":0,"ecge~us2~CX_6001":1,"ehaa~ca2~CX_3":0,"ehaa~ca2~CX_1":1,"ehaa~ca2~CX_2":2,"evqk~us8~CX_2001":0,"evqk~us8~CX_3001":1,"emdm~ap1~CX_23001":0,"emdm~ap1~CX_4001":1,"emdm~ap1~CX_15009":2,"emdm~ap1~CX_10001":3,"emdm~ap1~CX_19001":4,"emdm~ap1~CX_2001":5,"emdm~ap1~CX_14001":6,"emdm~ap1~CX_15001":7,"emdm~ap1~CX_18001":8,"emvo~us2~CX_3002":0,"emvo~us2~CX_3005":1,"emvo~us2~CX_3001":2,"fa-evlb-saasfaprod1~ocs~CX_1":0,"fa-evlb-saasfaprod1~ocs~CX_1001":1,"fa-evlb-saasfaprod1~ocs~CX_2001":2,"ejdf~us6~CX":0,"ejdf~us6~CX_1":1,"egvc~ap1~CX_1001":0,"egvc~ap1~CX_2001":1,"esbe~em8~CX_1001":0,"esbe~em8~CX_1":1,"esbe~em8~CX_4001":2,"iaboey~ocs~CX_2":0,"iaboey~ocs~CX_4":1,"iaboey~ocs~CX_3":2,"utulsa-ibvjjb~ocs~CX_1":0,"utulsa-ibvjjb~ocs~CX_2":1,"ehpy~em5~CX_1001":0,"ehpy~em5~CX_1004":1,"hdcs~ap1~CX_13009":0,"hdcs~ap1~CX_13003":1,"hdcs~ap1~CX_13004":2,"hdcs~ap1~CX_13008":3,"hdcs~ap1~CX_13006":4,"hdcs~ap1~CX_13005":5,"hdcs~ap1~CX_13001":6,"hdcs~ap1~CX_13002":7,"hdcs~ap1~CX_13007":8,"ejcu~us6~CX_1035":0,"ejcu~us6~CX_1033":1,"ejcu~us6~CX_1036":2,"hdga~em3~CX_1":0,"hdga~em3~CX_1001":1,"hdga~em3~CX_17":2,"hdga~em3~CX_9":3,"hdga~em3~CX_12":4,"hdga~em3~CX_16":5,"hdga~em3~CX_18":6,"edzz~em3~CX_6001":0,"edzz~em3~CX_6004":1,"epgr~us6~CX_1002":0,"epgr~us6~CX_1001":1,"iagjme~ocs~CX_1005":0,"iagjme~ocs~CX_1001":1,"iagjme~ocs~CX_1":2,"iagjme~ocs~CX_2001":3,"hdra~em5~CX_3001":0,"hdra~em5~CX_1":1,"hdra~em5~CX_1001":2,"epiw~la1~CX_1001":0,"epiw~la1~CX_2001":1,"fa-euuc-saasfaprod1~ocs~CX_1":0,"fa-euuc-saasfaprod1~ocs~CX_2":1,"iaaras~ocs~CX_4":0,"iaaras~ocs~CX_1":1,"iaaras~ocs~CX_3":2,"iaaras~ocs~CX_2":3,"cargolux-iajigs~ocs~CX_2":0,"cargolux-iajigs~ocs~CX_5":1,"cargolux-iajigs~ocs~CX_3":2,"iabwey~ocs~CX_1":0,"iabwey~ocs~CX_3":1,"elgl~ap1~CX_1001":0,"elgl~ap1~CX_2004":1,"elgl~ap1~CX_4001":2,"fa-elzs-saasfaprod1~ocs~CX":0,"fa-elzs-saasfaprod1~ocs~CX_1001":1,"fa-exci-saasfaprod1~ocs~CX_2001":0,"fa-exci-saasfaprod1~ocs~CX_2":1,"fa-exci-saasfaprod1~ocs~CX_1":2,"icbpjb~ocs~CX_2":0,"icbpjb~ocs~CX_1":1,"fa-etum-saasfaprod1~ocs~CX_1":0,"fa-etum-saasfaprod1~ocs~CX_1001":1,"fa-etum-saasfaprod1~ocs~CX_2001":2,"hcnh~us2~CX_3001":0,"hcnh~us2~CX_4001":1,"hcre~us2~CX_1":0,"hcre~us2~CX_3001":1,"fa-eqsg-saasfaprod1~ocs~CX_1":0,"fa-eqsg-saasfaprod1~ocs~CX_3":1,"hcor~us2~CX_1":0,"hcor~us2~CX_1001":1,"fa-evrg-saasfaprod1~ocs~CX_1":0,"fa-evrg-saasfaprod1~ocs~CX_3":1,"fa-ewlx-saasfaprod1~ocs~CX_1":0,"fa-ewlx-saasfaprod1~ocs~CX_2":1,"enpk~em8~CX_4001":0,"enpk~em8~CX_1001":1,"enpk~em8~CX_1004":2,"fa-evzn-saasfaukgovprod1~ocs~CX_1001":0,"fa-evzn-saasfaukgovprod1~ocs~CX_5":1,"fa-emmq-saasfaprod1~ocs~CX_7003":0,"fa-emmq-saasfaprod1~ocs~CX":1,"fa-emmq-saasfaprod1~ocs~CX_6001":2,"fa-eqnk-saasfaprod1~ocs~CX_6001":0,"fa-eqnk-saasfaprod1~ocs~CX_6002":1,"fa-eqnk-saasfaprod1~ocs~CX_2001":2,"iabeey~ocs~CX_1001":0,"iabeey~ocs~CX_2003":1,"iabeey~ocs~CX_2001":2,"iabeey~ocs~CX_1003":3,"fa-exnu-saasfaprod1~ocs~CX_1":0,"fa-exnu-saasfaprod1~ocs~CX_2":1,"fa-exer-saasfaprod1~ocs~CX_1001":0,"fa-exer-saasfaprod1~ocs~CX_1":1,"fa-eutm-saasfaprod1~ocs~CX_2":0,"fa-eutm-saasfaprod1~ocs~CX_1":1,"hcog~em2~CX_2":0,"hcog~em2~CX_1003":1,"hcog~em2~CX_2001":2,"hcog~em2~CX_1":3,"efan~em3~CX_1":0,"efan~em3~CX_7001":1,"elzx~em2~CX_2001":0,"elzx~em2~CX_7004":1,"eklv~ca3~CX_1001":0,"eklv~ca3~CX_2001":1,"eklv~ca3~CX_3003":2,"efuy~em3~CX_1":0,"efuy~em3~CX_5002":1,"fa-exki-saasfaprod1~ocs~CX_2001":0,"fa-exki-saasfaprod1~ocs~CX_3003":1,"fa-exki-saasfaprod1~ocs~CX_1":2,"fa-etrb-saasfaprod1~ocs~CX_3001":0,"fa-etrb-saasfaprod1~ocs~CX_1001":1,"iaarkf~ocs~CX_1":0,"iaarkf~ocs~CX_1001":1,"fa-evxn-saasfaukgovprod1~ocs~CX_2001":0,"fa-evxn-saasfaukgovprod1~ocs~CX_1001":1,"fa-evxn-saasfaukgovprod1~ocs~CX_1":2,"emqm~us6~CX_2001":0,"emqm~us6~CX_1001":1,"ibqcjb~ocs~CX_2":0,"ibqcjb~ocs~CX_1":1,"eipb~em2~CX_5":0,"eipb~em2~CX_1":1,"fa-enfw-saasfaprod1~ocs~CX_4001":0,"fa-enfw-saasfaprod1~ocs~CX_4003":1,"fa-enfw-saasfaprod1~ocs~CX_4005":2,"fa-exad-saasfaprod1~ocs~CX_1":0,"fa-exad-saasfaprod1~ocs~CX_2":1,"fa-epxn-saasfaprod1~ocs~CX_4001":0,"fa-epxn-saasfaprod1~ocs~CX_7001":1,"fa-epxn-saasfaprod1~ocs~CX_1":2,"fa-epxn-saasfaprod1~ocs~CX_3001":3,"fa-epxn-saasfaprod1~ocs~CX_2001":4,"fa-evwo-saasfaprod1~ocs~CX_3":0,"fa-evwo-saasfaprod1~ocs~CX_1":1,"fa-evwo-saasfaprod1~ocs~CX_2003":2,"fa-evwo-saasfaprod1~ocs~CX_2001":3,"fa-evwo-saasfaprod1~ocs~CX_1001":4,"fa-eqqg-saasfaprod1~ocs~CX_1001":0,"fa-eqqg-saasfaprod1~ocs~CX_2001":1,"fa-eujk-saasfaprod1~ocs~CX_1":0,"fa-eujk-saasfaprod1~ocs~CX_1001":1,"eixy~us6~CX_2002":0,"eixy~us6~CX_3001":1,"iaafnf~ocs~CX_1001":0,"iaafnf~ocs~CX_2001":1,"iabqiz~ocs~CX_3001":0,"iabqiz~ocs~CX_1":1,"iabqiz~ocs~CX_2001":2,"iabqiz~ocs~CX_1001":3,"ibqhjb~ocs~CX_1003":0,"ibqhjb~ocs~CX_1001":1,"fa-exxn-saasfaprod1~ocs~CX_2":0,"fa-exxn-saasfaprod1~ocs~CX_1":1,"egjd~us6~CX":0,"egjd~us6~CX_1":1,"ejwt~em2~CX_3001":0,"ejwt~em2~CX_5001":1,"iaahbk~ocs~CX_1001":0,"iaahbk~ocs~CX_7":1,"fa-esco-saasfaprod1~ocs~CX_1":0,"fa-esco-saasfaprod1~ocs~CX_1001":1,"iacfey~ocs~CX_1001":0,"iacfey~ocs~CX_1":1,"emgi~ca3~CX_3003":0,"emgi~ca3~CX_1001":1,"emgi~ca3~CX_3001":2,"fa-etqo-saasfaprod1~ocs~CX_1":0,"fa-etqo-saasfaprod1~ocs~CX_2":1,"ebtg~us2~CX_2001":0,"ebtg~us2~CX_3001":1,"epdm~la1~CX_3001":0,"epdm~la1~CX_4001":1,"ephv~ap2~CX_1":0,"ephv~ap2~CX_1001":1,"epdj~ap1~CX":0,"epdj~ap1~CX_1001":1,"ecau~em2~CX":0,"ecau~em2~CX_1":1,"ibmxjb~ocs~CX_1":0,"ibmxjb~ocs~CX_2":1,"fa-ewfo-saasfaprod1~ocs~CX_1006":0,"fa-ewfo-saasfaprod1~ocs~CX_1":1,"fa-eozc-saasfaprod1~ocs~CX_2007":0,"fa-eozc-saasfaprod1~ocs~CX_9001":1,"fa-eozc-saasfaprod1~ocs~CX_7001":2,"fa-eozc-saasfaprod1~ocs~CX_8001":3,"fa-etuy-saasfaeuraprod1~ocs~CX_1":0,"fa-etuy-saasfaeuraprod1~ocs~CX_2002":1,"fa-ewts-saasfaprod1~ocs~CX_1":0,"fa-ewts-saasfaprod1~ocs~CX_1001":1,"fa-evlo-saasfaprod1~ocs~CX_1":0,"fa-evlo-saasfaprod1~ocs~CX_2":1,"fa-evlo-saasfaprod1~ocs~CX_1001":2,"fa-eqto-saasfaprod1~ocs~CX_1":0,"fa-eqto-saasfaprod1~ocs~CX_1004":1},"canonical":{"fa-espx-saasfaprod1":"fa-espx-saasfaprod1~ocs~CX_1006"},"sites":723}$seed$::jsonb) || jsonb_build_object('seeded_by', '20260909216000', 'at', now()),
        now())
ON CONFLICT (k) DO NOTHING;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. THE REPAIR FUNCTION.
-- ═════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.repair_oracle_subsite_duplicates(p_max_rows int DEFAULT 4000, p_restart boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '240s'
AS $fn$
DECLARE
  st            jsonb;
  ranks         jsonb;
  phase         text;
  budget        int := GREATEST(1, LEAST(COALESCE(p_max_rows, 4000), 20000));
  v_tokens      text[];
  v_pending     text[];
  v_tok         text;
  v_tenant      text;
  v_tenant_toks text[];
  v_n           int;
  v_found       int;
  v_victims     text[];
  v_exited      bigint;
  v_backfilled  bigint;
  v_done        int;
  v_keys        bigint;
  v_index_ok    boolean;
  v_remaining   bigint;
  v_unranked    bigint;
  v_nullkeys    bigint;
  v_passes      int;
  v_exited_at   timestamptz := now();
  v_bundle_ok   boolean;
  v_started     timestamptz;
BEGIN
  -- One runner at a time: the cron fires every two minutes and a slow run
  -- must not be overlapped by the next tick.
  IF NOT pg_try_advisory_xact_lock(hashtext('oracle_subsite_repair')) THEN
    RETURN jsonb_build_object('skipped', 'another run holds the lock');
  END IF;

  SELECT v INTO st FROM public.job_board_meta WHERE k = 'oracle_subsite_repair';
  IF st IS NULL THEN
    -- ITS OWN INPUT: every Oracle token the table actually holds, whatever
    -- the catalog or the estimate says.
    SELECT array_agg(DISTINCT company_token ORDER BY company_token)
      INTO v_tokens
      FROM public.job_board_postings
     WHERE source = 'oracle';
    st := jsonb_build_object(
      'phase', 'backfill',
      'started_at', now(),
      'tokens_total', COALESCE(array_length(v_tokens, 1), 0),
      'tokens_all', to_jsonb(COALESCE(v_tokens, ARRAY[]::text[])),
      'tokens_pending', to_jsonb(COALESCE(v_tokens, ARRAY[]::text[])),
      'tenants_pending', '[]'::jsonb,
      'tenants_done', 0,
      'rows_backfilled', 0,
      'rows_exited', 0,
      'keys_deduped', 0,
      'passes', 0,
      'runs', 0);
  END IF;

  SELECT i.indisvalid INTO v_index_ok
    FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
   WHERE c.relname = 'job_board_postings_req_key_idx';
  v_index_ok := COALESCE(v_index_ok, false);

  SELECT v->'ranks' INTO ranks FROM public.job_board_meta WHERE k = 'oracle_site_rank';
  -- PROOF THAT A BUNDLE WHICH DEDUPES AT INGEST IS SERVING. The pre-.68
  -- bundle reads a site's stored rows by company_token, finds the copies this
  -- function deleted gone, and re-inserts every one of them key-less with a
  -- fresh first_seen -- an arrival on the growth clock per copy per pass, then
  -- a second untracked departure once they are found again. So the delete
  -- phase waits for one of two receipts only .68 can produce: the rank table
  -- stamped with a bundle version (the seed below carries none, and no older
  -- bundle writes that key), or the catalog high-water reset landing below
  -- the pre-shrink mark (only a bundle whose catalog is smaller can do that).
  SELECT COALESCE(
           EXISTS (SELECT 1 FROM public.job_board_meta WHERE k = 'oracle_site_rank' AND (v ->> 'version') IS NOT NULL)
           OR EXISTS (SELECT 1 FROM public.job_board_meta WHERE k = 'oracle_subsite_highwater_reset' AND (v ->> 'state') = 'done'),
           false)
    INTO v_bundle_ok;

  phase        := st->>'phase';
  v_backfilled := COALESCE((st->>'rows_backfilled')::bigint, 0);
  v_exited     := COALESCE((st->>'rows_exited')::bigint, 0);
  v_done       := COALESCE((st->>'tenants_done')::int, 0);
  v_keys       := COALESCE((st->>'keys_deduped')::bigint, 0);
  v_passes     := COALESCE((st->>'passes')::int, 0);

  IF phase = 'backfill' THEN
    SELECT COALESCE(array_agg(x), ARRAY[]::text[]) INTO v_pending
      FROM jsonb_array_elements_text(st->'tokens_pending') AS t(x);
    WHILE budget > 0 AND COALESCE(array_length(v_pending, 1), 0) > 0 LOOP
      v_tok := v_pending[1];
      -- oracle:<tenant~region~site>:<reqId> -> oracle:<tenant>:<reqId>. The
      -- third segment is the numeric requisition id; a malformed id keeps NULL.
      UPDATE public.job_board_postings
         SET req_key = 'oracle:' || split_part(split_part(id, ':', 2), '~', 1) || ':' || split_part(id, ':', 3)
       WHERE company_token = v_tok
         AND source = 'oracle'
         AND req_key IS NULL
         AND split_part(id, ':', 1) = 'oracle'
         AND split_part(id, ':', 3) <> '';
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_backfilled := v_backfilled + v_n;
      budget := budget - v_n;
      v_pending := v_pending[2:];
    END LOOP;
    st := st || jsonb_build_object('tokens_pending', to_jsonb(v_pending), 'rows_backfilled', v_backfilled);
    IF COALESCE(array_length(v_pending, 1), 0) = 0 THEN
      SELECT COALESCE(array_agg(DISTINCT split_part(x, '~', 1) ORDER BY split_part(x, '~', 1)), ARRAY[]::text[])
        INTO v_pending
        FROM jsonb_array_elements_text(st->'tokens_all') AS t(x);
      st := st || jsonb_build_object('phase', 'dedupe', 'tenants_pending', to_jsonb(v_pending), 'tenants_total', COALESCE(array_length(v_pending, 1), 0));
    END IF;

  ELSIF phase = 'dedupe' THEN
    IF ranks IS NULL THEN
      st := st || jsonb_build_object('waiting_for', 'job_board_meta.oracle_site_rank (absent)');
    ELSIF NOT v_index_ok THEN
      st := st || jsonb_build_object('waiting_for', 'job_board_postings_req_key_idx (not yet valid)');
    ELSIF NOT v_bundle_ok THEN
      st := st || jsonb_build_object('waiting_for', 'a bundle that dedupes at ingest (2026-09-09.68 or later): no version stamped on oracle_site_rank and the catalog high-water reset is not done');
    ELSE
      st := st - 'waiting_for';
      SELECT COALESCE(array_agg(x), ARRAY[]::text[]) INTO v_pending
        FROM jsonb_array_elements_text(st->'tenants_pending') AS t(x);
      WHILE budget > 0 AND COALESCE(array_length(v_pending, 1), 0) > 0 LOOP
        v_tenant := v_pending[1];
        SELECT COALESCE(array_agg(x), ARRAY[]::text[]) INTO v_tenant_toks
          FROM jsonb_array_elements_text(st->'tokens_all') AS t(x)
         WHERE split_part(x, '~', 1) = v_tenant;
        -- Keeper = the best-ranked LIVE holder of a key: a row stamped
        -- missing_since is on its way through the absence path and must not
        -- beat a sibling's live copy, or the live copy is exited here and the
        -- dying one closes as a takedown the employer never made. Only RANKED
        -- holders take part, exactly as the ingest's planner does: a copy on
        -- an unranked token (a site removed from the catalog, a dev tenant)
        -- is neither keeper nor victim -- it belongs to the orphan prune, which
        -- exits it under the same reason.
        WITH rows AS (
          SELECT p.id, p.req_key, (ranks ->> p.company_token)::int AS rank, p.missing_since
            FROM public.job_board_postings p
           WHERE p.company_token = ANY (v_tenant_toks)
             AND p.req_key IS NOT NULL
             AND (ranks ->> p.company_token) IS NOT NULL
        ), dup AS (
          SELECT req_key FROM rows GROUP BY req_key
          HAVING count(*) > 1
        ), ranked AS (
          SELECT r.id, r.req_key,
                 row_number() OVER (PARTITION BY r.req_key ORDER BY (r.missing_since IS NULL) DESC, r.rank ASC, r.id) AS rn
            FROM rows r JOIN dup USING (req_key)
        )
        SELECT COALESCE(array_agg(id), ARRAY[]::text[]), count(*)
          INTO v_victims, v_found
          FROM (SELECT id FROM ranked WHERE rn > 1 ORDER BY req_key, rn LIMIT budget) x;
        v_n := COALESCE(array_length(v_victims, 1), 0);
        IF v_n > 0 THEN
          -- THE LEDGER FIRST: after the delete there is nothing to read.
          -- 'untracked' -- our action -- and nothing into job_board_closures.
          INSERT INTO public.job_board_exits
            (posting_id, source, company_token, company, title, category, exit_reason,
             posted_at, days_on_board, origin_basis, exited_at,
             department, country, region_code, work_mode, employment_type,
             experience_band, min_years, salary_min_annual, salary_max_annual,
             salary_period, salary_currency)
          SELECT p.id, p.source, p.company_token, p.company, p.title,
                 COALESCE(p.category, 'other'), 'untracked',
                 p.posted_at,
                 CASE WHEN p.posted_at IS NOT NULL
                        THEN round((extract(epoch FROM (v_exited_at - p.posted_at)) / 86400.0)::numeric, 1)
                      WHEN p.first_seen IS NOT NULL
                        THEN round((extract(epoch FROM (v_exited_at - p.first_seen)) / 86400.0)::numeric, 1)
                 END,
                 CASE WHEN p.posted_at IS NOT NULL THEN 'stated'
                      WHEN p.first_seen IS NOT NULL THEN 'discovered' END,
                 v_exited_at,
                 p.department, p.country, p.region_code, p.work_mode, p.employment_type,
                 p.experience_band, p.min_years, p.salary_min_annual, p.salary_max_annual,
                 p.salary_period, p.salary_currency
            FROM public.job_board_postings p
           WHERE p.id = ANY (v_victims);
          DELETE FROM public.job_board_postings WHERE id = ANY (v_victims);
          v_exited := v_exited + v_n;
          budget := budget - v_n;
        END IF;
        -- A tenant is finished only when a full pass found nothing left to
        -- delete; a budget-capped pass stays on the same tenant.
        IF v_n = 0 THEN
          v_pending := v_pending[2:];
          v_done := v_done + 1;
        ELSIF budget <= 0 THEN
          EXIT;
        END IF;
      END LOOP;
      st := st || jsonb_build_object('tenants_pending', to_jsonb(v_pending), 'tenants_done', v_done, 'rows_exited', v_exited);
      IF COALESCE(array_length(v_pending, 1), 0) = 0 THEN
        st := st || jsonb_build_object('phase', 'verify');
      END IF;
    END IF;

  ELSIF phase = 'verify' THEN
    -- Recount over the WHOLE table, not the token list captured at start: the
    -- pre-.68 bundle may have written key-less Oracle rows meanwhile.
    SELECT count(*) INTO v_nullkeys
      FROM public.job_board_postings
     WHERE source = 'oracle' AND req_key IS NULL;
    -- duplicates_remaining: keys with more than one RANKED holder (what this
    -- function removes). duplicates_unranked_left_to_prune: keys that are
    -- duplicated only because an unranked token (a site out of the catalog,
    -- a dev tenant) still holds a copy -- the orphan prune's rows, reported
    -- so the two figures add up to what the table holds.
    SELECT count(*) FILTER (WHERE ranked_n > 1), count(*) FILTER (WHERE ranked_n <= 1)
      INTO v_remaining, v_unranked
      FROM (
        SELECT req_key, count(*) FILTER (WHERE (ranks ->> company_token) IS NOT NULL) AS ranked_n
          FROM public.job_board_postings
         WHERE req_key IS NOT NULL
         GROUP BY req_key HAVING count(*) > 1
      ) d;
    v_passes := v_passes + 1;
    v_started := COALESCE((st->>'started_at')::timestamptz, now());
    st := st || jsonb_build_object(
      'passes', v_passes,
      'duplicates_remaining', v_remaining,
      'duplicates_unranked_left_to_prune', v_unranked,
      'oracle_rows_without_key', v_nullkeys,
      'verified_at', now());
    IF (v_nullkeys > 0 OR v_remaining > 0) AND v_passes < 8 AND now() - v_started < interval '72 hours' THEN
      -- Loop once more from the tokens the table holds NOW.
      SELECT array_agg(DISTINCT company_token ORDER BY company_token)
        INTO v_tokens
        FROM public.job_board_postings
       WHERE source = 'oracle';
      st := st || jsonb_build_object(
        'phase', 'backfill',
        'tokens_all', to_jsonb(COALESCE(v_tokens, ARRAY[]::text[])),
        'tokens_pending', to_jsonb(COALESCE(v_tokens, ARRAY[]::text[])),
        'tenants_pending', '[]'::jsonb);
    ELSE
      st := st || jsonb_build_object('phase', 'done', 'done_at', now());
      IF (v_nullkeys > 0 OR v_remaining > 0) THEN
        st := st || jsonb_build_object('note', 'stopped with work left (8 passes or 72 hours): key-less Oracle rows or ranked duplicates remain; SELECT repair_oracle_subsite_duplicates(4000, true) restarts the sweep and re-schedules its cron');
      END IF;
      IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
         AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oracle-subsite-repair') THEN
        PERFORM cron.unschedule('oracle-subsite-repair');
      END IF;
    END IF;

  ELSE
    -- 'done' (or an unknown phase): report, never touch a row -- unless the
    -- table has work again. Rows the old bundle wrote between the last
    -- backfill and the cut-over keep req_key NULL forever otherwise (the
    -- ingest never rewrites a stored row, and both dedupes look only at keyed
    -- rows), so a finished sweep re-enters from the tokens the table holds
    -- NOW when asked (p_restart) or when a fresh count finds key-less Oracle
    -- rows or ranked duplicates, and re-schedules its own cron.
    SELECT count(*) INTO v_nullkeys
      FROM public.job_board_postings
     WHERE source = 'oracle' AND req_key IS NULL;
    SELECT count(*) INTO v_remaining
      FROM (
        SELECT req_key
          FROM public.job_board_postings
         WHERE req_key IS NOT NULL AND (ranks ->> company_token) IS NOT NULL
         GROUP BY req_key HAVING count(*) > 1
      ) d;
    IF p_restart OR v_nullkeys > 0 OR v_remaining > 0 THEN
      SELECT array_agg(DISTINCT company_token ORDER BY company_token)
        INTO v_tokens
        FROM public.job_board_postings
       WHERE source = 'oracle';
      st := st || jsonb_build_object(
        'phase', 'backfill',
        'started_at', now(),
        'restarts', COALESCE((st->>'restarts')::int, 0) + 1,
        'restarted_at', now(),
        'restart_reason', CASE WHEN p_restart THEN 'requested' ELSE format('%s key-less oracle rows, %s ranked duplicate keys', v_nullkeys, v_remaining) END,
        'passes', 0,
        'tokens_total', COALESCE(array_length(v_tokens, 1), 0),
        'tokens_all', to_jsonb(COALESCE(v_tokens, ARRAY[]::text[])),
        'tokens_pending', to_jsonb(COALESCE(v_tokens, ARRAY[]::text[])),
        'tenants_pending', '[]'::jsonb);
      st := (st - 'done_at') - 'note';
      IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
         AND NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oracle-subsite-repair') THEN
        PERFORM cron.schedule('oracle-subsite-repair', '*/2 * * * *', 'SELECT public.repair_oracle_subsite_duplicates(4000);');
      END IF;
    ELSE
      st := st || jsonb_build_object('oracle_rows_without_key', v_nullkeys, 'duplicates_remaining', v_remaining);
      IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron')
         AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oracle-subsite-repair') THEN
        PERFORM cron.unschedule('oracle-subsite-repair');
      END IF;
    END IF;
  END IF;

  st := st || jsonb_build_object(
    'runs', COALESCE((st->>'runs')::int, 0) + 1,
    'last_run', now(),
    'index_ready', v_index_ok,
    'ranks_present', ranks IS NOT NULL,
    'bundle_ready', v_bundle_ok,
    'ranked_sites', CASE WHEN ranks IS NULL THEN 0 ELSE (SELECT count(*) FROM jsonb_object_keys(ranks)) END);

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('oracle_subsite_repair', st, now())
  ON CONFLICT (k) DO UPDATE SET v = EXCLUDED.v, updated_at = EXCLUDED.updated_at;

  RETURN st;
END
$fn$;

REVOKE ALL ON FUNCTION public.repair_oracle_subsite_duplicates(int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.repair_oracle_subsite_duplicates(int, boolean) TO service_role;

COMMENT ON FUNCTION public.repair_oracle_subsite_duplicates(int, boolean) IS
  'Removes the stored copies of an Oracle requisition listed on several of one '
  'tenant''s career sites, keeping the best-ranked site''s row (job_board_meta '
  'oracle_site_rank). Batched (p_max_rows deletes per call), resumable through '
  'job_board_meta.oracle_subsite_repair, idempotent when done and re-enterable '
  '(p_restart, or key-less Oracle rows / ranked duplicates found again). Refuses '
  'its delete phase until the req_key index is valid AND a bundle that dedupes at '
  'ingest has stamped oracle_site_rank.version or lowered the catalog high-water '
  'mark. Every removed row is written to job_board_exits as ''untracked'' -- OUR '
  'action, the requisition is still open on its sibling site -- and never to '
  'job_board_closures. Driven by the oracle-subsite-repair cron until phase = done.';

-- ═════════════════════════════════════════════════════════════════════════
-- 5. THE DRIVER, AND THE HIGH-WATER RESET THAT WAITS FOR .68.
-- ═════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent: call repair_oracle_subsite_duplicates() by hand until phase = done';
    RETURN;
  END IF;
  PERFORM cron.schedule(
    'oracle-subsite-repair', '*/2 * * * *',
    $job$ SELECT public.repair_oracle_subsite_duplicates(4000); $job$);

  INSERT INTO public.job_board_meta (k, v, updated_at)
  VALUES ('oracle_subsite_highwater_reset',
          jsonb_build_object('started_at', now(), 'pre_shrink_mark', 44542, 'state', 'waiting for the .68 bundle'),
          now())
  ON CONFLICT (k) DO NOTHING;

  PERFORM cron.schedule(
    'oracle-catalog-highwater-reset', '*/5 * * * *',
    $job$
    DO $r$
    DECLARE
      v_state   jsonb;
      v_mark    jsonb;
      v_key     text;
      v_chain   text;
      v_req     bigint;
      v_started timestamptz;
    BEGIN
      SELECT v INTO v_state FROM public.job_board_meta WHERE k = 'oracle_subsite_highwater_reset';
      v_started := COALESCE((v_state->>'started_at')::timestamptz, now());
      SELECT v INTO v_mark FROM public.job_board_meta WHERE k = 'catalog_highwater';
      -- Done: a reset newer than our start lowered the mark below the
      -- pre-shrink catalog -- AND IT HELD FOR TWO CONSECUTIVE TICKS. A pass
      -- still draining on the old isolate at deploy time finishes after the
      -- reset and writes its own 44,542 back (the prune raises the mark
      -- whenever its bundle's catalog exceeds it), which would re-block the
      -- prune with this job already gone. So the first sighting is recorded
      -- as a candidate and the job only stops when the lowered mark is still
      -- there ten minutes later; a mark that went back up clears the
      -- candidate and the request is re-issued.
      IF (v_mark->>'reset')::boolean IS TRUE
         AND (v_mark->>'at')::timestamptz > v_started
         AND (v_mark->>'size')::int < 44542 THEN
        IF (v_state->>'done_candidate_at') IS NOT NULL
           AND now() - (v_state->>'done_candidate_at')::timestamptz >= interval '9 minutes' THEN
          UPDATE public.job_board_meta
             SET v = v || jsonb_build_object('state', 'done', 'mark', v_mark, 'done_at', now()), updated_at = now()
           WHERE k = 'oracle_subsite_highwater_reset';
          PERFORM cron.unschedule('oracle-catalog-highwater-reset');
        ELSIF (v_state->>'done_candidate_at') IS NULL THEN
          UPDATE public.job_board_meta
             SET v = v || jsonb_build_object('state', 'lowered; confirming it holds', 'mark', v_mark, 'done_candidate_at', now()), updated_at = now()
           WHERE k = 'oracle_subsite_highwater_reset';
        END IF;
        RETURN;
      END IF;
      IF (v_state->>'done_candidate_at') IS NOT NULL THEN
        UPDATE public.job_board_meta
           SET v = (v - 'done_candidate_at') || jsonb_build_object('state', 'mark went back up after a reset; re-requesting', 'mark', v_mark,
                                                                  'reraised', COALESCE((v->>'reraised')::int, 0) + 1),
               updated_at = now()
         WHERE k = 'oracle_subsite_highwater_reset';
      END IF;
      -- Gave up: 72 hours without the .68 bundle answering. Say so and stop.
      IF now() - v_started > interval '72 hours' THEN
        UPDATE public.job_board_meta
           SET v = v || jsonb_build_object('state', 'gave_up', 'mark', v_mark, 'gave_up_at', now()), updated_at = now()
         WHERE k = 'oracle_subsite_highwater_reset';
        PERFORM cron.unschedule('oracle-catalog-highwater-reset');
        RETURN;
      END IF;
      SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets
       WHERE name = 'email_queue_service_role_key' LIMIT 1;
      IF v_key IS NULL OR v_key = '' THEN
        UPDATE public.job_board_meta
           SET v = v || jsonb_build_object('state', 'vault secret absent; cannot request the reset', 'checked_at', now()), updated_at = now()
         WHERE k = 'oracle_subsite_highwater_reset';
        RETURN;
      END IF;
      v_chain := left(encode(extensions.digest(v_key || ':board-chain', 'sha256'), 'hex'), 32);
      SELECT net.http_post(
        url     := 'https://bwhdazbotpblihdxcmho.supabase.co/functions/v1/job-board',
        body    := jsonb_build_object('action', 'refresh', 'resetCatalogHighwater', true, 'chainKey', v_chain),
        headers := '{"Content-Type": "application/json"}'::jsonb
      ) INTO v_req;
      UPDATE public.job_board_meta
         SET v = v || jsonb_build_object('state', 'requested; waiting for a reset that lowers the mark below 44542',
                                         'last_request_id', v_req, 'last_requested_at', now(),
                                         'requests', COALESCE((v->>'requests')::int, 0) + 1),
             updated_at = now()
       WHERE k = 'oracle_subsite_highwater_reset';
    END $r$;
    $job$);
END $$;

-- NO FIRST STEP HERE, ON PURPOSE. This transaction holds the ACCESS EXCLUSIVE
-- lock the column add took until it commits (20260909211000's lesson: a seed
-- run inside the migration that took the lock keeps the ingest queued behind
-- it for the seed's whole duration). The first backfill batch lands on the
-- cron's first tick, within two minutes of the commit, against a table nothing
-- is queued behind.
