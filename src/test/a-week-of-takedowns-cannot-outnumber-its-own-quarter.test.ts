// @vitest-environment node
//
// Node, not jsdom: this file executes the weekly series and the takedown
// counter in pglite, and evaluates the prerender's figure builder as source.
// The page half is a-week-of-takedowns-cannot-outnumber-its-own-quarter-page.test.tsx.
//
// A WEEK OF TAKEDOWNS CANNOT OUTNUMBER ITS OWN QUARTER.
//
// /hiring-trends printed 845,110 / 870,536 / 806,570 takedowns for the weeks
// beginning 2026-09-07, 09-14 and 09-21 beside a 90-day closure total of
// 1,852,789 from the same cache row, and the /jobs ticker read 130,373 for one
// day. The weekly series and the ticker counted closure batches the collector
// had itself flagged as possible read failures; the 90-day total did not.
// Same ledger, same date column, one predicate apart.
//
// WHAT THIS FILE PROVES, BY RUNNING THE SQL rather than reading it, over a
// ledger seeded at roughly 1/600 of the live rates -- 79 days of admitted
// closures, the last 25 days carrying flagged batches at four times that rate,
// plus relists, a first-lap backfill and a showcase-excluded board:
//   * no week, and not the five weeks together, exceeds the 90-day total
//     computed by the expression lifted from the newest refresh_ghost_stats,
//     and no week reads above the plausibility ceiling the pages apply;
//   * closed + closed_flagged is exactly the pre-fix weekly figure and
//     exactly every admissible row in the week -- a partition, nothing lost;
//   * closed_flagged is exactly the flagged rows that were seeded;
//   * two postings churned by the flap count as two new postings, not five;
//   * today's counter equals the admitted rows logged today;
//   * the newest migration applies over the pre-fix function -- a return-type
//     change -- and its own end-state block passes, and refuses a doctored copy.
// TEETH, each run in this file: the pre-fix bodies (the newest definitions
// that lack the change) fail the same assertions, and so do mutants with the
// flagged split, the DISTINCT or the anti-join removed.
//
// And the page rules, in both runtimes: closureVerdict holds the live incident
// weeks and publishes a clean one, and the prerender's mirror returns the same
// verdict on every point of a grid, so a crawler and a browser are never told
// different things about the same week.
//
// Definitions are lifted by filename order from comment-stripped SQL, never
// from a named file, so a later re-issue is what gets tested.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import {
  CLOSURE_RECORD_WINDOW_DAYS,
  CLOSURE_WEEK_PLAUSIBILITY,
  closureCeiling,
  closureVerdict,
  type ClosureRecord,
  type ClosureVerdict,
  type ClosureWeek,
} from "@/lib/hiring-trends-trust";

// A pglite boot is not a unit test; neither is a query over ten thousand rows.
vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const ROOT = resolve(__dirname, "../..");
const MIG = resolve(ROOT, "supabase/migrations");
const FILES = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");

/** `--` comments removed line by line, without eating a `--` inside a string
 *  literal (an odd number of quotes before it means we are inside one). */
