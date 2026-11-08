// @vitest-environment node
/**
 * A PRUNED LAYOFF FILING IS COUNTED ONCE, IN THE COLUMN ITS STATUS NAMES
 * (sweep M-S14-040; migration 20261110160000).
 *
 * The monthly prune (roll_up_and_prune_layoff_filings, 20261008113500)
 * deleted every row of each whole month past the keep window and counted
 * every one as a filing, adding every row's workers: the ancestor a WARN
 * update superseded, a rescinded notice, an 8-K/A, an exit-cost 8-K that is
 * not a workforce event. The readers show none of those. The only record left
 * after the prune overstated both columns, and the prune cannot be undone.
 *
 * Executed in pglite, started from Supabase's default grants (every new table
 * and function is granted to anon and authenticated unless revoked), at the
 * cron's own instant: 2026-12-01 04:20 UTC, keep 365 days, so November 2025 is
 * the month rolled. The migration file applies whole and checks itself; the
 * function is then run pinned to that instant.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { definitionAt, migFile } from "./helpers/fixed-clock-sql";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const NEW = "20261110160000_a_pruned_filing_is_counted_once_in_the_column_its_status_names.sql";
const OLD = "20261008113500_a_filing_month_is_rolled_whole_and_counted_once.sql";
const AT = "2026-12-01T04:20:00Z";
const FN = "roll_up_and_prune_layoff_filings";

// The tables as 20260918100000 made them (the columns this function reads),
// under Supabase's default grants, then locked as that file locks them.
const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.layoff_filings (
    filing_id text PRIMARY KEY, source text NOT NULL, status text NOT NULL DEFAULT 'active',
    form text, is_workforce_event boolean, state char(2), event_date date NOT NULL, workers int);
  CREATE TABLE public.layoff_filing_rollup (
    month date NOT NULL, source text NOT NULL, state text NOT NULL DEFAULT '', filings int NOT NULL DEFAULT 0,
    workers_sum bigint, rolled_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (month, source, state));
  CREATE TABLE public.layoff_read_log (id bigserial PRIMARY KEY, read_at timestamptz NOT NULL);
  ALTER TABLE public.layoff_filing_rollup ENABLE ROW LEVEL SECURITY;
  REVOKE ALL ON TABLE public.layoff_filings FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON TABLE public.layoff_filing_rollup FROM PUBLIC, anon, authenticated;
  REVOKE ALL ON TABLE public.layoff_read_log FROM PUBLIC, anon, authenticated;
`;

// November 2025, one month of what the mirror stores. Each row says where it belongs.
const NOVEMBER = `
  INSERT INTO public.layoff_filings (filing_id, source, status, form, is_workforce_event, state, event_date, workers) VALUES
    ('warn:ca-1',      'state_warn', 'active',     NULL,    NULL,  'CA', '2025-11-03', 120),  -- filing
    ('warn:ca-2',      'state_warn', 'active',     NULL,    NULL,  'CA', '2025-11-10',  60),  -- filing
    ('warn:ca-3a',     'state_warn', 'superseded', NULL,    NULL,  'CA', '2025-11-12', 100),  -- superseded: the update below replaced it
    ('warn:ca-3b',     'state_warn', 'active',     NULL,    NULL,  'CA', '2025-11-20', 110),  -- filing: the update
    ('warn:ca-4',      'state_warn', 'rescinded',  NULL,    NULL,  'CA', '2025-11-25',  75),  -- rescinded
    ('warn:ny-1',      'state_warn', 'amended',    NULL,    NULL,  'NY', '2025-11-05',  90),  -- superseded (amended)
    ('sec:0001-25-1',  'sec_8k_205', 'active',     '8-K',   true,  NULL, '2025-11-04', NULL), -- filing
    ('sec:0001-25-2',  'sec_8k_205', 'active',     '8-K',   false, NULL, '2025-11-06', NULL), -- non-workforce: an exit cost
    ('sec:0001-25-3',  'sec_8k_205', 'active',     '8-K',   NULL,  NULL, '2025-11-18', NULL), -- non-workforce: never parsed as one
    ('sec:0001-25-4',  'sec_8k_205', 'amendment',  '8-K/A', true,  NULL, '2025-11-21', NULL), -- amendment
    ('warn:ca-dec',    'state_warn', 'active',     NULL,    NULL,  'CA', '2025-12-02',  40);  -- December: not ended before the cutoff
`;

type Roll = { month: string; source: string; state: string; filings: number; workers_sum: number | null; superseded_n: number | null; amendment_n: number | null; rescinded_n: number | null; non_workforce_n: number | null };
const rollup = async (db: PGlite): Promise<Roll[]> =>
  (await db.query<Roll>(`SELECT month::text, source, state, filings, workers_sum::int AS workers_sum, superseded_n, amendment_n, rescinded_n, non_workforce_n
                           FROM public.layoff_filing_rollup ORDER BY month, source, state`)).rows;
const count = async (db: PGlite, where = "true") =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.layoff_filings WHERE ${where}`)).rows[0].n;

const dbs: PGlite[] = [];
const boot = async (fn: "new" | "old" = "new"): Promise<PGlite> => {
  const db = new PGlite();
  dbs.push(db);
  await db.exec(SCHEMA);
  if (fn === "new") {
    await db.exec(migFile(NEW));
    await db.exec(definitionAt(NEW, FN, AT, "at"));
  } else {
    await db.exec(definitionAt(OLD, FN, AT, "at"));
  }
  return db;
};
const prune = async (db: PGlite) => (await db.query<{ lr_months_rolled: number; lr_filings_pruned: number }>(`SELECT * FROM public.${FN}_at(365)`)).rows[0];
afterAll(async () => { for (const db of dbs) { try { await db.close(); } catch { /* best effort */ } } });

