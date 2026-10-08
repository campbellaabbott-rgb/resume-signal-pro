// @vitest-environment node
/**
 * "TODAY" ON THE TAKEDOWN TICKER WAS SINCE MIDNIGHT UTC.
 *
 * /jobs printed "63 roles filled or closed today" at 17:18 Pacific: the
 * counter, get_takedowns_today, counted closed_at >= date_trunc('day', now()),
 * so at 00:18Z it had eighteen minutes of takedowns to show a reader whose day
 * was nearly over (register L11-06; 1,341 an hour later, 258,331 that week).
 * 20261008111000 makes it a rolling 24 hours and the copy says "in the last
 * 24 hours" in all nine locales. Both definitions are lifted from the lane and
 * run at one fixed instant just after midnight UTC.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { definitionAt } from "./helpers/fixed-clock-sql";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const AT = "2026-10-08T00:18:00Z"; // 17:18 Pacific on the 7th
const WAS = "20261002113617_a_week_of_takedowns_is_counted_on_the_filter_its_quarter_uses.sql";
const NOW = "20261008111000_a_week_the_fence_already_emptied_is_not_drawn_and_today_is_the_last_24_hours.sql";
const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"];

let db: PGlite;
let was: number;
let now: number;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    SET TIME ZONE 'UTC';
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.job_board_closures (
      posting_id text, company_token text, closed_at timestamptz NOT NULL,
      superseded boolean NOT NULL DEFAULT false, suspect boolean, absence_basis text);
    -- Six admissible takedowns in the last day, one in the last eighteen
    -- minutes; one more two days ago; and three the counter must never count.
    INSERT INTO public.job_board_closures (posting_id, company_token, closed_at, superseded, suspect, absence_basis) VALUES
      ('a', 'co', '${AT}'::timestamptz - interval '10 minutes', false, false, 'full_read'),
      ('b', 'co', '${AT}'::timestamptz - interval '2 hours', false, NULL, NULL),
      ('c', 'co', '${AT}'::timestamptz - interval '7 hours', false, false, 'lap'),
      ('d', 'co', '${AT}'::timestamptz - interval '12 hours', false, false, 'full_read'),
      ('e', 'co', '${AT}'::timestamptz - interval '19 hours', false, false, 'full_read'),
      ('f', 'co', '${AT}'::timestamptz - interval '23 hours', false, false, 'full_read'),
      ('g', 'co', '${AT}'::timestamptz - interval '2 days', false, false, 'full_read'),
      ('h', 'co', '${AT}'::timestamptz - interval '1 hour', true, false, 'full_read'),
      ('i', 'co', '${AT}'::timestamptz - interval '1 hour', false, true, 'full_read'),
      ('j', 'co', '${AT}'::timestamptz - interval '1 hour', false, false, 'lap_backfill');
  `);
  await db.exec(definitionAt(WAS, "get_takedowns_today", AT, "was"));
  await db.exec(definitionAt(NOW, "get_takedowns_today", AT, "now"));
  was = (await db.query<{ n: number }>(`SELECT public.get_takedowns_today_was() AS n`)).rows[0].n;
  now = (await db.query<{ n: number }>(`SELECT public.get_takedowns_today_now() AS n`)).rows[0].n;
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the takedown ticker", () => {
  it("counted only the eighteen minutes since midnight UTC, until this change", () => {
    expect(was).toBe(1);
  });

  it("now counts the last 24 hours, with every admissibility rule unchanged", () => {
    expect(now).toBe(6);
  });

  it("says 'in the last 24 hours', not 'today', in every locale, and the page uses that sentence", () => {
    const jobs = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
    expect(jobs).toMatch(/t\("jobsPage\.takedownsLast24h", "\{\{n\}\} roles filled or closed in the last 24 hours"/);
    for (const loc of LOCALES) {
      const doc = JSON.parse(readFileSync(resolve(__dirname, `../i18n/locales/${loc}.json`), "utf8"));
      const v: string | undefined = doc.jobsPage?.takedownsLast24h;
      expect(v, `${loc}: jobsPage.takedownsLast24h`).toBeTruthy();
      expect(v, `${loc} keeps the count placeholder`).toContain("{{n}}");
      expect(v, `${loc} names the window`).toContain("24");
      expect(doc.jobsPage?.takedownsToday, `${loc} still carries the since-midnight sentence`).toBeUndefined();
    }
  });
});