const stripSqlComments = (sql: string): string =>
  sql
    .split("\n")
    .map((line) => {
      const at = line.indexOf("--");
      if (at < 0) return line;
      const quotes = (line.slice(0, at).match(/'/g) ?? []).length;
      return quotes % 2 === 0 ? line.slice(0, at) : line;
    })
    .join("\n");

type Def = { file: string; sql: string };

/** Every definition of a function in apply order, each cut from its CREATE to
 *  the close of the dollar tag it actually opened with. */
function definitions(name: string): Def[] {
  const out: Def[] = [];
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, "gi");
  for (const file of FILES) {
    const code = stripSqlComments(read(file));
    for (const m of code.matchAll(re)) {
      const rest = code.slice(m.index!);
      const tag = /\bAS\s+(\$[A-Za-z_]*\$)/.exec(rest);
      if (!tag) continue;
      const open = tag.index + tag[0].length;
      const close = rest.indexOf(tag[1], open);
      if (close < 0) continue;
      out.push({ file, sql: `${rest.slice(0, close + tag[1].length)};` });
    }
  }
  return out;
}

const TRENDS = definitions("get_hiring_trends");
const TODAY = definitions("get_takedowns_today");
const GHOST = definitions("refresh_ghost_stats");
const NEWEST_TRENDS = TRENDS[TRENDS.length - 1];
const NEWEST_TODAY = TODAY[TODAY.length - 1];
/** The pre-fix weekly series: the newest definition without the flagged column. */
const PRE_TRENDS = [...TRENDS].reverse().find((d) => !/closed_flagged/.test(d.sql))!;
/** The pre-fix counter: the newest definition with no doubted-batch exclusion. */
const PRE_TODAY = [...TODAY].reverse().find((d) => !/COALESCE\s*\(\s*suspect\s*,\s*false\s*\)/i.test(d.sql))!;

const between = (s: string, a: string, b: string): string | null => {
  const i = s.indexOf(a);
  const j = i < 0 ? -1 : s.indexOf(b, i + a.length);
  return i < 0 || j < 0 ? null : s.slice(i + a.length, j).trim().replace(/,\s*$/, "");
};
const GHOST_SQL = GHOST[GHOST.length - 1]?.sql ?? "";
/** The 90-day total and the record depth, verbatim from the newest refresh_ghost_stats. */
const CLOSED_90D = between(GHOST_SQL, "'closed_90d',", "'observed_days'");
const OBSERVED_DAYS = between(GHOST_SQL, "'observed_days',", "'median_days_to_close'");

/** The same definition under another name, so pre-fix, fixed and mutant can share one ledger. */
const renamed = (sql: string, name: string, suffix: string): string => {
  const out = sql.replace(new RegExp(`(FUNCTION\\s+public\\.${name})(\\s*\\()`), `$1_${suffix}$2`);
  expect(out, `could not rename ${name}`).not.toBe(sql);
  return out;
};
/** A mutant, and whether the mutation actually applied. Built without
 *  asserting, so a setup hook never fails on it and the behavioural assertions
 *  still run against whatever body the migrations now hold; every teeth case
 *  asserts `applied` itself. The replacement is passed as a function so a `$$`
 *  in it stays a dollar quote rather than collapsing to one `$` under
 *  String.replace's substitution rules. */
const mutant = (sql: string, from: string | RegExp, to: string): { sql: string; applied: boolean } => {
  const out = sql.replace(from, () => to);
  return { sql: out, applied: out !== sql };
};
const APPLIED = "the mutation did not apply -- the teeth would be testing the fixed body";

const SCHEMA = `
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
const boot = async (): Promise<PGlite> => {
  const db = new PGlite();
  await db.exec(SCHEMA);
  return db;
};

// ── the ledger ────────────────────────────────────────────────────────────────
// Admitted: 40 a day for 79 days, every tenth a relist; absence_basis NULL
// before day 23 (written before the column), 'lap' on every third row after;
// suspect NULL before day 25 (written before the guard). Flagged: 160 a day for
// the last 25 days, every twentieth a relist. Plus 300 first-lap backfill rows
// and a showcase-excluded board's 30. All within a day of their own day.
const ADMITTED_PER_DAY = 40 - 4;
const FLAGGED_PER_DAY = 160 - 8;
const FLAGGED_DAYS = 25;
const LEDGER = `
  INSERT INTO public.showcase_excluded VALUES ('dominos');
  INSERT INTO public.job_board_closures (posting_id, company_token, posted_at, first_seen, closed_at, superseded, suspect, absence_basis)
  SELECT 'h:' || d || ':' || i, 'co' || (i % 10), ts - interval '20 days', ts - interval '20 days', ts,
         i % 10 = 0,
         CASE WHEN d >= 25 THEN NULL ELSE false END,
         CASE WHEN d >= 23 THEN NULL WHEN i % 3 = 0 THEN 'lap' ELSE 'full_read' END
  FROM generate_series(0, 78) d, generate_series(1, 40) i,
       LATERAL (SELECT now() - make_interval(days => d) - make_interval(mins => i * 7) AS ts) t;
  INSERT INTO public.job_board_closures (posting_id, company_token, posted_at, first_seen, closed_at, superseded, suspect, absence_basis)
  SELECT 'w:' || (i % 300), 'wd' || (i % 7), ts - interval '40 days', ts - interval '1 day', ts,
         i % 20 = 0, true, 'full_read'
  FROM generate_series(0, ${FLAGGED_DAYS - 1}) d, generate_series(1, 160) i,
       LATERAL (SELECT now() - make_interval(days => d) - make_interval(mins => i * 5) AS ts) t;
  INSERT INTO public.job_board_closures (posting_id, company_token, posted_at, first_seen, closed_at, superseded, suspect, absence_basis)
  SELECT 'b:' || i, 'big', now() - interval '25 days', now() - interval '25 days',
         now() - interval '2 days' - make_interval(mins => i), false, false, 'lap_backfill'
  FROM generate_series(1, 300) i;
  INSERT INTO public.job_board_closures (posting_id, company_token, posted_at, first_seen, closed_at, superseded, suspect, absence_basis)
  SELECT 'd:' || i, 'dominos', now() - interval '20 days', now() - interval '20 days',
         now() - make_interval(hours => i * 4), false, false, 'full_read'
  FROM generate_series(1, 30) i;
`;

type WeekOut = {
  week_start: string; closed: number; closed_flagged: number; pre: number; mut: number;
  admissible: number; admitted: number; flagged_admissible: number; inside_flag_era: boolean;
  c90: number; days: number;
};

describe("the lifted sources are the ones this file claims to be testing", () => {
  it("found the newest and the pre-fix definitions, and the 90-day expressions", () => {
    expect(TRENDS.length, "no get_hiring_trends definition parsed").toBeGreaterThan(1);
    expect(NEWEST_TRENDS.sql, "the newest weekly series does not carry the flagged column").toMatch(/closed_flagged\s+int/);
    expect(PRE_TRENDS, "no pre-fix weekly series to prove the teeth against").toBeTruthy();
    expect(PRE_TRENDS.file < NEWEST_TRENDS.file).toBe(true);
    expect(PRE_TODAY, "no pre-fix takedown counter to prove the teeth against").toBeTruthy();
    expect(NEWEST_TODAY.file, "the counter and the series are fixed in one migration").toBe(NEWEST_TRENDS.file);
    expect(CLOSED_90D, "closed_90d not found in refresh_ghost_stats").toMatch(/^\(SELECT count\(\*\) FROM public\.job_board_closures/);
    expect(CLOSED_90D).toMatch(/NOT COALESCE\(suspect, false\)/);
    expect(OBSERVED_DAYS, "observed_days not found in refresh_ghost_stats").toMatch(/^\(SELECT GREATEST/);
  });
});

describe("a week of takedowns cannot outnumber its own quarter (executed)", () => {
  const MUT_SPLIT = mutant(NEWEST_TRENDS.sql, "FILTER (WHERE NOT COALESCE(suspect, false))", "");
  let db: PGlite;
  let weeks: WeekOut[];
  let flaggedSeeded: number;

  beforeAll(async () => {
    db = await boot();
    await db.exec(NEWEST_TRENDS.sql);
    await db.exec(renamed(PRE_TRENDS.sql, "get_hiring_trends", "prefix"));
    await db.exec(renamed(MUT_SPLIT.sql, "get_hiring_trends", "mutant"));
    await db.exec(LEDGER);
    // ONE statement, so every column below shares one now().
    const r = await db.query<WeekOut>(`
      SELECT f.week_start::text AS week_start, f.closed, f.closed_flagged,
             p.closed AS pre, m.closed AS mut,
             (SELECT count(*)::int FROM public.job_board_closures c
               WHERE date_trunc('week', c.closed_at)::date = f.week_start
                 AND c.closed_at > now() - interval '35 days' AND NOT c.superseded
                 AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
                 AND c.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)) AS admissible,
             (SELECT count(*)::int FROM public.job_board_closures c
               WHERE date_trunc('week', c.closed_at)::date = f.week_start
                 AND c.closed_at > now() - interval '35 days' AND NOT c.superseded
                 AND c.suspect IS NOT TRUE
                 AND c.absence_basis IS DISTINCT FROM 'lap_backfill'
                 AND c.company_token NOT IN (SELECT company_token FROM public.showcase_excluded)) AS admitted,
             (SELECT count(*)::int FROM public.job_board_closures c
               WHERE date_trunc('week', c.closed_at)::date = f.week_start
                 AND c.posting_id LIKE 'w:%' AND NOT c.superseded) AS flagged_admissible,
             (f.week_start::timestamptz >= now() - interval '${FLAGGED_DAYS - 1} days'
               AND f.week_start::timestamptz + interval '7 days' <= now()) AS inside_flag_era,
             ${CLOSED_90D}::int AS c90,
             ${OBSERVED_DAYS}::int AS days
      FROM public.get_hiring_trends() f
      JOIN public.get_hiring_trends_prefix() p USING (week_start)
      JOIN public.get_hiring_trends_mutant() m USING (week_start)
      ORDER BY f.week_start`);
    weeks = r.rows;
    flaggedSeeded = (await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM public.job_board_closures WHERE suspect AND NOT superseded",
    )).rows[0].n;
  });
  afterAll(async () => { await db.close(); });

  const sum = (k: keyof WeekOut) => weeks.reduce((a, w) => a + Number(w[k]), 0);

  it("the ledger is the one described: five weeks, a 79-day record, the flagged rows all inside the window", () => {
    expect(weeks.length).toBeGreaterThanOrEqual(5);
    expect(weeks[0].days).toBe(79);
    expect(flaggedSeeded).toBe(FLAGGED_PER_DAY * FLAGGED_DAYS);
    expect(sum("flagged_admissible")).toBe(flaggedSeeded);
    // 79 days of admitted rows, plus the showcase board the 90-day total keeps.
    expect(weeks[0].c90).toBe(ADMITTED_PER_DAY * 79 + 30);
  });

  it("no week, and not the five together, exceeds the 90-day total", () => {
    const c90 = weeks[0].c90;
    for (const w of weeks) expect(w.closed, `week ${w.week_start}`).toBeLessThanOrEqual(c90);
    expect(sum("closed"), `five weeks sum to ${sum("closed")} against a quarter of ${c90}`).toBeLessThanOrEqual(c90);
  });

  it("no week reads above the ceiling the pages hold a week at", () => {
    const ceiling = closureCeiling({ closed_90d: weeks[0].c90, observed_days: weeks[0].days })!;
    expect(ceiling).toBeCloseTo((weeks[0].c90 / 79) * 7 * CLOSURE_WEEK_PLAUSIBILITY, 6);
    for (const w of weeks) expect(w.closed, `week ${w.week_start} against ${Math.round(ceiling)}`).toBeLessThanOrEqual(ceiling);
  });

  it("closed + closed_flagged is the pre-fix figure and every admissible row: a partition, nothing lost", () => {
    for (const w of weeks) {
      expect(w.closed + w.closed_flagged, `week ${w.week_start}`).toBe(w.pre);
      expect(w.closed + w.closed_flagged, `week ${w.week_start}`).toBe(w.admissible);
      expect(w.closed, `week ${w.week_start}: admitted rows`).toBe(w.admitted);
    }
  });

  it("closed_flagged is exactly the flagged rows seeded, and NULL-flag history is admitted, not dropped", () => {
    expect(sum("closed_flagged")).toBe(flaggedSeeded);
    // The oldest week in the window predates the flagged era's start for at
    // least part of its span, and its admitted rows include suspect-NULL ones.
    expect(weeks[0].closed).toBeGreaterThan(0);
  });

  it("teeth: the pre-fix body puts more takedowns in five weeks than in the quarter", () => {
    expect(sum("pre"), `the pre-fix weeks sum to ${sum("pre")} against ${weeks[0].c90}`).toBeGreaterThan(weeks[0].c90);
  });

  it("teeth: the fixed body with the flagged split removed fails the same way", () => {
    expect(MUT_SPLIT.applied, APPLIED).toBe(true);
    expect(sum("mut")).toBe(sum("pre"));
    expect(sum("mut")).toBeGreaterThan(weeks[0].c90);
  });

  it("the page rules hold every flagged-era week, under either body, for the right reason", () => {
    const record: ClosureRecord = { closed_90d: weeks[0].c90, observed_days: weeks[0].days };
    const era = weeks.filter((w) => w.inside_flag_era);
    expect(era.length, "no complete week fell inside the flagged era -- the fixture moved").toBeGreaterThanOrEqual(2);
    for (const w of era) {
      const fixed = closureVerdict(w, record);
      expect(fixed.state === "held" && fixed.reason, `fixed body, week ${w.week_start}`).toBe("flagged_majority");
      const pre = closureVerdict({ closed: w.pre }, record);
      expect(pre.state === "held" && pre.reason, `pre-fix body, week ${w.week_start}`).toBe("exceeds_record");
    }
  });
});

describe("a posting churned by the flap is one new posting, not one per closure row (executed)", () => {
  const NO_DISTINCT = mutant(NEWEST_TRENDS.sql, "count(DISTINCT c.posting_id)", "count(*)");
  const NO_ANTIJOIN = mutant(NEWEST_TRENDS.sql, /AND NOT EXISTS \([\s\S]*?interval '3 days'\)/, "");
  let db: PGlite;
  const sums: Record<string, number> = {};
  beforeAll(async () => {
    db = await boot();
    await db.exec(NEWEST_TRENDS.sql);
    await db.exec(renamed(PRE_TRENDS.sql, "get_hiring_trends", "prefix"));
    await db.exec(renamed(NO_DISTINCT.sql, "get_hiring_trends", "nodistinct"));
    await db.exec(renamed(NO_ANTIJOIN.sql, "get_hiring_trends", "noantijoin"));
    // R1: seen within a day of its date, phantom-closed three times while each
    // re-insert was still inside its three-day window, live now (re-seen late).
    // R2: seen on time, phantom-closed once, back inside three days and live.
    // An old row sets the record's epoch well before the window, so the
    // posting's week is always one the series reports.
    await db.exec(`
      INSERT INTO public.job_board_closures (posting_id, company_token, posted_at, first_seen, closed_at, superseded, suspect, absence_basis) VALUES
       ('old','co', now() - interval '70 days', now() - interval '70 days', now() - interval '60 days', false, false, 'full_read'),
       ('wd:co:R1','co', now() - interval '10 days', now() - interval '9.5 days', now() - interval '9 days', false, true, 'full_read'),
       ('wd:co:R1','co', now() - interval '10 days', now() - interval '8.5 days', now() - interval '8 days', false, true, 'full_read'),
       ('wd:co:R1','co', now() - interval '10 days', now() - interval '7.5 days', now() - interval '7 days', false, true, 'full_read'),
       ('wd:co:R2','co', now() - interval '10 days', now() - interval '9.8 days', now() - interval '9 days', false, true, 'full_read');
      INSERT INTO public.job_board_postings (id, company_token, posted_at, first_seen) VALUES
       ('wd:co:R1','co', now() - interval '10 days', now() - interval '6.5 days'),
       ('wd:co:R2','co', now() - interval '10 days', now() - interval '8.9 days');`);
    for (const fn of ["get_hiring_trends", "get_hiring_trends_prefix", "get_hiring_trends_nodistinct", "get_hiring_trends_noantijoin"]) {
      sums[fn] = (await db.query<{ n: number }>(`SELECT sum(new_postings)::int AS n FROM public.${fn}()`)).rows[0].n;
    }
  });
  afterAll(async () => { await db.close(); });

  it("two churned postings count as two", () => {
    expect(sums.get_hiring_trends).toBe(2);
  });

  it("teeth: the pre-fix body counts them as five, and each half of the fix is load-bearing", () => {
    expect(sums.get_hiring_trends_prefix).toBe(5);
    expect(NO_DISTINCT.applied, APPLIED).toBe(true);
    expect(NO_ANTIJOIN.applied, APPLIED).toBe(true);
    expect(sums.get_hiring_trends_nodistinct, "without DISTINCT, R1's three closure rows count three times").toBe(4);
    expect(sums.get_hiring_trends_noantijoin, "without the anti-join, R2 counts closed AND live").toBe(3);
  });
});

describe("today's takedown counter counts what the 90-day total would admit (executed)", () => {
  const NO_FILTER = mutant(NEWEST_TODAY.sql, /AND NOT COALESCE\(suspect, false\)/, "");
  let db: PGlite;
  let got: { fixed: number; pre: number; mut: number };
  beforeAll(async () => {
    db = await boot();
    await db.exec(NEWEST_TODAY.sql);
    await db.exec(renamed(PRE_TODAY.sql, "get_takedowns_today", "prefix"));
    await db.exec(renamed(NO_FILTER.sql, "get_takedowns_today", "mutant"));
    // "Today" rows sit two hours ahead of the seed, so a run that crosses
    // midnight still finds them on or after its own date_trunc('day', now()).
    const today = (n: number, suspect: string, superseded: boolean, basis: string) => `
      INSERT INTO public.job_board_closures (posting_id, company_token, closed_at, superseded, suspect, absence_basis)
      SELECT 't:${suspect}:${superseded}:${basis}:' || i, 'co', now() + interval '2 hours' + make_interval(secs => i),
             ${superseded}, ${suspect}, ${basis === "NULL" ? "NULL" : `'${basis}'`}
      FROM generate_series(1, ${n}) i;`;
    await db.exec([
      today(50, "false", false, "full_read"),
      today(10, "NULL", false, "NULL"),
      today(200, "true", false, "full_read"),
      today(20, "false", true, "full_read"),
      today(30, "false", false, "lap_backfill"),
      `INSERT INTO public.job_board_closures (posting_id, company_token, closed_at, suspect, absence_basis)
       SELECT 'y:' || i, 'co', now() - interval '2 days', false, 'full_read' FROM generate_series(1, 40) i;`,
    ].join("\n"));
    const r = await db.query<{ fixed: number; pre: number; mut: number }>(
      "SELECT public.get_takedowns_today() AS fixed, public.get_takedowns_today_prefix() AS pre, public.get_takedowns_today_mutant() AS mut");
    got = r.rows[0];
  });
  afterAll(async () => { await db.close(); });

  it("equals the admitted rows logged today: flagged, relisted, backfilled and yesterday's are out; a NULL flag is in", () => {
    expect(got.fixed).toBe(60);
  });

  it("teeth: the pre-fix counter and the mutant both count the flagged batch as takedowns", () => {
    expect(got.pre).toBe(260);
    expect(NO_FILTER.applied, APPLIED).toBe(true);
    expect(got.mut).toBe(260);
  });
});

describe("the migration applies over the pre-fix function and checks its own end state (executed)", () => {
  const FILE = read(NEWEST_TRENDS.file);
  const apply = async (sql: string) => {
    const db = await boot();
    await db.exec(PRE_TRENDS.sql);
    await db.exec(PRE_TODAY.sql);
    try {
      await db.exec(sql);
      const fn = await db.query<{ n: number; args: string[]; cfg: string[]; definer: boolean; anon: boolean }>(`
        SELECT count(*) OVER ()::int AS n, p.proargnames AS args, p.proconfig AS cfg, p.prosecdef AS definer,
               has_function_privilege('anon', p.oid, 'EXECUTE') AS anon
          FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
         WHERE ns.nspname = 'public' AND p.proname = 'get_hiring_trends'`);
      return fn.rows;
    } finally {
      await db.close();
    }
  };

  it("drops the five-column function, re-creates it with the sixth, and the self-check passes", async () => {
    const rows = await apply(FILE);
    expect(rows).toHaveLength(1);
    expect(rows[0].args).toContain("closed_flagged");
    expect(rows[0].cfg).toContain("statement_timeout=60s");
    expect(rows[0].definer).toBe(true);
    expect(rows[0].anon).toBe(true);
  });

  it("teeth: the end-state block refuses a copy re-issued on the old twenty-second header", async () => {
    const doctored = mutant(FILE, "SET statement_timeout = '60s' AS $$", "SET statement_timeout = '20s' AS $$");
    expect(doctored.applied, APPLIED).toBe(true);
    await expect(apply(doctored.sql)).rejects.toThrow(/sixty-second header/);
  });

  it("teeth: the end-state block refuses a counter re-issued without the exclusion", async () => {
    const doctored = mutant(FILE, /\n\s*AND NOT COALESCE\(suspect, false\)\n/, "\n");
    expect(doctored.applied, APPLIED).toBe(true);
    await expect(apply(doctored.sql)).rejects.toThrow(/does not exclude flagged batches/);
  });
});

// ── the page rules, and the prerender's mirror of them ──────────────────────

/** The prerender's figure-builder region, evaluated alone, exactly as
 *  a-data-page-that-serves-no-number-is-an-empty-page loads it. */
const PRERENDER = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
const START = "// >>> DATA-PAGE FIGURE BUILDER START";
const END = "// <<< DATA-PAGE FIGURE BUILDER END";
type Built = Record<"trends", { html: string; desc: string | null }>;
function loadSlice(src = PRERENDER): { verdict: (w: unknown, g: unknown) => ClosureVerdict; build: (p: unknown) => Built } {
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  expect(a, "the builder's start marker moved").toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  // eslint-disable-next-line no-new-func
  const [verdict, build] = new Function(`${src.slice(a, b)}; return [closureWeekVerdict, dataPageFigures];`)();
  return { verdict, build };
}

const LIVE_RECORD: ClosureRecord = { closed_90d: 1_854_930, observed_days: 79 };

describe("closureVerdict holds the incident weeks and publishes a clean one", () => {
  it("the ceiling is the 90-day record's weekly average times two", () => {
    expect(closureCeiling(LIVE_RECORD)).toBeCloseTo((1_854_930 / 79) * 14, 6);
    expect(closureCeiling(null)).toBeNull();
    expect(closureCeiling({ closed_90d: 1_854_930, observed_days: 0 })).toBeNull();
  });

  it("past 90 days deep the record is still averaged over the 90 days its count covers", () => {
    // observed_days is the age of the whole ledger and closed_90d is a 90-day
    // count. Uncapped, a 180-day ledger would put the ceiling at ONE average
    // week, and a merely busy week would be withheld as "more than twice".
    expect(CLOSURE_RECORD_WINDOW_DAYS).toBe(90);
    for (const days of [90, 91, 120, 180, 400]) {
      expect(closureCeiling({ closed_90d: 1_854_930, observed_days: days }), `${days} days deep`)
        .toBeCloseTo((1_854_930 / 90) * 14, 6);
    }
    const busy = (1_854_930 / 90) * 7 * 1.5;
    expect(closureVerdict({ closed: busy }, { closed_90d: 1_854_930, observed_days: 180 }).state).toBe("published");
  });

  it("806,570 in an old five-column row is held: it exceeds the record", () => {
    const v = closureVerdict({ closed: 806_570 }, LIVE_RECORD);
    expect(v).toMatchObject({ state: "held", reason: "exceeds_record", closed: 806_570, flagged: null });
  });

  it("a new row whose flagged records outnumber the admitted ones is held", () => {
    const v = closureVerdict({ closed: 160_000, closed_flagged: 650_000 }, LIVE_RECORD);
    expect(v).toMatchObject({ state: "held", reason: "flagged_majority", closed: 160_000, flagged: 650_000 });
  });

  it("the clean week of 08-31 is published, with its flagged count beside it", () => {
    expect(closureVerdict({ closed: 172_263, closed_flagged: 0 }, LIVE_RECORD))
      .toMatchObject({ state: "published", closed: 172_263, flagged: 0 });
    // A flagged minority does not hold a week; the page says what was excluded.
    expect(closureVerdict({ closed: 172_263, closed_flagged: 9_000 }, LIVE_RECORD))
      .toMatchObject({ state: "published", flagged: 9_000 });
  });

  it("a count that is not a count is unreadable, never zero", () => {
    for (const w of [null, {}, { closed: "806570" }, { closed: Number.NaN }, { closed: -1 }, { closed: Infinity }]) {
      expect(closureVerdict(w as ClosureWeek, LIVE_RECORD)).toMatchObject({ state: "held", reason: "unreadable" });
    }
  });

  it("the boundaries are inclusive: at the ceiling and at parity a week is printed", () => {
    const ceiling = closureCeiling(LIVE_RECORD)!;
    expect(closureVerdict({ closed: ceiling }, LIVE_RECORD).state).toBe("published");
    expect(closureVerdict({ closed: Math.floor(ceiling) + 1 }, LIVE_RECORD).state).toBe("held");
    expect(closureVerdict({ closed: 100, closed_flagged: 100 }, LIVE_RECORD).state).toBe("published");
    expect(closureVerdict({ closed: 100, closed_flagged: 101 }, LIVE_RECORD).state).toBe("held");
  });
});

/** Every point of a grid on which the two runtimes disagree. */
function disagreements(a: (w: unknown, g: unknown) => ClosureVerdict, b: (w: unknown, g: unknown) => ClosureVerdict): string[] {
  const closed = [undefined, null, "5", Number.NaN, Infinity, -1, 0, 1, 100, 101, 172_263, 288_544, 288_545, 328_722, 328_723, 806_570];
  const flagged = [undefined, null, Number.NaN, -5, 0, 1, 99, 100, 101, 650_000];
  const records = [undefined, null, {}, LIVE_RECORD, { closed_90d: 1_543_884, observed_days: 71 },
    { closed_90d: 1_854_930, observed_days: 0 }, { closed_90d: null, observed_days: 79 }, { closed_90d: "x", observed_days: 79 },
    // Older than the 90-day count: the two runtimes must cap the divisor alike.
    { closed_90d: 1_854_930, observed_days: 90 }, { closed_90d: 1_854_930, observed_days: 91 },
    { closed_90d: 1_854_930, observed_days: 180 }, { closed_90d: 1_854_930, observed_days: 400 }];
  const out: string[] = [];
  for (const c of closed) for (const f of flagged) for (const r of records) {
    const week = { closed: c, closed_flagged: f };
    const x = a(week, r);
    const y = b(week, r);
    if (JSON.stringify(x) !== JSON.stringify(y)) out.push(`${JSON.stringify(week)} / ${JSON.stringify(r)}: ${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
  }
  return out;
}

