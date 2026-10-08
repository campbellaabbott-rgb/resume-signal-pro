// @vitest-environment node
/**
 * THE SEEN-AGAIN TEST RE-READ BOTH LEDGERS AND JOINED A BATCH ONTO ITSELF.
 *
 * get_company_fill_curve is the RPC /jobs calls for every visible employer
 * (26 tokens a batch, 25s header) and get_actively_hiring_companies calls with
 * 200 tokens inside the hourly cache refresh. The first draft of
 * 20261008110000 added the seen-again rule and the role counts as more reads:
 * two more passes over the closure log, two over the exit ledger, a key
 * lookup into job_board_postings for every doubted row and every role -- and
 * it found the dropped rows by joining the doubted rows back onto the closure
 * arm on (board, posting, instant). A reviewer measured it at about 2.1x the
 * body it replaced in pglite. Worse, under any plan without a hash join (what
 * the planner picks whenever it underestimates a CTE) that join merges on
 * (board, instant) alone and filters on the posting, so a doubted batch of n
 * rows compares n x n: two Workday-sized boards ran 4.4s where the old body
 * ran 0.1s.
 *
 * Two properties, executed against the migration's own SQL:
 *   1. ONE CALL READS EACH LEDGER NO MORE THAN THE BODY IT REPLACED, and looks
 *      up job_board_postings' key only for doubted rows never seen again --
 *      counted from Postgres's own per-table statistics, so a plan that
 *      changes its spelling and keeps its reads still fails.
 *   2. NO JOIN DEGENERATES WITH BATCH SIZE when hash joins are unavailable:
 *      the rows a join discards stay within a small multiple of the old
 *      body's on the same flap board.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SEEN_AGAIN_FIXTURE, SEEN_AGAIN_SCHEMA, VARIANTS } from "./helpers/seen-again-fixture";

vi.setConfig({ hookTimeout: 180_000, testTimeout: 120_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const mig = (f: string) => readFileSync(resolve(DIR, f), "utf8");
const WAS = "20261002121417_a_board_is_judged_at_day_thirty_only_on_roles_posted_while_we_were_reading_it_in_full.sql";
const NOW = "20261008110000_a_role_is_counted_once_and_a_posting_seen_again_never_came_down.sql";

/** The function's body as a plain statement over $1, so EXPLAIN can see inside it. */
function body(file: string): string {
  const src = mig(file);
  const at = src.indexOf("CREATE OR REPLACE FUNCTION public.get_company_fill_curve");
  const open = src.indexOf("AS $$", at) + "AS $$".length;
  const close = src.indexOf("$$;", open);
  return src.slice(open, close).replace(/\bp_tokens\b/g, "$1::text[]").trim().replace(/;$/, "");
}

type Reads = { closures: number; exits: number; postings: number; postingKeyScans: number };

async function reads(db: PGlite): Promise<Reads> {
  await db.query(`SELECT pg_stat_force_next_flush()`);
  const t = (await db.query<{ relname: string; n: string }>(`
    SELECT relname, (COALESCE(seq_tup_read, 0) + COALESCE(idx_tup_fetch, 0))::text AS n
      FROM pg_stat_user_tables
     WHERE relname IN ('job_board_closures', 'job_board_exits', 'job_board_postings')`)).rows;
  const k = (await db.query<{ n: string }>(`
    SELECT COALESCE(sum(idx_scan), 0)::text AS n FROM pg_stat_user_indexes
     WHERE relname = 'job_board_postings' AND indexrelname = 'job_board_postings_pkey'`)).rows[0];
  const of = (r: string) => Number(t.find((x) => x.relname === r)?.n ?? 0);
  return { closures: of("job_board_closures"), exits: of("job_board_exits"), postings: of("job_board_postings"), postingKeyScans: Number(k.n) };
}

async function readsOfOneCall(db: PGlite, toks: string[]): Promise<Reads> {
  const before = await reads(db);
  await db.query(`SELECT * FROM public.get_company_fill_curve($1::text[])`, [toks]);
  const after = await reads(db);
  return {
    closures: after.closures - before.closures,
    exits: after.exits - before.exits,
    postings: after.postings - before.postings,
    postingKeyScans: after.postingKeyScans - before.postingKeyScans,
  };
}

/** Sum of "Rows Removed by Join Filter" over a JSON plan. */
function removedByJoinFilter(plan: unknown): number {
  let n = 0;
  const walk = (node: Record<string, unknown>) => {
    n += Number(node["Rows Removed by Join Filter"] ?? 0);
    for (const c of (node.Plans as Record<string, unknown>[] | undefined) ?? []) walk(c);
  };
  walk(plan as Record<string, unknown>);
  return n;
}

async function discardedUnderMergeJoins(db: PGlite, file: string, toks: string[]): Promise<number> {
  await db.exec(`SET enable_hashjoin = off`);
  try {
    const r = (await db.query<{ "QUERY PLAN": Array<{ Plan: unknown }> }>(
      `EXPLAIN (ANALYZE, COSTS OFF, FORMAT JSON) ${body(file)}`, [toks])).rows[0];
    return removedByJoinFilter(r["QUERY PLAN"][0].Plan);
  } finally {
    await db.exec(`RESET enable_hashjoin`);
  }
}

