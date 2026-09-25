// @vitest-environment node
/**
 * A HALF-WRITTEN PERIOD IS NEVER THE ONE THE READER SERVES.
 *
 * WHAT THIS GUARDS. The wage-cell load is a chunked sequence of calls to one
 * SECURITY DEFINER writer, and the whole lane is built around a sentence that
 * was written in four places and was FALSE: "a chunk that errors leaves the
 * previous period whole". Under the first writer it did not. public.
 * oflc_lca_wages is keyed on (company_token, soc_code, worksite_state), so a
 * chunk that landed overwrote the resident period's rows for every key it
 * carried, in place, the moment it arrived -- and the reader scopes to
 * whichever label has the newest publication date resident, so the half that
 * landed became the served period. An employer whose cells straddled the
 * failure answered a confident row with its total understated; an employer in
 * the chunks that never arrived answered a null row, which the reader's own
 * header says must never be read as "does not sponsor". Nothing would have
 * shown it: the once-a-quarter kind is deliberately outside the heartbeat's
 * watch, and the post-deploy proof reads a single token.
 *
 * WHAT MAKES IT TRUE NOW. Migration 20260925150412: every call stages its rows
 * under the run stamp, and only the call carrying the prune flag touches the
 * live table -- deleting the resident period and inserting the run's staged
 * rows in one transaction. This file proves that against a real Postgres, by
 * driving the real chunk plan the deploy builds.
 *
 * WHY IT IS BEHAVIOURAL. pglite applies the lane's migrations, the calls are
 * the ones planLcaChunks() produces, and the answers are read back through
 * get_employer_lca_wages -- the function the component actually asks. A regex
 * over the SQL would pass on a writer whose swap never ran.
 *
 * TEETH. The same interrupted load is run against a database carrying only the
 * ORIGINAL writer, and the mixture it leaves is asserted: the new period
 * resident under a partial load, the untouched tokens answering nulls, the
 * straddling employer's total understated. If that copy cannot fail the
 * property, this file is decoration.
 */
import { afterAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { planLcaChunks } from "../../supabase/functions/layoff-filings/lca-cells";
import type { LcaCell } from "../../supabase/functions/layoff-filings/lca-cells";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const migSql = (prefix: string) => {
  const f = readdirSync(MIGRATIONS).find((x) => x.startsWith(prefix) && x.endsWith(".sql"));
  if (!f) throw new Error(`no migration starts with ${prefix}`);
  return readFileSync(resolve(MIGRATIONS, f), "utf8");
};

/** The table, the first writer, the reader, the coverage columns, the staged swap. */
const TABLE = "20260923114532";
const FIRST_WRITER = "20260923114719";
const READER = "20260923114903";
/** The reader that hands back the coverage dates, which replaces it. */
const READER_2 = "20260925150733";
const COVERAGE = "20260925150221";
const SWAP = "20260925150412";
/** The aggregate the post-deploy proof asks: how much of the load is resident, and how many periods. */
const LOAD_STATE = "20260925151044";
const LANE = [TABLE, FIRST_WRITER, READER, COVERAGE, SWAP, READER_2, LOAD_STATE];

/** Booting a WASM Postgres is seconds, not milliseconds, and each case below boots its own. Under
 *  vitest's default budget these fail as TIMEOUTS when several suites compete for the machine -- a
 *  red gate that says nothing about the property. */
const BOOT_MS = 30_000;

const PREV = { quarter: "FY2026 Q2", file: "LCA_Disclosure_Data_FY2026_Q2.xlsx", published: "2026-05-20", from: "2025-10-01", to: "2026-03-31" };
const NEXT = { quarter: "FY2026 Q1-Q3", file: "LCA_Disclosure_Data_FY2026_Q3.xlsx", published: "2026-08-07", from: "2025-10-01", to: "2026-06-30" };

function cell(token: string, soc: string, low: number, p: typeof PREV): LcaCell {
  return {
    company_token: token, soc_code: soc, worksite_state: "CA", soc_title: "Software Developers",
    wage_low_annual: low, wage_high_annual: low + 20000, wage_median_annual: low + 10000, filings_n: 5,
    source_file: p.file, source_url: `https://www.dol.gov/media/${p.file}`,
    fiscal_quarter: p.quarter, published_on: p.published, coverage_from: p.from, coverage_to: p.to,
  };
}

/** Four employers, one cell each. Two chunks of two, so a failure can land between them. */
const TOKENS = ["aaa-widgets", "bbb-widgets", "ccc-widgets", "ddd-widgets"];
const RESIDENT = TOKENS.map((t) => cell(t, "15-1252", 100000, PREV));
const INCOMING = TOKENS.map((t) => cell(t, "15-1252", 200000, NEXT));

type Row = Record<string, unknown>;

/** pglite hands a date column back as a Date at UTC midnight; the payload states plain dates. */
const dateOnly = (v: unknown): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });

async function boot(lane: string[]): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;");
  for (const p of lane) await db.exec(migSql(p));
  return db;
}

/** One call to the writer, exactly as PostgREST would make it. */
async function post(db: PGlite, rows: LcaCell[], stamp: string, prune: boolean): Promise<Row> {
  const r = await db.query<Row>(
    "SELECT * FROM public.oflc_lca_wages_load($1::jsonb, $2::timestamptz, $3)",
    [JSON.stringify(rows), stamp, prune],
  );
  return r.rows[0];
}

/** The plan the deploy builds, sent as far as `upTo` calls -- the rest is the chunk that failed. */
async function runPlan(db: PGlite, rows: LcaCell[], stamp: string, chunkSize: number, upTo: number) {
  const plan = planLcaChunks(rows, stamp, chunkSize);
  expect(plan.length).toBeGreaterThan(1);
  const out: Row[] = [];
  for (const call of plan.slice(0, upTo)) out.push(await post(db, call.p_rows, call.p_run_started_at, call.p_prune));
  return { plan, out };
}

async function resident(db: PGlite) {
  const r = await db.query<{ q: string; n: number; toks: number }>(
    "SELECT fiscal_quarter AS q, count(*)::int AS n, count(DISTINCT company_token)::int AS toks FROM public.oflc_lca_wages GROUP BY 1 ORDER BY 1",
  );
  return r.rows;
}

/** What the post-deploy proof asks: the shape of the load, with no employer in it. */
async function loadState(db: PGlite): Promise<Row> {
  const r = await db.query<Row>("SELECT * FROM public.get_lca_load_state()");
  return r.rows[0];
}

async function ask(db: PGlite, tokens: string[]): Promise<Row[]> {
  const r = await db.query<Row>("SELECT * FROM public.get_employer_lca_wages($1::text[], NULL, NULL)", [tokens]);
  return r.rows;
}

