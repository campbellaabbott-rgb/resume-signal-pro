-- A PROPOSAL IS NOT A MOVE.
--
-- The Other bucket holds 172,619 rows (categoriesFacet head-row value,
-- 2026-09-10) that the v9 field rules could not sort. The plan for it -- three
-- classifiers (a v10 rule pass, seven guarded employer defaults, a title-only
-- kNN over a frozen anchor table), hand-judged on a 2,576-row stratified
-- sample with 2,318 title decisions on disk (scratchpad/other-bucket/
-- judgments.json) -- moves roughly a quarter of the bucket and leaves three
-- quarters where they are BY CONSTRUCTION. Its first rule, before any of the
-- mechanisms: NO PASS WRITES `category`. A classifier writes what it PROPOSES,
-- with the mechanism that proposed it and the key inside that mechanism; a
-- human reads a drawn audit of that key; only then does one function, and one
-- function only, move the rows -- and the proposal stays on the row afterwards
-- so the move can be counted, shown, and undone by one statement.
--
-- THIS FILE IS THE SHADOW. Six nullable columns and one partial index. It
-- writes NO row: every column is NULL after this migration, nothing here
-- touches `category`, and nothing here reads a title. The passes that fill
-- these columns ride the job-board bundle (categories.ts v10, shadow.ts,
-- embed-classify.ts) and are wired in a later phase; the one writer of
-- `category` is promote_category (20260909225500); its mirror is
-- revert_category (20260909226000).
--
-- THE COLUMNS
--
--   category_proposed     the field a mechanism proposes (a visible field
--                         slug, or a shadow-only candidate slug such as
--                         media_entertainment that visibleCategories() never
--                         serves -- so the bucket can be COUNTED per candidate
--                         vertical before anyone builds a tile for it). NOT
--                         constrained to the visible list on purpose.
--   category_basis        which mechanism: 'rule' | 'employer' | 'embed'.
--                         CHECK-constrained; a fourth mechanism is a schema
--                         change, not a string.
--   category_key          the key inside the mechanism the audit and the
--                         revert are scoped to: the rule TERM (one key per
--                         term, e.g. 'commis'), the employer's company_token
--                         (never its display name -- a token is pinned at
--                         build time, a name match at runtime is forbidden),
--                         or the embed anchor version ('embed_knn_v1'). The
--                         special value 'conflict' marks a row two mechanisms
--                         disagreed on: nothing is proposed for it, and the
--                         CHECK below refuses a proposal on a conflict row.
--   category_confidence   the mechanism's own figure: the employer's measured
--                         purity, the kNN similarity-weighted share; 1 for a
--                         rule (categories.ts RULE_CONFIDENCE -- a rule is
--                         right or wrong, and its judged figures live in the
--                         audit, not in this column).
--   category_proposed_at  when the proposal was written.
--   category_proposed_v   the CATEGORIZE_VERSION (rule) or shadow version
--                         (employer, embed) that wrote it, so a later bump can
--                         tell a stale proposal from a fresh one.
--
-- FIRST CLAIM WINS, IN THE ORDER rule -> employer -> embed (plan/union.txt on
-- the sample: rule 419, employer +317, embed +155; reversing the order changes
-- nothing about precision but would stamp rule-explainable rows with an
-- inference basis). A mechanism that would propose a DIFFERENT field than the
-- one already on the row writes nothing and sets category_key = 'conflict'
-- (26 on the sample, 24 of them Saks 'Selling Advisor' hospitality_retail vs
-- sales -- a convention split, not a wrong field).
--
-- BASIS IS PERMANENT. promote_category sets `category` and leaves all six
-- columns exactly as they were, so Explore can count inferred rows separately
-- from rule-filed ones, the facet can show them, and
--   UPDATE public.job_board_postings SET category = 'other', category_proposed = NULL
--    WHERE category_basis = 'embed' AND category_key = 'embed_knn_v1';
-- is the whole revert (revert_category is that statement with its guards).
--
-- THE THREE CHECKS, added NOT VALID and then VALIDATED: ADD CONSTRAINT with a
-- validation scan holds ACCESS EXCLUSIVE on a table the ingest writes to every
-- few seconds; NOT VALID is instant, and VALIDATE takes only SHARE UPDATE
-- EXCLUSIVE. Every new column is NULL, so validation reads the table once and
-- finds nothing.
--   basis_chk       category_basis IS NULL OR IN ('rule','employer','embed')
--   proposal_chk    a proposal names its basis (proposed => basis NOT NULL)
--   conflict_chk    a conflict row carries no proposal (key='conflict' =>
--                   proposed IS NULL)
--
-- THE INDEX. (category_basis, category_proposed) WHERE category = 'other' --
-- the shape the promotion UPDATE probes (basis, key, target over the bucket)
-- and the shape a per-basis, per-candidate count reads. Built CONCURRENTLY,
-- outside this transaction, by the same one-shot pg_cron pair 20260909216000
-- used for req_key: this file runs inside the migration runner's transaction
-- and CREATE INDEX CONCURRENTLY refuses to run inside one; a plain build on a
-- ~940k-row table would hold SHARE against the ingest for its whole scan (the
-- 2026-07-19 wedge shape). The watcher drops an INVALID index only when no
-- build is in flight and only under a 2-second lock_timeout, and unschedules
-- both jobs once the index is valid. Where pg_cron is absent (pglite, a local
-- shell) the NOTICE names the statement to run by hand, and the harness
-- (scripts/verify-migration-20260909224000.mjs) runs exactly that statement.
--
-- THE PROMOTION LIST is seeded EMPTY here so promote_category's read is
-- well-defined from the first call: job_board_meta k = 'category_promotions',
-- v = [] (a bare array). Entries are written BY HAND, after an audit file exists
-- under scratchpad/other-bucket/audit/<basis>-<key>.md (TEMPLATE.md there);
-- no function in this repository writes that row. This build ships ZERO
-- promotions.
--
-- WHAT DOES NOT CHANGE. `category` and its NOT NULL DEFAULT 'other'; every
-- existing index; the v9 sweep (it still writes `category` directly until the
-- phase that rewires it to the shadow columns ships -- that rewiring is the
-- index.ts change this file deliberately does not make).