describe("a crawler and a browser are told the same thing about the same week", () => {
  const { verdict, build } = loadSlice();

  it("the prerender's mirror returns closureVerdict's verdict on every point of the grid", () => {
    const d = disagreements(closureVerdict as (w: unknown, g: unknown) => ClosureVerdict, verdict);
    expect(d, d.slice(0, 5).join("\n")).toEqual([]);
  });

  const ROWS = [
    { week_start: "2026-08-31", new_postings: 253266, entry_new: 20452, remote_new: 7807, closed: 172263 },
    { week_start: "2026-09-07", new_postings: 303025, entry_new: 23170, remote_new: 8337, closed: 845110 },
    { week_start: "2026-09-14", new_postings: 345732, entry_new: 32030, remote_new: 10798, closed: 870536 },
    { week_start: "2026-09-21", new_postings: 332381, entry_new: 30000, remote_new: 9000, closed: 806570 },
    { week_start: "2026-09-28", new_postings: 144411, entry_new: 16998, remote_new: 6064, closed: 499871 },
  ];
  const NEW_ROWS = [
    { ...ROWS[0], closed: 172263, closed_flagged: 0 },
    { ...ROWS[1], closed: 160000, closed_flagged: 685110 },
    { ...ROWS[2], closed: 170000, closed_flagged: 700536 },
    { ...ROWS[3], closed: 150000, closed_flagged: 656570 },
    { ...ROWS[4], closed: 90000, closed_flagged: 409871 },
  ];
  const payload = (rows: unknown[]) => ({
    stats: {
      computed_at: "2026-10-01T22:12:00+00:00",
      stale_parts: [],
      ghost_stats: { ...LIVE_RECORD, total_open: 752000, computed_at: "2026-10-01T22:05:00+00:00" },
      hiring_trends: rows,
      trending_categories: [],
    },
    transparency: null,
    freshness: null,
  });
  const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");

  it.each([["old five-column rows", ROWS], ["new six-column rows", NEW_ROWS]])(
    "with %s, each week as the last complete one is held or printed exactly as closureVerdict says",
    (_label, rows) => {
      for (let k = 0; k < rows.length - 1; k++) {
        const week = rows[k] as ClosureWeek & { closed: number };
        const out = build(payload(rows.slice(0, k + 2))).trends;
        const v = closureVerdict(week, LIVE_RECORD);
        const shown = week.closed.toLocaleString("en-US");
        const t = text(out.html);
        if (v.state === "published") {
          expect(t, `week ${k}: published by the page, not printed by the build`).toContain(`${shown} — closure events logged that week`);
          expect(out.desc).toContain(`${shown} closure events logged`);
        } else {
          expect(t, `week ${k}: held by the page, printed by the build`).not.toContain(`${shown} — closure events logged that week`);
          expect(t).toMatch(/Takedowns — withheld for that week/);
          expect(out.desc ?? "").not.toContain("closure events logged");
        }
      }
    },
  );

  it("the held reason is printed, with the counts that decided it", () => {
    const t = text(build(payload(NEW_ROWS.slice(0, 4))).trends.html);
    expect(t).toContain("our collector flagged 700,536 of the week's takedown records as possible read failures of its own, more than the 170,000 it could vouch for");
    const old = text(build(payload(ROWS.slice(0, 4))).trends.html);
    expect(old).toContain("it reads at more than twice the average week of our own 90-day closure record");
  });

  it("a published week says how many flagged records it excludes", () => {
    const rows = [{ ...NEW_ROWS[0], closed_flagged: 9000 }, NEW_ROWS[1]];
    expect(text(build(payload(rows)).trends.html)).toContain("9,000 flagged records were excluded from this week");
  });

  it("teeth: a mirror that always publishes is caught by the grid and prints 806,570", () => {
    const always = PRERENDER.replace(
      /(function closureWeekVerdict\(week, ghost\) \{)/,
      "$1\n    return { state: \"published\", closed: week && week.closed, flagged: week && week.closed_flagged, ceiling: null };",
    );
    expect(always).not.toBe(PRERENDER);
    const broken = loadSlice(always);
    const d = disagreements(closureVerdict as (w: unknown, g: unknown) => ClosureVerdict, broken.verdict);
    expect(d.length).toBeGreaterThan(0);
    expect(d.some((x) => x.startsWith('{"closed":806570'))).toBe(true);
    expect(text(broken.build(payload(ROWS.slice(0, 5))).trends.html)).toContain("806,570 — closure events logged that week");
  });
});