describe("an interrupted load leaves the resident period exactly as it found it", () => {
  it("stages every chunk and serves none of them until the last call lands", async () => {
    const db = await boot(LANE);
    await post(db, RESIDENT, "2026-05-21T00:00:00Z", true);
    expect(await resident(db)).toEqual([{ q: PREV.quarter, n: 4, toks: 4 }]);

    // Two chunks of two; the second never arrives.
    const { plan } = await runPlan(db, INCOMING, "2026-09-25T15:04:12Z", 2, 1);
    expect(plan).toHaveLength(2);

    // THE PROPERTY. Nothing of the new period is resident, one label is
    // resident, and every asked token still answers the previous period.
    expect(await resident(db)).toEqual([{ q: PREV.quarter, n: 4, toks: 4 }]);
    const half = await ask(db, TOKENS);
    expect(half).toHaveLength(4);
    for (const row of half) {
      expect(row.ow_fiscal_quarter, `${row.ow_company_token} moved period on a half-written load`).toBe(PREV.quarter);
      expect(Number(row.ow_employer_filings_n)).toBe(5);
      expect(Number(row.ow_wage_low)).toBe(100000);
    }
    // THE PROOF A DEPLOY RUNS, over the same state: the load that failed is not
    // visible at all, and the one period resident is the previous one, whole.
    const mid = await loadState(db);
    expect(Number(mid.ls_cells)).toBe(4);
    expect(Number(mid.ls_periods)).toBe(1);
    expect(mid.ls_fiscal_quarter).toBe(PREV.quarter);

    // ...and the chunk that DID land is waiting in the stage, under the run's
    // own stamp: two rows, the ones the failed run got as far as sending.
    const staged = await db.query<{ n: number; stamps: number }>(
      "SELECT count(*)::int AS n, count(DISTINCT run_started_at)::int AS stamps FROM public.oflc_lca_wages_stage",
    );
    expect(staged.rows[0].n).toBe(2);
    expect(staged.rows[0].stamps).toBe(1);

    // The operator runs it again: the whole plan, one stamp, the swap last.
    await runPlan(db, INCOMING, "2026-09-25T16:00:00Z", 2, 2);
    expect(await resident(db)).toEqual([{ q: NEXT.quarter, n: 4, toks: 4 }]);
    const whole = await ask(db, TOKENS);
    for (const row of whole) {
      expect(row.ow_fiscal_quarter).toBe(NEXT.quarter);
      expect(Number(row.ow_wage_low)).toBe(200000);
      expect(dateOnly(row.ow_coverage_from), "the reader dropped the measured span").toBe(NEXT.from);
      expect(dateOnly(row.ow_coverage_to)).toBe(NEXT.to);
    }
    const after = await loadState(db);
    expect(Number(after.ls_cells)).toBe(4);
    expect(Number(after.ls_tokens)).toBe(4);
    expect(Number(after.ls_periods)).toBe(1);
    expect(Number(after.ls_filings)).toBe(20);
    expect(after.ls_fiscal_quarter).toBe(NEXT.quarter);
    expect(dateOnly(after.ls_coverage_from)).toBe(NEXT.from);

    // The stage is emptied by the swap, including the abandoned run's rows.
    const left = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM public.oflc_lca_wages_stage");
    expect(left.rows[0].n).toBe(0);
  }, BOOT_MS);

  it("refuses to complete a run that staged nothing, rather than emptying the period", async () => {
    const db = await boot(LANE);
    await post(db, RESIDENT, "2026-05-21T00:00:00Z", true);
    await expect(post(db, [], "2026-09-25T15:04:12Z", true)).rejects.toThrow(/staged no rows/);
    expect(await resident(db)).toEqual([{ q: PREV.quarter, n: 4, toks: 4 }]);
  }, BOOT_MS);
});

describe("the check has teeth", () => {
  it("TEETH: with only the first writer, the same interrupted load is served as a whole period", async () => {
    // The defect, reproduced: this is what the four comments claimed could not
    // happen. If this case ever stops failing the property, the swap migration
    // has stopped being the thing that provides it.
    const db = await boot([TABLE, FIRST_WRITER, READER, COVERAGE, READER_2, LOAD_STATE]);
    await post(db, RESIDENT, "2026-05-21T00:00:00Z", true);
    await runPlan(db, INCOMING, "2026-09-25T15:04:12Z", 2, 1);

    // The proof a deploy runs would see it: two periods resident at once.
    expect(Number((await loadState(db)).ls_periods)).toBe(2);
    const rows = await resident(db);
    expect(rows, "the first writer no longer mixes periods -- RE-ANCHOR this tooth").toEqual([
      { q: NEXT.quarter, n: 2, toks: 2 },
      { q: PREV.quarter, n: 2, toks: 2 },
    ]);
    const answers = await ask(db, TOKENS);
    const byToken = Object.fromEntries(answers.map((r) => [String(r.ow_company_token), r]));
    // The two tokens of the landed chunk are served as the new period...
    expect(byToken[TOKENS[0]].ow_fiscal_quarter).toBe(NEXT.quarter);
    expect(byToken[TOKENS[1]].ow_fiscal_quarter).toBe(NEXT.quarter);
    // ...and the two that never arrived answer a null row, which the reader's
    // header says never means the employer does not sponsor.
    expect(byToken[TOKENS[2]].ow_filings_n).toBeNull();
    expect(byToken[TOKENS[3]].ow_filings_n).toBeNull();
  }, BOOT_MS);
});
