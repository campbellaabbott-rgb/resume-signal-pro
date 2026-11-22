// @vitest-environment node
/**
 * A PRUNED TAKEDOWN IS COUNTED IN THE COLUMN ITS MARK NAMES (S14X-159).
 *
 * WHAT WAS WRONG. roll_up_and_prune_closures (20261008112500) counted a
 * month's closures as fills (not superseded, not suspect, not a lap
 * backfill), relists (superseded) and backfill_n (lap backfill). A suspect
 * closure that was not superseded landed in no column, and its prune needed
 * only a final summary row for the month, so it would delete that row
 * uncounted. A final month was never rolled again, so a repair that marked
 * rows suspect after their month went final (Reyes 20261025110000, iCIMS
 * 20261026110000) left the false takedowns in fills. Live 2026-11-15 the
 * rollup had no suspect_n column at all (PostgREST 42703).
 *
 * WHAT THIS HOLDS, in pglite started from Supabase's default grants, with
 * September rolled final by the shipped 20261008112500 function:
 *   1. control: the shipped function counts the suspect closure nowhere;
 *   2. after 20261113100000 every closure of the month is in exactly one
 *      column, and a mark a repair made after the month went final has left
 *      fills for suspect_n;
 *   3. a prune pass deletes only rows it counted, in the same statement: a
 *      mark made after the migration is counted as the rows go, and the
 *      columns add up to the rows deleted;
 *   4. anon and authenticated cannot read the rollup, though Supabase's
 *      defaults gave them the table;
 *   5. the file runs twice to the same figures.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { definitionAt, migFile } from "./helpers/fixed-clock-sql";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";

vi.setConfig({ testTimeout: 60_000 });

const SHIPPED = "20261008112500_the_closure_rollup_rolls_whole_months_and_rolls_them_when_nothing_is_pruned.sql";
const FIX = "20261113100000_a_pruned_takedown_is_counted_in_the_column_its_mark_names.sql";

// The live shapes: the ledger, and the rollup as 20260727140000 made it with
// the columns later files added (dated_n, backfill_n), before suspect_n.
const SCHEMA = `
  SET TIME ZONE 'UTC';
  ${SUPABASE_DEFAULTS}
  CREATE TABLE public.job_board_closures (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    posting_id text, source text, company_token text NOT NULL, company text, category text NOT NULL DEFAULT '',
    posted_at timestamptz, closed_at timestamptz NOT NULL, superseded boolean NOT NULL DEFAULT false,
    suspect boolean DEFAULT false, absence_basis text);
  CREATE TABLE public.job_board_closure_rollup (
    company_token text NOT NULL, company text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'other',
    month date NOT NULL, fills integer NOT NULL DEFAULT 0, relists integer NOT NULL DEFAULT 0,
    dated_n integer, backfill_n integer,
    p50_days_open numeric, p75_days_open numeric, first_closed_at timestamptz, last_closed_at timestamptz,
    rolled_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (company_token, category, month));
`;
// acme: two fills, a suspect takedown nobody superseded, a suspect relist, a
// lap backfill; other: two fills, one with no post date. October holds one row
// so a month after September exists in the ledger.
const LEDGER = `
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, category, posted_at, closed_at, superseded, suspect, absence_basis) VALUES
    ('a1', 'icims', 'acme', 'Acme', 'sales', '2026-08-20', '2026-09-03', false, false, 'full_read'),
    ('a2', 'icims', 'acme', 'Acme', 'sales', '2026-08-25', '2026-09-10', false, false, NULL),
    ('a3', 'icims', 'acme', 'Acme', 'sales', '2026-09-01', '2026-09-12', false, true,  'full_read'),
    ('a4', 'icims', 'acme', 'Acme', 'sales', '2026-09-01', '2026-09-14', true,  true,  'full_read'),
    ('a5', 'icims', 'acme', 'Acme', 'sales', '2026-07-01', '2026-09-20', false, false, 'lap_backfill'),
    ('o1', 'greenhouse', 'other', 'Other', 'other', '2026-08-01', '2026-09-05', false, false, 'full_read'),
    ('o2', 'greenhouse', 'other', 'Other', 'other', NULL,         '2026-09-06', false, false, 'full_read'),
    ('o3', 'greenhouse', 'other', 'Other', 'other', '2026-10-01', '2026-10-09', false, false, 'full_read');
`;

interface Row { k: string; fills: number; relists: number; backfill_n: number; suspect_n: number | null }

async function septemberFinal(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(LEDGER);
  await db.exec(definitionAt(SHIPPED, "roll_up_and_prune_closures", "2026-10-08T03:17:00Z", "shipped"));
  await db.exec(`SELECT public.roll_up_and_prune_closures_shipped(NULL)`);
  return db;
}
const september = async (db: PGlite, withSuspect = true): Promise<Record<string, Row>> => Object.fromEntries((await db.query<Row>(
  `SELECT company_token || '/' || category AS k, fills, relists, backfill_n, ${withSuspect ? "suspect_n" : "NULL::int AS suspect_n"}
     FROM public.job_board_closure_rollup WHERE month = '2026-09-01' ORDER BY 1`,
)).rows.map((r) => [r.k, r]));
const held = async (db: PGlite, token: string) =>
  (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.job_board_closures WHERE company_token = $1 AND closed_at < '2026-10-01'`, [token])).rows[0].n;
const repairMarks = (db: PGlite, posting: string) => db.exec(`UPDATE public.job_board_closures SET suspect = true WHERE posting_id = '${posting}'`);

describe("control: the shipped rollup counts a suspect takedown nowhere", () => {
  it("acme's five September closures fill three columns with four", async () => {
    const db = await septemberFinal();
    const a = (await september(db, false))["acme/sales"];
    expect({ fills: a.fills, relists: a.relists, backfill_n: a.backfill_n }).toEqual({ fills: 2, relists: 1, backfill_n: 1 });
    expect(a.fills + a.relists + a.backfill_n).toBe(4);
    expect(await held(db, "acme")).toBe(5);
  });
});

describe("after 20261113100000", () => {
  it("every closure of a final month is in exactly one column, and a later repair's mark has left fills", async () => {
    const db = await septemberFinal();
    await repairMarks(db, "a1");
    await db.exec(migFile(FIX));
    const s = await september(db);
    expect(s["acme/sales"]).toMatchObject({ fills: 1, relists: 1, backfill_n: 1, suspect_n: 2 });
    expect(s["other/other"]).toMatchObject({ fills: 2, relists: 0, backfill_n: 0, suspect_n: 0 });
    for (const [k, r] of Object.entries(s)) {
      expect(r.fills + r.relists + r.backfill_n + (r.suspect_n ?? 0), k).toBe(await held(db, k.split("/")[0]));
    }
  });

  it("a prune pass counts a mark made after the month went final, as the rows go, and deletes only what it counted", async () => {
    const db = await septemberFinal();
    await db.exec(migFile(FIX));
    await repairMarks(db, "a2");
    await db.exec(definitionAt(FIX, "roll_up_and_prune_closures", "2026-12-15T03:17:00Z", "fixed"));
    const before = await september(db);
    const pruned = (await db.query<{ rows_pruned: number }>(`SELECT * FROM public.roll_up_and_prune_closures_fixed(60)`)).rows[0].rows_pruned;
    const after = await september(db);
    expect(after["acme/sales"].fills, "the mark made after the month went final stayed in fills").toBe(before["acme/sales"].fills - 1);
    expect(after["acme/sales"].suspect_n).toBe((before["acme/sales"].suspect_n ?? 0) + 1);
    expect(await held(db, "acme")).toBe(0);
    expect(await held(db, "other")).toBe(0);
    const counted = Object.values(after).reduce((n, r) => n + r.fills + r.relists + r.backfill_n + (r.suspect_n ?? 0), 0);
    expect(pruned).toBe(7);
    expect(counted, "the columns must add up to the rows the prune deleted").toBe(pruned);
    const october = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.job_board_closures WHERE closed_at >= '2026-10-01'`)).rows[0].n;
    expect(october, "a month not yet past the cutoff keeps its rows").toBe(1);
  });

  it("the prune leaves a month with no final summary row alone", async () => {
    const db = await septemberFinal();
    await db.exec(migFile(FIX));
    await db.exec(`DELETE FROM public.job_board_closure_rollup WHERE company_token = 'other'`);
    await db.exec(definitionAt(FIX, "roll_up_and_prune_closures", "2026-12-15T03:17:00Z", "fixed"));
    await db.query(`SELECT * FROM public.roll_up_and_prune_closures_fixed(60)`);
    expect(await held(db, "other")).toBe(2);
    expect(await held(db, "acme")).toBe(0);
  });

  it("anon and authenticated cannot read the rollup, though Supabase's defaults gave them the table", async () => {
    const db = await septemberFinal();
    const read = async (role: string) => {
      await db.exec(`SET ROLE ${role}`);
      try { await db.query(`SELECT suspect_n FROM public.job_board_closure_rollup LIMIT 1`); return "read"; } catch (e) { return String((e as Error).message); } finally { await db.exec(`RESET ROLE`); }
    };
    await db.exec(migFile(FIX));
    expect(await read("anon")).toMatch(/permission denied/);
    expect(await read("authenticated")).toMatch(/permission denied/);
    expect(await read("service_role")).toBe("read");
  });

  it("runs twice to the same figures", async () => {
    const db = await septemberFinal();
    await repairMarks(db, "a1");
    await db.exec(migFile(FIX));
    const once = await september(db);
    await db.exec(migFile(FIX));
    const twice = await september(db);
    const figures = (s: Record<string, Row>) => Object.fromEntries(Object.entries(s).map(([k, r]) => [k, [r.fills, r.relists, r.backfill_n, r.suspect_n]]));
    expect(figures(twice)).toEqual(figures(once));
  });
});