-- ═════════════════════════════════════════════════════════════════════════
-- 1. THE COLUMNS. Nullable, no default: an instant catalog change once the
--    lock is taken; the lock is retried, never queued behind the ingest.
-- ═════════════════════════════════════════════════════════════════════════
DO $$
DECLARE attempt int := 0;
BEGIN
  SET LOCAL lock_timeout = '3s';
  LOOP
    attempt := attempt + 1;
    BEGIN
      ALTER TABLE public.job_board_postings
        ADD COLUMN IF NOT EXISTS category_proposed    text,
        ADD COLUMN IF NOT EXISTS category_basis       text,
        ADD COLUMN IF NOT EXISTS category_key         text,
        ADD COLUMN IF NOT EXISTS category_confidence  real,
        ADD COLUMN IF NOT EXISTS category_proposed_at timestamptz,
        ADD COLUMN IF NOT EXISTS category_proposed_v  integer;
      EXIT;
    EXCEPTION WHEN lock_not_available THEN
      IF attempt >= 10 THEN
        RAISE EXCEPTION 'could not take the lock to add the category shadow columns after % attempts; re-run when the ingest is quieter', attempt;
      END IF;
      RAISE NOTICE 'lock busy, retrying the shadow-column add (attempt %)', attempt;
      PERFORM pg_sleep(2);
    END;
  END LOOP;
END $$;

COMMENT ON COLUMN public.job_board_postings.category_proposed IS
  'SHADOW: the field a classifier proposes for this row. NOT a move -- '
  '`category` changes only through promote_category(basis, key, target), and '
  'only for triples listed by hand in job_board_meta.category_promotions after '
  'an audit file exists. Stays on the row after promotion. May carry a '
  'shadow-only candidate slug the board never serves, so candidates can be '
  'counted before a tile exists. NULL on a conflict row.';
COMMENT ON COLUMN public.job_board_postings.category_basis IS
  'SHADOW: which mechanism proposed category_proposed -- rule (categories.ts, '
  'one key per term), employer (a guarded per-company_token default), embed '
  '(title-only kNN over job_board_category_anchors). Permanent: survives '
  'promotion and revert, so inferred rows can be counted apart from rule-filed '
  'ones and any basis can be reverted by one statement.';
COMMENT ON COLUMN public.job_board_postings.category_key IS
  'SHADOW: the key the audit and the revert are scoped to -- the rule term, '
  'the employer''s company_token (never a display name), or the embed anchor '
  'version (embed_knn_v1; an anchor change bumps it, and every promotion '
  'listed under the old key stops matching by construction). ''conflict'' '
  'marks a row two mechanisms disagreed on: no proposal, never promotable.';
COMMENT ON COLUMN public.job_board_postings.category_confidence IS
  'SHADOW: the mechanism''s own figure for this proposal -- the employer''s '
  'measured purity, the kNN similarity-weighted share, 1 for a rule '
  '(RULE_CONFIDENCE). Never NULL on a proposal; NULL on a conflict row.';
COMMENT ON COLUMN public.job_board_postings.category_proposed_at IS
  'SHADOW: when the proposal was written.';
COMMENT ON COLUMN public.job_board_postings.category_proposed_v IS
  'SHADOW: the CATEGORIZE_VERSION (rule) or shadow version (employer, embed) '
  'that wrote the proposal, so a later bump can tell stale from fresh.';

