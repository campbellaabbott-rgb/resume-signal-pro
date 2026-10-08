// @vitest-environment node
/**
 * A FIELD COMPARED WITH A WEEK THAT HAD ALREADY LOST ITS CLOSURES READ AS GROWING.
 *
 * "Which fields are hiring this week" on /hiring-trends prints, per field,
 * (last7 - prior7) / prior7 from get_trending_categories. Both windows were
 * counted over surviving job_board_postings rows, and a takedown deletes its
 * row, so the prior week -- seven days older -- had lost more of its postings
 * than the last one. Live: 13 to 15 of 15 fields "up", finance +84%, while
 * the weekly series that adds closures back read +0.6% (register L11-10).
 * 20261008111500 counts each window the way get_hiring_trends counts a week.
 *
 * The fixture is a field whose employers post at a constant rate and take
 * half of a week's postings down within a week: a market that is not growing
 * at all. Both definitions are lifted from the lane and run at one instant.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { definitionAt, migFile } from "./helpers/fixed-clock-sql";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const AT = "2026-10-08T12:00:00Z";
const WAS = "20260909201000_the_same_late_date_in_thirteen_more_places.sql";
const NOW = "20261008111500_a_field_is_compared_with_its_own_week_before_anything_closed.sql";

// finance: 30 postings dated each day for 14 days. Of the last seven days'
// postings a tenth have come down; of the seven before, half -- the steady
// state of a board that takes roles down. A posting that came down is a
// closure row and no longer a posting row. One finance posting closed and
// came back (a flap): live again, with an old closure row that must not count
// it twice. One closure is a same-title re-list, which never counts.
// The closure log is three weeks deep, so prior7 is published.
const FIXTURE = `
  INSERT INTO public.job_board_postings (id, company_token, category, posted_at, first_seen)
  SELECT 'p:' || d || ':' || i, 'co', 'finance', ts, ts + interval '2 hours'
  FROM generate_series(1, 14) d, generate_series(1, 30) i,
       LATERAL (SELECT '${AT}'::timestamptz - make_interval(days => d) + interval '1 hour' AS ts) t
  WHERE NOT (i <= CASE WHEN d <= 7 THEN 3 ELSE 15 END);
  INSERT INTO public.job_board_closures (posting_id, company_token, category, posted_at, first_seen, closed_at, superseded, suspect, absence_basis)
  SELECT 'p:' || d || ':' || i, 'co', 'finance', ts, ts + interval '2 hours', ts + interval '20 hours', false, NULL, 'full_read'
  FROM generate_series(1, 14) d, generate_series(1, 30) i,
       LATERAL (SELECT '${AT}'::timestamptz - make_interval(days => d) + interval '1 hour' AS ts) t
  WHERE i <= CASE WHEN d <= 7 THEN 3 ELSE 15 END;
  INSERT INTO public.job_board_closures (posting_id, company_token, category, posted_at, first_seen, closed_at, superseded, absence_basis)
  SELECT 'p:10:20', 'co', 'finance', ts, ts + interval '2 hours', ts + interval '5 hours', false, 'full_read'
  FROM (SELECT '${AT}'::timestamptz - interval '10 days' + interval '1 hour' AS ts) t;
  INSERT INTO public.job_board_closures (posting_id, company_token, category, posted_at, first_seen, closed_at, superseded, absence_basis)
  SELECT 'relist:1', 'co', 'finance', ts, ts + interval '2 hours', ts + interval '3 hours', true, 'full_read'
  FROM (SELECT '${AT}'::timestamptz - interval '9 days' AS ts) t;
  INSERT INTO public.job_board_closures (posting_id, company_token, category, posted_at, first_seen, closed_at, absence_basis)
  VALUES ('old', 'co', 'finance', '${AT}'::timestamptz - interval '21 days', '${AT}'::timestamptz - interval '21 days',
          '${AT}'::timestamptz - interval '20 days', 'full_read');
`;

type Row = { category: string; last7: number; prior7: number | null };
let db: PGlite;
let was: Row;
let now: Row;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    SET TIME ZONE 'UTC';
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY);
    CREATE TABLE public.job_board_postings (
      id text PRIMARY KEY, company_token text NOT NULL, category text NOT NULL DEFAULT 'other',
      posted_at timestamptz, first_seen timestamptz NOT NULL);
    CREATE TABLE public.job_board_closures (
      posting_id text NOT NULL, company_token text NOT NULL, category text NOT NULL DEFAULT '',
      posted_at timestamptz, first_seen timestamptz, closed_at timestamptz NOT NULL,
      superseded boolean NOT NULL DEFAULT false, suspect boolean, absence_basis text);
  `);
  await db.exec(FIXTURE);
  await db.exec(definitionAt(WAS, "get_trending_categories", AT, "was"));
  await db.exec(definitionAt(NOW, "get_trending_categories", AT, "now"));
  const read = async (fn: string) => (await db.query<Row>(`SELECT * FROM public.${fn}()`)).rows.find((r) => r.category === "finance")!;
  was = await read("get_trending_categories_was");
  now = await read("get_trending_categories_now");
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

const delta = (r: Row) => Math.round((100 * (r.last7 - r.prior7!)) / r.prior7!);

describe("the field comparison", () => {
  it("read a flat field as growing by more than half, until this change", () => {
    expect(was.last7).toBe(7 * 27);
    expect(was.prior7).toBe(7 * 15);
    expect(delta(was)).toBeGreaterThan(50);
  });

  it("now counts both windows with their closed postings added back, so a flat field reads flat", () => {
    expect(now.last7).toBe(7 * 30);
    expect(now.prior7).toBe(7 * 30);
    expect(delta(now)).toBe(0);
  });

  it("the migration applies whole, passes its own end-state check, and leaves the page's roles able to call it", async () => {
    await db.exec(migFile(NOW));
    const r = (await db.query<{ anon: boolean; pub: boolean; definer: boolean }>(`
      SELECT has_function_privilege('anon', 'public.get_trending_categories()', 'EXECUTE') AS anon,
             EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                      WHERE p.oid = 'public.get_trending_categories()'::regprocedure AND a.grantee = 0) AS pub,
             (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_trending_categories()'::regprocedure) AS definer`)).rows[0];
    expect(r).toEqual({ anon: true, pub: false, definer: true });
  });
});
