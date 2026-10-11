// @vitest-environment node
/**
 * S11-135: the Teamtailor repair (20261009100300) marks false takedowns
 * suspect in months the nightly closure rollup has already made final, and
 * roll_up_and_prune_closures (20261008112500) never rolls a final month again,
 * so job_board_closure_rollup kept the false fills for ever. The repair now
 * rolls those boards' final months again from the ledger.
 *
 * Run in pglite: September is rolled by the shipped rollup function pinned to
 * 2026-10-08, then the repair runs.
 */
import { describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { definitionAt, migFile } from "./helpers/fixed-clock-sql";

vi.setConfig({ testTimeout: 60_000 });

const ROLLUP = "20261008112500_the_closure_rollup_rolls_whole_months_and_rolls_them_when_nothing_is_pruned.sql";
const REPAIR = "20261009100300_a_teamtailor_page_of_a_hundred_wrote_takedowns_nobody_made.sql";

const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.job_board_closures (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    posting_id text, source text, company_token text NOT NULL, company text, category text NOT NULL DEFAULT '',
    posted_at timestamptz, closed_at timestamptz NOT NULL, superseded boolean NOT NULL DEFAULT false,
    suspect boolean NOT NULL DEFAULT false, absence_basis text);
  CREATE TABLE public.job_board_closure_rollup (
    company_token text NOT NULL, company text NOT NULL DEFAULT '', category text NOT NULL DEFAULT 'other',
    month date NOT NULL, fills integer NOT NULL DEFAULT 0, relists integer NOT NULL DEFAULT 0,
    dated_n integer NOT NULL DEFAULT 0, backfill_n integer NOT NULL DEFAULT 0,
    p50_days_open numeric, p75_days_open numeric, first_closed_at timestamptz, last_closed_at timestamptz,
    rolled_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (company_token, category, month));
  CREATE TABLE public.job_board_board_state (
    company_token text NOT NULL, observed_on date NOT NULL DEFAULT current_date, source text NOT NULL DEFAULT '',
    observed_at timestamptz NOT NULL DEFAULT now(), live_count integer, stored_count integer, feed_total integer,
    state text NOT NULL DEFAULT 'ok', PRIMARY KEY (company_token, observed_on));
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb, updated_at timestamptz);
`;
// eutalents walked to 2,600 on 2026-10-08 (one of the 82 measured boards); smallboard never had a second page.
const LEDGER = `
  INSERT INTO public.job_board_closures (posting_id, source, company_token, company, category, posted_at, closed_at, absence_basis) VALUES
    ('teamtailor:eutalents:1', 'teamtailor', 'eutalents', 'EU Talents', 'sales', '2026-08-20', '2026-09-03', 'full_read'),
    ('teamtailor:eutalents:2', 'teamtailor', 'eutalents', 'EU Talents', 'sales', '2026-08-25', '2026-09-10', NULL),
    ('teamtailor:eutalents:3', 'teamtailor', 'eutalents', 'EU Talents', 'other', '2026-09-01', '2026-09-12', 'full_read'),
    ('teamtailor:eutalents:4', 'teamtailor', 'eutalents', 'EU Talents', 'sales', '2026-09-01', '2026-09-20', 'lap'),
    ('teamtailor:smallboard:1', 'teamtailor', 'smallboard', 'Small', 'other', '2026-08-01', '2026-09-05', 'full_read'),
    ('teamtailor:smallboard:2', 'teamtailor', 'smallboard', 'Small', 'other', '2026-08-02', '2026-09-06', 'full_read');
`;

async function septemberRolledThenRepaired(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(LEDGER);
  await db.exec(definitionAt(ROLLUP, "roll_up_and_prune_closures", "2026-10-08T03:17:00Z", "at"));
  await db.exec(`SELECT public.roll_up_and_prune_closures_at(NULL)`);
  return db;
}
const rollup = async (db: PGlite) =>
  Object.fromEntries((await db.query<{ k: string; fills: number; rolled_at: string }>(
    `SELECT company_token || '/' || category AS k, fills, rolled_at::text FROM public.job_board_closure_rollup WHERE month = '2026-09-01' ORDER BY 1`,
  )).rows.map((r) => [r.k, { fills: r.fills, rolledAt: r.rolled_at }]));

describe("a final rollup month forgets the takedowns the Teamtailor repair marked (S11-135)", () => {
  it("control: the nightly job made September final with the false takedowns counted as fills", async () => {
    const db = await septemberRolledThenRepaired();
    const r = await rollup(db);
    expect(r["eutalents/sales"].fills).toBe(3);
    expect(r["eutalents/other"].fills).toBe(1);
    expect(r["smallboard/other"].fills).toBe(2);
  });

  it("after the repair, the board's final month counts only the closures still unsuspect", async () => {
    const db = await septemberRolledThenRepaired();
    const before = await rollup(db);
    await db.exec(migFile(REPAIR));
    const after = await rollup(db);
    expect(after["eutalents/sales"]?.fills, "the false takedowns stayed in a final month's fills").toBe(1);
    expect(after["eutalents/other"]?.fills, "a category whose every closure was marked counts none").toBe(0);
    expect(after["smallboard/other"], "a board the repair did not touch is not rolled again").toEqual(before["smallboard/other"]);
  });

  it("is safe to run again", async () => {
    const db = await septemberRolledThenRepaired();
    await db.exec(migFile(REPAIR));
    const once = await rollup(db);
    await db.exec(migFile(REPAIR));
    const twice = await rollup(db);
    expect(Object.fromEntries(Object.entries(twice).map(([k, v]) => [k, v.fills]))).toEqual(Object.fromEntries(Object.entries(once).map(([k, v]) => [k, v.fills])));
  });
});