describe("the month the 1 December run rolls", () => {
  let db: PGlite;
  let run: { lr_months_rolled: number; lr_filings_pruned: number };
  beforeAll(async () => {
    db = await boot();
    await db.exec(NOVEMBER);
    run = await prune(db);
  });

  it("counts as filings only what the readers show, and their workers only", async () => {
    expect(await rollup(db)).toEqual([
      { month: "2025-11-01", source: "sec_8k_205", state: "", filings: 1, workers_sum: null, superseded_n: 0, amendment_n: 1, rescinded_n: 0, non_workforce_n: 2 },
      { month: "2025-11-01", source: "state_warn", state: "CA", filings: 3, workers_sum: 290, superseded_n: 1, amendment_n: 0, rescinded_n: 1, non_workforce_n: 0 },
      { month: "2025-11-01", source: "state_warn", state: "NY", filings: 0, workers_sum: null, superseded_n: 1, amendment_n: 0, rescinded_n: 0, non_workforce_n: 0 },
    ]);
  });

  it("the five columns add up to the rows the run deleted, and December stays", async () => {
    expect(run.lr_filings_pruned).toBe(10);
    expect(run.lr_months_rolled).toBe(3);
    const total = (await rollup(db)).reduce((a, r) => a + r.filings + r.superseded_n! + r.amendment_n! + r.rescinded_n! + r.non_workforce_n!, 0);
    expect(total).toBe(run.lr_filings_pruned);
    expect(await count(db)).toBe(1);
    expect(await count(db, "filing_id = 'warn:ca-dec'")).toBe(1);
  });

  it("a second run the same day changes nothing", async () => {
    const before = await rollup(db);
    expect((await prune(db)).lr_filings_pruned).toBe(0);
    expect(await rollup(db)).toEqual(before);
  });

  it("teeth: the old prune counted all ten rows as filings and added the superseded and rescinded headcounts", async () => {
    const old = await boot("old");
    await old.exec(NOVEMBER);
    await prune(old);
    const rows = (await old.query<{ filings: number; workers_sum: number | null; state: string; source: string }>(
      `SELECT source, state, filings, workers_sum::int AS workers_sum FROM public.layoff_filing_rollup ORDER BY source, state`)).rows;
    expect(rows.reduce((a, r) => a + r.filings, 0)).toBe(10);
    expect(rows.find((r) => r.state === "CA")?.workers_sum).toBe(120 + 60 + 100 + 110 + 75);
  });
});

