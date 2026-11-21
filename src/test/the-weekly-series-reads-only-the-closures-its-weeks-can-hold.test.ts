// @vitest-environment node
/**
 * THE WEEKLY SERIES READS ONLY THE CLOSURES ITS WEEKS CAN HOLD (CW2-SC2,
 * owner-gated; the owner's answer of 2026-11-18 ships it without first
 * running the EXPLAIN in the migration's header, which stays as an optional
 * check).
 *
 * WHAT WAS WRONG. get_hiring_trends' posted_closed leg (20261112191500, NB-46)
 * was bounded on posted_at alone, which the closure log does not index, so
 * every hourly stats-cache refresh read every closure since the collector
 * started to keep the ones posted in the last 35 days. The takedown leg beside
 * it, and the field table's closure leg since 20261008111500, were bounded on
 * closed_at, which is indexed.
 *
 * WHAT THIS HOLDS, in pglite started from Supabase's default grants, with the
 * clock pinned:
 *   1. the same answer: on a ledger that holds closures far older than 36
 *      days, a closure posted at the start of the first week shown, a
 *      re-list, a lap backfill and a closure stamped most of a day before its
 *      post date (clock skew), the bounded series returns exactly what
 *      NB-46's returns, and the closure leg adds postings the live leg does
 *      not hold;
 *   2. the fixture can see a wrong bound: a bound that cuts into the weeks
 *      shown (20 days) changes the answer on it;
 *   3. the leg can now be read through the closed_at index, and without the
 *      bound it cannot;
 *   4. the file applies over NB-46, keeps the page's grants, and runs twice.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { definitionAt, definitionOf, migFile } from "./helpers/fixed-clock-sql";
import { SUPABASE_DEFAULTS } from "./helpers/supabase-defaults";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const NB46 = "20261112191500_the_weekly_series_reads_the_same_boards_and_keeps_a_relist_in_its_week.sql";
const FIX = "20261113102000_the_weekly_series_reads_only_the_closures_its_weeks_can_hold.sql";
const AT = "2026-11-17T12:00:00Z";
const BOUND = "AND c.closed_at > now() - interval '36 days'";

const SCHEMA = `
  SET TIME ZONE 'UTC';
  ${SUPABASE_DEFAULTS}
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY);
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, company_token text NOT NULL, category text NOT NULL DEFAULT 'other',
    posted_at timestamptz, first_seen timestamptz NOT NULL, experience_band text, remote boolean NOT NULL DEFAULT false);
  CREATE TABLE public.job_board_closures (
    posting_id text NOT NULL, company_token text NOT NULL, category text NOT NULL DEFAULT '',
    posted_at timestamptz, first_seen timestamptz, closed_at timestamptz NOT NULL,
    superseded boolean NOT NULL DEFAULT false, suspect boolean, absence_basis text);
  CREATE INDEX job_board_closures_closed_at_idx ON public.job_board_closures (closed_at DESC);
  CREATE TABLE public.job_board_board_watch (
    company_token text PRIMARY KEY, first_observed_on date NOT NULL, first_observed_basis text NOT NULL DEFAULT 'board_state',
    is_censored boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
`;

// Every time is AT less a number of days, so the ledger sits where the pinned
// clock reads it.
const ago = (d: number) => `'${AT}'::timestamptz - make_interval(secs => ${d} * 86400)`;
const closure = (id: string, posted: number | null, closed: number, o: { superseded?: boolean; basis?: string; tok?: string } = {}) =>
  `('${id}', '${o.tok ?? "a"}', 'finance', ${posted === null ? "NULL" : ago(posted)}, ${posted === null ? "NULL" : ago(posted - 0.04)}, ${ago(closed)}, ${o.superseded ?? false}, NULL, ${o.basis ? `'${o.basis}'` : "'full_read'"})`;

const FIXTURE = `
  INSERT INTO public.job_board_board_watch (company_token, first_observed_on) VALUES ('a', DATE '2026-08-01');
  INSERT INTO public.job_board_postings (id, company_token, category, posted_at, first_seen)
  SELECT 'live:' || i, 'a', 'finance', ${ago(1)} - make_interval(days => i % 25), ${ago(1)} - make_interval(days => i % 25) + interval '1 hour'
  FROM generate_series(1, 60) i;
  -- Four hundred closures far older than the window: posted and closed 40 to 400 days ago.
  INSERT INTO public.job_board_closures (posting_id, company_token, category, posted_at, first_seen, closed_at, superseded, suspect, absence_basis)
  SELECT 'old:' || i, 'a', 'finance', ${ago(40)} - make_interval(days => i % 360), ${ago(40)} - make_interval(days => i % 360) + interval '1 hour',
         ${ago(40)} - make_interval(days => i % 360) + interval '5 days', false, NULL, 'full_read'
  FROM generate_series(1, 400) i;
  INSERT INTO public.job_board_closures (posting_id, company_token, category, posted_at, first_seen, closed_at, superseded, suspect, absence_basis) VALUES
    ${[
      closure("recent-1", 6, 3),
      closure("recent-2", 13, 9),
      closure("relist", 20, 12, { superseded: true }),
      closure("edge-in", 29.4, 29.3),
      closure("skew", 25, 25.8),
      closure("unseen-week", 33, 32),
      closure("posted-out", 35.5, 10),
      closure("backfill", 8, 2, { basis: "lap_backfill" }),
      closure("undated", null, 4),
      closure("live-dup", 3, 1),
    ].join(",\n    ")};
  -- live-dup's posting is still live under the same id, so the closure leg must not count it twice.
  INSERT INTO public.job_board_postings (id, company_token, category, posted_at, first_seen)
  VALUES ('live-dup', 'a', 'finance', ${ago(3)}, ${ago(3)} + interval '1 hour');
`;

type Week = { week_start: string; new_postings: number; entry_new: number; remote_new: number; closed: number; closed_flagged: number; live_new: number };
let db: PGlite;
const series = async (fn: string) => (await db.query<Week>(`SELECT * FROM public.${fn}() ORDER BY week_start`)).rows;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(FIXTURE);
  await db.exec(definitionAt(NB46, "get_hiring_trends", AT, "before"));
  await db.exec(definitionAt(FIX, "get_hiring_trends", AT, "after"));
});

describe("the bounded series answers what NB-46 answers", () => {
  it("returns the same rows, and the closure leg counts postings the live leg does not hold", async () => {
    const before = await series("get_hiring_trends_before");
    const after = await series("get_hiring_trends_after");
    expect(before.length).toBeGreaterThan(2);
    expect(after).toEqual(before);
    const fromClosures = before.reduce((n, w) => n + w.new_postings - w.live_new, 0);
    // recent-1, recent-2, relist, edge-in and skew are dated in the weeks shown
    // and not live; unseen-week is dated in a week the series does not show;
    // posted-out, backfill, undated and live-dup are not counted.
    expect(fromClosures, "the closure leg added nothing, so identity proves nothing").toBe(5);
  });

  it("the fixture sees a wrong bound: one that cuts into the weeks shown changes the answer", async () => {
    const tight = definitionAt(FIX, "get_hiring_trends", AT, "tight").replace("interval '36 days'", "interval '20 days'");
    expect(tight).not.toBe(definitionAt(FIX, "get_hiring_trends", AT, "tight"));
    await db.exec(tight);
    expect(await series("get_hiring_trends_tight")).not.toEqual(await series("get_hiring_trends_before"));
  });
});

describe("the leg can be read through the closed_at index", () => {
  const leg = (bounded: boolean) => `
    EXPLAIN SELECT date_trunc('week', c.posted_at)::date, count(DISTINCT c.posting_id)
      FROM public.job_board_closures c
     WHERE c.posted_at IS NOT NULL AND c.posted_at > now() - interval '35 days'
       ${bounded ? "AND c.closed_at > now() - interval '36 days'" : ""}
     GROUP BY 1`;
  const plan = async (bounded: boolean) => {
    await db.exec("SET enable_seqscan = off");
    try { return (await db.query<{ "QUERY PLAN": string }>(leg(bounded))).rows.map((r) => r["QUERY PLAN"]).join("\n"); }
    finally { await db.exec("RESET enable_seqscan"); }
  };
  it("with the bound the plan reads job_board_closures_closed_at_idx; without it, it cannot", async () => {
    expect(await plan(true)).toMatch(/job_board_closures_closed_at_idx/);
    expect(await plan(false)).not.toMatch(/job_board_closures_closed_at_idx/);
  });
  it("the bound sits in the posted_closed leg of the file's definition, beside its 35-day window", () => {
    const def = definitionOf(migFile(FIX), "get_hiring_trends");
    const legText = def.slice(def.indexOf("posted_closed AS ("), def.indexOf("closes AS ("));
    expect(legText).toContain(BOUND);
    expect(legText).toContain("c.posted_at > now() - interval '35 days'");
    expect(def.replace(`      ${BOUND}\n`, "")).toBe(definitionOf(migFile(NB46), "get_hiring_trends"));
  });
});

describe("the file over NB-46", () => {
  it("applies, keeps the page's grants, and runs twice", async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
    await d.exec(migFile(NB46));
    await d.exec(migFile(FIX));
    await d.exec(migFile(FIX));
    const can = async (role: string) =>
      (await d.query<{ x: boolean }>(`SELECT has_function_privilege('${role}', 'public.get_hiring_trends()', 'EXECUTE') AS x`)).rows[0].x;
    expect(await can("anon")).toBe(true);
    expect(await can("authenticated")).toBe(true);
    const src = (await d.query<{ s: string }>("SELECT prosrc AS s FROM pg_proc WHERE oid = 'public.get_hiring_trends()'::regprocedure")).rows[0].s;
    expect(src).toContain(BOUND);
  });

  it("its self-check refuses a leg with no bound", async () => {
    const d = new PGlite();
    await d.exec(SCHEMA);
    await d.exec(migFile(NB46));
    // The header's EXPLAIN quotes the same clause, so cut the one in the leg.
    const sql = migFile(FIX);
    const at = sql.indexOf(`      ${BOUND}\n`, sql.indexOf("posted_closed AS ("));
    expect(at).toBeGreaterThan(sql.indexOf("posted_closed AS ("));
    const unbounded = sql.slice(0, at) + sql.slice(at + `      ${BOUND}\n`.length);
    await expect(d.exec(unbounded)).rejects.toThrow(/posted_closed leg is not bounded on closed_at/);
  });
});