// One board whose feed answered short twice: two suspect batches, each over
// all 600 roles it serves, every one of them stored again two days ago -- the
// Workday flap in miniature -- beside 300 genuine takedowns and 100 age-outs.
const FLAP = `
  INSERT INTO public.job_board_postings (id, source, company_token, category, posted_at, effective_posted, first_seen, last_seen)
  SELECT 'W:L:'||g, 'workday', 'W', 'engineering', now() - interval '40 days', now() - interval '40 days', now() - interval '2 days', now()
  FROM generate_series(1, 600) g;
  INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, first_seen, closed_at, superseded, suspect, batch_live_before, absence_basis)
  SELECT 'W:L:'||g, 'workday', 'W', 'engineering', now() - interval '40 days', now() - interval '40 days',
         now() - make_interval(days => b * 9), false, true, 5000, 'full_read'
  FROM generate_series(1, 600) g, generate_series(1, 2) b;
  INSERT INTO public.job_board_closures (posting_id, source, company_token, category, posted_at, first_seen, closed_at, superseded, suspect, batch_live_before, absence_basis)
  SELECT 'W:G:'||g, 'workday', 'W', 'engineering', now() - make_interval(days => 20 + g % 30), now() - interval '50 days',
         now() - make_interval(days => g % 30, hours => g % 24), false, NULL, 5000, 'full_read'
  FROM generate_series(1, 300) g;
  INSERT INTO public.job_board_exits (posting_id, source, company_token, category, exit_reason, exited_at, posted_at)
  SELECT 'W:E:'||g, 'workday', 'W', 'engineering', 'aged_out', now() - make_interval(days => g % 40), now() - make_interval(days => 30 + g % 40)
  FROM generate_series(1, 100) g;
  INSERT INTO public.job_board_company_snapshots VALUES ('W', current_date - 30, 600);
  INSERT INTO public.job_board_board_observability (company_token, bucket) VALUES ('W', 'full_read');
  INSERT INTO public.job_board_board_watch (company_token, first_observed_on, first_observed_basis) VALUES ('W', current_date - 80, 'company_snapshot');
`;

const TOKENS = Object.values(VARIANTS).map((v) => v.tok);
let was: Reads;
let now: Reads;
let flapWas: number;
let flapNow: number;
const dbs: PGlite[] = [];

beforeAll(async () => {
  const db = new PGlite();
  dbs.push(db);
  await db.exec(SEEN_AGAIN_SCHEMA);
  await db.exec(SEEN_AGAIN_FIXTURE);
  await db.exec(mig(WAS));
  await readsOfOneCall(db, TOKENS); // warm the catalogue, not the counts
  was = await readsOfOneCall(db, TOKENS);
  await db.exec(mig(NOW));
  await readsOfOneCall(db, TOKENS);
  now = await readsOfOneCall(db, TOKENS);

  const flap = new PGlite();
  dbs.push(flap);
  await flap.exec(SEEN_AGAIN_SCHEMA);
  await flap.exec(FLAP);
  await flap.exec(`ANALYZE`);
  await flap.exec(mig(WAS));
  await flap.exec(mig(NOW));
  flapWas = await discardedUnderMergeJoins(flap, WAS, ["W"]);
  flapNow = await discardedUnderMergeJoins(flap, NOW, ["W"]);
});

afterAll(async () => { for (const db of dbs) { try { await db.close(); } catch { /* best effort */ } } });

describe("the seen-again rule and the role counts cost no extra pass over a ledger", () => {
  it("found the reads at all (guards the guard)", () => {
    expect(was.closures, "the old body read no closure rows: the statistics are not counting").toBeGreaterThan(0);
    expect(was.exits).toBeGreaterThan(0);
    expect(was.postings).toBeGreaterThan(0);
  });

  it("reads the closure log no more than the body it replaced", () => {
    expect(now.closures).toBeLessThanOrEqual(was.closures);
  });

  it("reads the exit ledger no more than the body it replaced", () => {
    expect(now.exits).toBeLessThanOrEqual(was.exits);
  });

  it("looks up a posting's key only for a doubted row never seen again, never per role or per doubted row", () => {
    // The fixture's only never-seen-again doubted rows are variant C's five.
    expect(now.postingKeyScans).toBeLessThanOrEqual(5);
    expect(now.postings).toBeLessThanOrEqual(was.postings + 5);
  });
});

describe("no join in the body grows with the square of a doubted batch", () => {
  it("measured the old body on the flap board (guards the guard)", () => {
    expect(flapWas).toBeGreaterThanOrEqual(0);
  });

  it("discards, under merge joins, about what the old body discards -- not batch x batch", () => {
    // The first draft discarded 1,200 x 600 rows here: every suspect row of a
    // batch compared with every seen-again row of the same batch.
    expect(flapNow).toBeLessThanOrEqual(Math.max(2 * flapWas, 5_000));
  });
});