describe("every pruned row lands in exactly one column", () => {
  const sources = ["state_warn", "sec_8k_205"];
  const statuses = ["active", "amended", "superseded", "rescinded", "amendment"];
  const flags = ["true", "false", "NULL"];
  const want = (source: string, status: string, flag: string): keyof Roll => {
    if (status === "active") return source !== "sec_8k_205" || flag === "true" ? "filings" : "non_workforce_n";
    if (status === "superseded" || status === "amended") return "superseded_n";
    return status === "amendment" ? "amendment_n" : "rescinded_n";
  };

  it("for every source, status and workforce flag the table allows", async () => {
    const db = await boot();
    let i = 0;
    for (const source of sources) for (const status of statuses) for (const flag of flags) {
      i += 1;
      await db.exec(`DELETE FROM public.layoff_filing_rollup;
        INSERT INTO public.layoff_filings (filing_id, source, status, is_workforce_event, state, event_date, workers)
        VALUES ('row-${i}', '${source}', '${status}', ${flag}, ${source === "state_warn" ? "'CA'" : "NULL"}, '2025-11-14', 25)`);
      expect((await prune(db)).lr_filings_pruned).toBe(1);
      const [r] = await rollup(db);
      const cols = (["filings", "superseded_n", "amendment_n", "rescinded_n", "non_workforce_n"] as const).filter((c) => r[c] === 1);
      expect(cols, `${source} ${status} workforce=${flag}`).toEqual([want(source, status, flag)]);
      expect(r.workers_sum, `${source} ${status} workforce=${flag}: workers only for a filing`).toBe(cols[0] === "filings" ? 25 : null);
    }
    expect(i).toBe(30);
  });

  it("a status no column counts stops the run before anything is deleted", async () => {
    const db = await boot();
    await db.exec(NOVEMBER);
    await db.exec(`INSERT INTO public.layoff_filings (filing_id, source, status, state, event_date, workers) VALUES ('warn:odd', 'state_warn', 'withdrawn', 'CA', '2025-11-15', 30)`);
    await expect(prune(db)).rejects.toThrow(/a status no rollup column counts; nothing was deleted/);
    expect(await count(db)).toBe(12);
    expect(await rollup(db)).toEqual([]);
  });
});

describe("months already rolled", () => {
  it("a late filing joins a month rolled by this rule in its own column", async () => {
    const db = await boot();
    await db.exec(NOVEMBER);
    await prune(db);
    await db.exec(`INSERT INTO public.layoff_filings (filing_id, source, status, state, event_date, workers) VALUES
      ('warn:ca-late', 'state_warn', 'active', 'CA', '2025-11-28', 55), ('warn:ca-late-r', 'state_warn', 'rescinded', 'CA', '2025-11-29', 20)`);
    await prune(db);
    const ca = (await rollup(db)).find((r) => r.state === "CA")!;
    expect(ca).toMatchObject({ filings: 4, workers_sum: 345, superseded_n: 1, rescinded_n: 2 });
  });

  it("a month rolled before this file keeps its every-row count, and a late row joins it by that rule", async () => {
    const db = await boot();
    // What the old prune left for October 2025: every row counted, no breakdown.
    await db.exec(`INSERT INTO public.layoff_filing_rollup (month, source, state, filings, workers_sum) VALUES ('2025-10-01', 'state_warn', 'CA', 7, 700)`);
    await db.exec(`INSERT INTO public.layoff_filings (filing_id, source, status, state, event_date, workers) VALUES
      ('warn:oct-late', 'state_warn', 'active', 'CA', '2025-10-30', 50), ('warn:oct-late-s', 'state_warn', 'superseded', 'CA', '2025-10-20', 40)`);
    await prune(db);
    const oct = (await rollup(db)).find((r) => r.month === "2025-10-01")!;
    expect(oct).toEqual({ month: "2025-10-01", source: "state_warn", state: "CA", filings: 9, workers_sum: 790, superseded_n: null, amendment_n: null, rescinded_n: null, non_workforce_n: null });
  });
});

describe("the migration", () => {
  it("applies twice from Supabase's default grants and leaves the prune and the rollup closed to clients", async () => {
    const db = await boot();
    await db.exec(migFile(NEW));
    const acl = (await db.query<{ anon: boolean; auth: boolean; svc: boolean; tab_anon: boolean; col_anon: boolean }>(`
      SELECT has_function_privilege('anon', 'public.${FN}(int)', 'EXECUTE') AS anon,
             has_function_privilege('authenticated', 'public.${FN}(int)', 'EXECUTE') AS auth,
             has_function_privilege('service_role', 'public.${FN}(int)', 'EXECUTE') AS svc,
             has_table_privilege('anon', 'public.layoff_filing_rollup', 'SELECT') AS tab_anon,
             has_column_privilege('anon', 'public.layoff_filing_rollup', 'non_workforce_n', 'SELECT') AS col_anon`)).rows[0];
    expect(acl).toEqual({ anon: false, auth: false, svc: true, tab_anon: false, col_anon: false });
  });

  it("refuses to finish when the definition it leaves still counts every row", async () => {
    const db = new PGlite();
    dbs.push(db);
    await db.exec(SCHEMA);
    const broken = migFile(NEW).replace(
      "WHEN f.status = 'active' AND (f.source <> 'sec_8k_205' OR f.is_workforce_event IS TRUE) THEN 'filing'",
      "WHEN true THEN 'filing'",
    );
    expect(broken).not.toBe(migFile(NEW));
    await expect(db.exec(broken)).rejects.toThrow(/still counts rows the readers never show as filings/);
  });
});