-- ═════════════════════════════════════════════════════════════════════════
-- 2. THE CHECKS. NOT VALID first (instant), VALIDATE second (no write block).
-- ═════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_board_postings_category_basis_chk') THEN
    ALTER TABLE public.job_board_postings
      ADD CONSTRAINT job_board_postings_category_basis_chk
      CHECK (category_basis IS NULL OR category_basis IN ('rule', 'employer', 'embed')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_board_postings_category_proposal_chk') THEN
    ALTER TABLE public.job_board_postings
      ADD CONSTRAINT job_board_postings_category_proposal_chk
      CHECK (category_proposed IS NULL OR category_basis IS NOT NULL) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'job_board_postings_category_conflict_chk') THEN
    ALTER TABLE public.job_board_postings
      ADD CONSTRAINT job_board_postings_category_conflict_chk
      CHECK (category_key IS DISTINCT FROM 'conflict' OR category_proposed IS NULL) NOT VALID;
  END IF;
END $$;

ALTER TABLE public.job_board_postings VALIDATE CONSTRAINT job_board_postings_category_basis_chk;
ALTER TABLE public.job_board_postings VALIDATE CONSTRAINT job_board_postings_category_proposal_chk;
ALTER TABLE public.job_board_postings VALIDATE CONSTRAINT job_board_postings_category_conflict_chk;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. THE INDEX, BUILT OUTSIDE THIS TRANSACTION, WITH A WATCHER THAT STOPS IT.
-- ═════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron absent: build job_board_postings_category_shadow_idx by hand (CREATE INDEX CONCURRENTLY ... (category_basis, category_proposed) WHERE category = ''other'')';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'job_board_postings_category_shadow_idx') THEN
    RAISE NOTICE 'job_board_postings_category_shadow_idx already present';
    RETURN;
  END IF;
  -- ONE statement, no SET in front of it: a multi-statement command string
  -- runs as one implicit transaction and CREATE INDEX CONCURRENTLY refuses it.
  PERFORM cron.schedule(
    'oneshot-category-shadow-idx', '* * * * *',
    'CREATE INDEX CONCURRENTLY IF NOT EXISTS job_board_postings_category_shadow_idx ON public.job_board_postings (category_basis, category_proposed) WHERE category = ''other''');
  -- The watcher (20260909216000''s shape): a valid index unschedules both
  -- jobs; an INVALID one is dropped so the builder can try again -- but only
  -- when no build is in flight (pg_stat_progress_create_index), and only under
  -- a 2-second lock_timeout, so the drop can never queue ACCESS EXCLUSIVE
  -- behind the builder on the hot table.
  PERFORM cron.schedule(
    'oneshot-category-shadow-idx-watch', '* * * * *',
    $job$
    DO $w$
    DECLARE
      v_valid    boolean;
      v_building boolean;
    BEGIN
      SELECT i.indisvalid INTO v_valid
        FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
       WHERE c.relname = 'job_board_postings_category_shadow_idx';
      IF v_valid IS TRUE THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-category-shadow-idx') THEN
          PERFORM cron.unschedule('oneshot-category-shadow-idx');
        END IF;
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'oneshot-category-shadow-idx-watch') THEN
          PERFORM cron.unschedule('oneshot-category-shadow-idx-watch');
        END IF;
      ELSIF v_valid IS FALSE THEN
        SELECT EXISTS (
          SELECT 1
            FROM pg_stat_progress_create_index p
            JOIN pg_class c ON c.oid = p.index_relid
           WHERE c.relname = 'job_board_postings_category_shadow_idx'
        ) INTO v_building;
        IF NOT v_building THEN
          BEGIN
            SET LOCAL lock_timeout = '2s';
            DROP INDEX IF EXISTS public.job_board_postings_category_shadow_idx;
          EXCEPTION WHEN lock_not_available THEN
            RAISE NOTICE 'job_board_postings_category_shadow_idx is invalid but locked (a build may have just started); the next tick looks again';
          END;
        END IF;
      END IF;
    END $w$;
    $job$);
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. THE PROMOTION LIST, SEEDED EMPTY. Hand-written thereafter; no function
--    writes it. The value is a BARE JSON ARRAY -- the one shape both readers
--    (promote_category here, readPromotions in shadow.ts) accept without a
--    wrapper key; a wrapped {"list": [...]} or {"promotions": [...]} is
--    tolerated by the SQL side only, so write the array. Per entry (every
--    field required by promote_category):
--      {"basis": "rule" | "employer" | "embed",
--       "key":    <term | company_token | anchor version>,
--       "target": <field slug>,
--       "audit":  "<basis>-<key>.md"   -- the file under other-bucket/audit/
--       "judged": <int>, "wrong": <int>}  -- from that file's table
--    job_board_meta is SERVICE-ROLE ONLY (20260722154749 revoked SELECT from
--    anon and authenticated and left one service_role policy), so a UI that
--    shows the list reads it through a definer RPC, never from the browser.
-- ═════════════════════════════════════════════════════════════════════════
INSERT INTO public.job_board_meta (k, v, updated_at)
VALUES ('category_promotions', '[]'::jsonb, now())
ON CONFLICT (k) DO NOTHING;
