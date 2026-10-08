// @vitest-environment node
/**
 * A WEEK REACHING PAST THE FENCE DREW HALF ITS POSTINGS, AND THE REMOTE SHARE
 * DIVIDED TWO POPULATIONS.
 *
 * get_hiring_trends started its series at date_trunc('week', now() - 28 days).
 * From Wednesday that week's Monday is more than 30 days old, and the
 * collector moves every posting dated past its 30-day window to the exit
 * ledger as aged_out -- out of the live leg, and never into the closure leg.
 * The oldest bar on /hiring-trends then showed about half a week: live on a
 * Sunday, 126,499 against 235,529 / 265,495 / 267,124 for the next three
 * (register L2-06). And the page's remote share divided remote_new, counted
 * over live rows only, by new_postings, which also counts closed postings
 * (register L2-21).
 *
 * 20261008111000 draws only weeks wholly inside the fence and publishes
 * live_new, the denominator remote_new and entry_new are counted over. Both
 * definitions are lifted from the lane and run at one fixed instant (a
 * Thursday), so the answer does not depend on the day the suite runs.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { definitionAt } from "./helpers/fixed-clock-sql";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const AT = "2026-10-08T12:00:00Z"; // a Thursday: the old series' first week starts 31.5 days earlier
const WAS = "20261002113617_a_week_of_takedowns_is_counted_on_the_filter_its_quarter_uses.sql";
const NOW = "20261008111000_a_week_the_fence_already_emptied_is_not_drawn_and_today_is_the_last_24_hours.sql";

const SCHEMA = `
  SET TIME ZONE 'UTC';
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE TABLE public.showcase_excluded (company_token text PRIMARY KEY);
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, company_token text NOT NULL, posted_at timestamptz,
    first_seen timestamptz NOT NULL, experience_band text, remote boolean NOT NULL DEFAULT false);
  CREATE TABLE public.job_board_closures (
    event_id bigserial PRIMARY KEY, posting_id text NOT NULL, company_token text NOT NULL,
    posted_at timestamptz, first_seen timestamptz, closed_at timestamptz NOT NULL,
    superseded boolean NOT NULL DEFAULT false, suspect boolean, absence_basis text);
`;
// Every day for 35 days: ten postings dated that day at noon, two of them
// remote, seen an hour later. Those dated more than 30 days before AT have
// aged out: the collector deleted them, so they are not in the table. Three
// more dated that day were taken down two days later and live only as
// closure rows.
const FIXTURE = `
  INSERT INTO public.job_board_postings (id, company_token, posted_at, first_seen, experience_band, remote)
  SELECT 'p:' || d || ':' || i, 'co', ts, ts + interval '1 hour', 'mid', i <= 2
  FROM generate_series(1, 35) d, generate_series(1, 10) i,
       LATERAL (SELECT '${AT}'::timestamptz - make_interval(days => d) AS ts) t
  WHERE ts >= '${AT}'::timestamptz - interval '30 days';
  INSERT INTO public.job_board_closures (posting_id, company_token, posted_at, first_seen, closed_at, suspect, absence_basis)
  SELECT 'c:' || d || ':' || i, 'co', ts, ts + interval '1 hour', ts + interval '2 days', false, 'full_read'
  FROM generate_series(1, 35) d, generate_series(1, 3) i,
       LATERAL (SELECT '${AT}'::timestamptz - make_interval(days => d) AS ts) t;
`;

type Week = { week_start: string; new_postings: number; remote_new: number; live_new?: number };
let db: PGlite;
let was: Week[];
let now: Week[];
const day = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

beforeAll(async () => {
  db = new PGlite();
  await db.exec(SCHEMA);
  await db.exec(FIXTURE);
  await db.exec(definitionAt(WAS, "get_hiring_trends", AT, "was"));
  await db.exec(definitionAt(NOW, "get_hiring_trends", AT, "now"));
  const read = async (fn: string) =>
    (await db.query<Week>(`SELECT * FROM public.${fn}()`)).rows.map((r) => ({ ...r, week_start: day(r.week_start) }));
  was = await read("get_hiring_trends_was");
  now = await read("get_hiring_trends_now");
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the weekly series", () => {
  it("drew a first week that reached past the fence, short by the postings the fence had already moved, until this change", () => {
    expect(was[0].week_start).toBe("2026-09-07");
    const full = was.find((w) => w.week_start === "2026-09-14")!;
    expect(was[0].new_postings).toBeLessThan(full.new_postings);
  });

  it("now draws only weeks whose Monday is inside the 30-day fence", () => {
    expect(now.map((w) => w.week_start)).toEqual(["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05"]);
    const fence = Date.parse(AT) - 30 * 86_400_000;
    for (const w of now) expect(Date.parse(`${w.week_start}T00:00:00Z`)).toBeGreaterThanOrEqual(fence);
  });

  it("leaves every week it still draws exactly as it was", () => {
    for (const w of now) {
      const old = was.find((x) => x.week_start === w.week_start)!;
      expect(w.new_postings).toBe(old.new_postings);
      expect(w.remote_new).toBe(old.remote_new);
    }
    // A full week: seventy live postings and twenty-one closed ones.
    expect(now[0].new_postings).toBe(91);
  });

  it("publishes the live leg's own count, so the remote share divides like by like", () => {
    const w = now[0];
    expect(w.live_new).toBe(70);
    expect(w.remote_new).toBe(14);
    // 20% of the roles still held, not 15% of a population the remote count never saw.
    expect(Math.round((100 * w.remote_new) / w.live_new!)).toBe(20);
    expect(Math.round((100 * w.remote_new) / w.new_postings)).toBe(15);
    expect(was[0]).not.toHaveProperty("live_new");
  });
});
