// @vitest-environment node
/**
 * TWO JOBS PAGE AGGREGATES ANSWER FROM A ROW, ONCE ITS WRITER IS SCHEDULED
 * (cost audit 2026-11-08, "Live aggregates on /jobs"; migration 20261109170000).
 *
 * /jobs calls get_country_facet() and get_salary_benchmarks() on every
 * render by a person, each an aggregate over the whole board. A writer
 * stores their answers in one job_board_stats_rollup row and each reader
 * answers from it while it is under two hours old -- else runs exactly what
 * it ran before. The file schedules no writer (the saving needs more than 24
 * calls a day per reader, which nobody has read), and get_takedowns_today()
 * is left as it was: a cheap count the Data API holds a feed walk against.
 *
 * Two pglite databases get the same board. One holds the definitions the
 * migration replaces (20260729183822, 20260811160307 made DEFINER by
 * 20260827130000, 20261008111000); the other those plus the migration. The
 * readers must give the same rows in the same order whenever the row is
 * missing, stale or malformed, and the row's answers when it is fresh -- which
 * are the live answers as of the writer's run.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const MIG = resolve(__dirname, "../../supabase/migrations");
const read = (f: string) => readFileSync(resolve(MIG, f), "utf8");
const NEW = read("20261109170000_two_jobs_page_aggregates_answer_from_a_row_once_its_writer_is_scheduled.sql");

/** `CREATE OR REPLACE FUNCTION public.<fn>(` up to its closing `$$;`. */
function definitionIn(sql: string, fn: string): string {
  const i = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${fn}(`);
  const j = sql.indexOf("\n$$;", i);
  if (i < 0 || j < 0) throw new Error(`no definition of ${fn}`);
  return sql.slice(i, j + 4);
}
/** A reader's body as the migration writes it, to EXPLAIN on its own. */
function bodyIn(sql: string, fn: string): string {
  const def = definitionIn(sql, fn);
  return def.slice(def.indexOf("AS $$") + 5, def.lastIndexOf("\n$$;")).trim().replace(/;$/, "");
}
const OLD = [
  definitionIn(read("20260729183822_61870af3-5fed-4569-a4ad-035fcdfcbb35.sql"), "get_country_facet"),
  definitionIn(read("20260811160307_b721954a-be85-494d-b640-1e047506afdf.sql"), "get_salary_benchmarks"),
  "ALTER FUNCTION public.get_salary_benchmarks() SECURITY DEFINER;",
  definitionIn(read("20261008111000_a_week_the_fence_already_emptied_is_not_drawn_and_today_is_the_last_24_hours.sql"), "get_takedowns_today"),
  `REVOKE ALL ON FUNCTION public.get_country_facet(), public.get_salary_benchmarks(), public.get_takedowns_today() FROM PUBLIC;
   GRANT EXECUTE ON FUNCTION public.get_country_facet(), public.get_salary_benchmarks(), public.get_takedowns_today() TO anon, authenticated, service_role;`,
].join("\n");

const SCHEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_postings (
    id text PRIMARY KEY, country text, missing_since timestamptz, category text,
    salary_currency text, salary_min_annual numeric, effective_posted timestamptz);
  CREATE TABLE public.job_board_closures (
    event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, posting_id text NOT NULL, company_token text NOT NULL DEFAULT 'acme',
    closed_at timestamptz NOT NULL DEFAULT now(), superseded boolean NOT NULL DEFAULT false, suspect boolean, absence_basis text);
  CREATE TABLE public.job_board_stats_rollup (k text PRIMARY KEY, v jsonb NOT NULL, computed_at timestamptz NOT NULL DEFAULT now());
  REVOKE ALL ON public.job_board_postings, public.job_board_closures, public.job_board_stats_rollup FROM anon, authenticated;
`;
const CRON = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (
    jobid bigserial PRIMARY KEY, schedule text NOT NULL, command text NOT NULL,
    active boolean NOT NULL DEFAULT true, jobname text UNIQUE);
  CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
    INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
    ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
    RETURNING jobid $$;
`;

// Every predicate the readers apply has a row on each side of it: a country
// under ten, an empty and a NULL country, a closed posting, a posting older
// than 30 days (counted by the facet, not the benchmarks), a category whose
// runner-up currency also clears 30, a NULL category, a category under 30, and
// closures that are superseded, suspect, NULL-suspect, lap_backfill and old.
const GROUPS: Array<[string | null, boolean, string | null, string | null, number, number, number]> = [
  // country, open, category, currency, rows, age in days, salary base
  ["US", true, "engineering", "USD", 30, 1, 90_000],
  ["US", false, "engineering", "USD", 5, 1, 1],
  ["US", true, "engineering", "USD", 10, 40, 400_000],
  ["GB", true, "design", "GBP", 30, 2, 50_000],
  ["DE", true, "engineering", "EUR", 12, 1, 60_000],
  [null, true, "engineering", "EUR", 19, 1, 61_000],
  ["", true, "engineering", "USD", 6, 1, 95_000],
  ["FR", true, "marketing", "USD", 9, 1, 70_000],
  ["CA", true, null, "CAD", 31, 5, 65_000],
  ["JP", true, "engineering", null, 14, 1, 0],
];
const BOARD = GROUPS.map(([country, open, cat, cur, rows, age, base], g) => `
  INSERT INTO public.job_board_postings (id, country, missing_since, category, salary_currency, salary_min_annual, effective_posted)
  SELECT 'g${g}:' || i, ${country === null ? "NULL" : `'${country}'`}, ${open ? "NULL" : "now()"},
         ${cat === null ? "NULL" : `'${cat}'`}, ${cur === null ? "NULL" : `'${cur}'`},
         ${cur === null ? "NULL" : `${base} + i * 1000`}, now() - interval '${age} days'
  FROM generate_series(1, ${rows}) i;`).join("\n") + `
  INSERT INTO public.job_board_closures (posting_id, closed_at, superseded, suspect, absence_basis)
  SELECT 'c' || i, now() - interval '1 hour', false, false, (ARRAY['full_read', 'lap', NULL])[1 + i % 3] FROM generate_series(1, 7) i;
  INSERT INTO public.job_board_closures (posting_id, closed_at, superseded, suspect, absence_basis) VALUES
    ('s1', now() - interval '2 hours', true, false, 'full_read'), ('s2', now() - interval '2 hours', true, false, 'lap'),
    ('f1', now() - interval '3 hours', false, true, 'full_read'), ('f2', now() - interval '3 hours', false, true, 'lap'),
    ('f3', now() - interval '3 hours', false, true, NULL),
    ('n1', now() - interval '4 hours', false, NULL, 'full_read'),
    ('b1', now() - interval '1 hour', false, false, 'lap_backfill'), ('b2', now() - interval '1 hour', false, false, 'lap_backfill'),
    ('b3', now() - interval '1 hour', false, false, 'lap_backfill'), ('b4', now() - interval '1 hour', false, false, 'lap_backfill'),
    ('o1', now() - interval '25 hours', false, false, 'full_read'), ('o2', now() - interval '30 hours', false, false, 'lap');
`;
// The board an hour later: a new country, a benchmark that moves, more takedowns.
const MOVE = `
  INSERT INTO public.job_board_postings (id, country, category, salary_currency, salary_min_annual, effective_posted)
  SELECT 'it:' || i, 'IT', 'engineering', 'USD', 200000 + i * 5000, now() FROM generate_series(1, 25) i;
  INSERT INTO public.job_board_closures (posting_id, closed_at, absence_basis)
  SELECT 'm' || i, now() - interval '10 minutes', 'lap' FROM generate_series(1, 3) i;
`;

type Answer = { countries: string[]; benchmarks: string[]; takedowns: number };
async function answer(db: PGlite, role = "postgres"): Promise<Answer> {
  await db.exec(`SET ROLE ${role}`);
  try {
    const c = await db.query<{ country: string; n: string }>("SELECT country, n::text AS n FROM public.get_country_facet()");
    const s = await db.query<{ category: string | null; currency: string; n: number; m: string }>(
      "SELECT category, currency, n, median_annual_min::text AS m FROM public.get_salary_benchmarks()");
    const t = await db.query<{ n: number }>("SELECT public.get_takedowns_today() AS n");
    return {
      countries: c.rows.map((r) => `${r.country}=${r.n}`),
      benchmarks: s.rows.map((r) => `${r.category}/${r.currency}/${r.n}/${r.m}`),
      takedowns: t.rows[0].n,
    };
  } finally {
    await db.exec("RESET ROLE");
  }
}
const refresh = async (db: PGlite) => {
  await db.exec("SET ROLE service_role");
  try { await db.query("SELECT public.refresh_jobs_live_aggregates()"); } finally { await db.exec("RESET ROLE"); }
};
const row = async (db: PGlite) =>
  (await db.query<{ v: Record<string, unknown>; computed_at: string }>(
    "SELECT v, computed_at::text AS computed_at FROM public.job_board_stats_rollup WHERE k = 'jobs_live_aggregates'")).rows[0];

const OPEN: PGlite[] = [];
afterAll(async () => { for (const db of OPEN) { try { await db.close(); } catch { /* best effort */ } } });
async function boot(opts: { withNew: boolean; cron?: boolean; extra?: string }): Promise<PGlite> {
  const db = new PGlite();
  OPEN.push(db);
  await db.exec(SCHEMA + (opts.cron === false ? "" : CRON));
  await db.exec(BOARD);
  await db.exec(OLD);
  if (opts.withNew) await db.exec(opts.extra ?? NEW);
  return db;
}

describe("the answers do not change", () => {
  let was: PGlite;
  let now: PGlite;
  beforeAll(async () => { [was, now] = await Promise.all([boot({ withNew: false }), boot({ withNew: true })]); });

  it("before the writer's first run every reader answers exactly what the function it replaces answered, in the same order", async () => {
    expect(await row(now)).toBeUndefined();
    const a = await answer(now);
    expect(a).toEqual(await answer(was));
    // The fixture reaches every predicate, so equal is not vacuous.
    expect(a.countries).toEqual(["US=40", "CA=31", "GB=30", "JP=14", "DE=12"]);
    expect(a.benchmarks).toEqual(["design/GBP/30/65500", "engineering/USD/36/102500", "null/CAD/31/81000"]);
    expect(a.takedowns).toBe(8);
  });

  it("a run of the writer stores the live answers of the two readers, and they then return them, in order", async () => {
    await refresh(now);
    const r = await row(now);
    expect(Object.keys(r?.v ?? {}).sort()).toEqual(["as_of", "country_facet", "salary_benchmarks"]);
    expect(await answer(now)).toEqual(await answer(was));
    expect(await answer(now, "anon"), "the page's own role reads the same answer").toEqual(await answer(was, "anon"));
  });

  it("while the row is fresh the readers answer it even though the board has moved; the next run catches up", async () => {
    await was.exec(MOVE);
    await now.exec(MOVE);
    const moved = await answer(was);
    expect(moved.countries[0]).toBe("US=40");
    expect(moved.countries).toContain("IT=25");
    expect(moved.takedowns).toBe(11);
    const cached = await answer(now);
    expect(cached.countries, "the cached facet does not know IT yet").not.toContain("IT=25");
    expect(cached.benchmarks).not.toEqual(moved.benchmarks);
    await refresh(now);
    expect(await answer(now)).toEqual(moved);
  });

  it("the takedown count stays live beside a fresh row: a feed walk ending now can never count more than it", async () => {
    await refresh(now);
    await was.exec("INSERT INTO public.job_board_closures (posting_id, closed_at, absence_basis) VALUES ('late1', now(), 'full_read'), ('late2', now(), 'lap')");
    await now.exec("INSERT INTO public.job_board_closures (posting_id, closed_at, absence_basis) VALUES ('late1', now(), 'full_read'), ('late2', now(), 'lap')");
    expect((await answer(now)).takedowns).toBe((await answer(was)).takedowns);
    expect((await answer(now)).takedowns).toBe(13);
    expect(NEW, "the file does not re-issue the takedown counter").not.toMatch(/FUNCTION public\.get_takedowns_today/);
  });
});

describe("a row that cannot be trusted is never answered", () => {
  let was: PGlite;
  let now: PGlite;
  beforeAll(async () => {
    [was, now] = await Promise.all([boot({ withNew: false }), boot({ withNew: true })]);
    await refresh(now);
    await was.exec(MOVE);
    await now.exec(MOVE);
  });

  it("a row older than two hours: each reader counts live", async () => {
    await now.exec("UPDATE public.job_board_stats_rollup SET computed_at = now() - interval '2 hours 1 second' WHERE k = 'jobs_live_aggregates'");
    expect(await answer(now)).toEqual(await answer(was));
    await now.exec("UPDATE public.job_board_stats_rollup SET computed_at = now() - interval '1 hour 59 minutes' WHERE k = 'jobs_live_aggregates'");
    expect((await answer(now)).countries, "just under two hours old, it is still answered").not.toContain("IT=25");
  });

  it("a key that is missing or of the wrong shape: that reader counts live, the others keep the row", async () => {
    await now.exec(`UPDATE public.job_board_stats_rollup
                       SET v = v - 'country_facet', computed_at = now()
                     WHERE k = 'jobs_live_aggregates'`);
    const a = await answer(now);
    const live = await answer(was);
    expect(a.countries).toEqual(live.countries);
    expect(a.benchmarks, "the benchmarks key is intact, so it is answered").not.toEqual(live.benchmarks);
    await now.exec(`UPDATE public.job_board_stats_rollup SET v = v || '{"country_facet": "US"}'::jsonb WHERE k = 'jobs_live_aggregates'`);
    expect((await answer(now)).countries, "a string where an array belongs is not a facet").toEqual(live.countries);
    await now.exec(`UPDATE public.job_board_stats_rollup SET v = v || '{"salary_benchmarks": {}}'::jsonb WHERE k = 'jobs_live_aggregates'`);
    expect((await answer(now)).benchmarks).toEqual(live.benchmarks);
  });

  it("no row at all: the readers are the old functions", async () => {
    await now.exec("DELETE FROM public.job_board_stats_rollup");
    expect(await answer(now)).toEqual(await answer(was));
  });
});

describe("the writer computes live, never from its own row", () => {
  const SENTINEL = `
    INSERT INTO public.job_board_stats_rollup (k, v, computed_at) VALUES ('jobs_live_aggregates',
      '{"country_facet": [{"country": "ZZ", "n": 1}], "salary_benchmarks": []}'::jsonb, now());`;

  it("a fresh row of wrong answers is replaced by the live ones", async () => {
    const [was, now] = await Promise.all([boot({ withNew: false }), boot({ withNew: true })]);
    await now.exec(SENTINEL);
    expect((await answer(now)).countries).toEqual(["ZZ=1"]);
    await refresh(now);
    expect(await answer(now)).toEqual(await answer(was));
    expect((await row(now))?.v.country_facet).toEqual([{ country: "US", n: 40 }, { country: "CA", n: 31 }, { country: "GB", n: 30 }, { country: "JP", n: 14 }, { country: "DE", n: 12 }]);
  });

  it("teeth: a writer without the switch copies the row it is meant to replace", async () => {
    const writer = definitionIn(NEW, "refresh_jobs_live_aggregates");
    const line = "PERFORM set_config('rb.live_aggregates', 'compute', true);";
    expect(writer).toContain(line);
    const now = await boot({ withNew: true });
    await now.exec(writer.replace(line, ""));
    await now.exec(SENTINEL);
    await refresh(now);
    expect((await row(now))?.v.country_facet).toEqual([{ country: "ZZ", n: 1 }]);
  });

  it("the switch ends with the writer's transaction: a reader in the next one answers the new row", async () => {
    const now = await boot({ withNew: true });
    await refresh(now);
    await now.exec(`UPDATE public.job_board_stats_rollup SET v = jsonb_set(v, '{country_facet}', '[{"country": "QQ", "n": 77}]') WHERE k = 'jobs_live_aggregates'`);
    expect((await answer(now)).countries).toEqual(["QQ=77"]);
  });
});

describe("what the row buys", () => {
  const plan = async (db: PGlite, fn: string) =>
    (await db.query<{ "QUERY PLAN": string }>(`EXPLAIN (ANALYZE, COSTS OFF, TIMING OFF, SUMMARY OFF) ${bodyIn(NEW, fn)}`))
      .rows.map((r) => r["QUERY PLAN"]);
  const scans = (lines: string[], table: string) => lines.filter((l) => l.includes(`Seq Scan on ${table}`));

  it("with the row fresh, neither reader executes its scan of the board", async () => {
    const db = await boot({ withNew: true });
    await refresh(db);
    for (const [fn, table] of [["get_country_facet", "job_board_postings"], ["get_salary_benchmarks", "job_board_postings"]]) {
      const s = scans(await plan(db, fn), table);
      expect(s.length, `${fn} has no scan of ${table} in its plan at all`).toBeGreaterThan(0);
      for (const l of s) expect(l, `${fn}: ${l.trim()}`).toMatch(/never executed/);
    }
  });

  it("teeth: with no row, the same plans execute that scan", async () => {
    const db = await boot({ withNew: true });
    for (const [fn, table] of [["get_country_facet", "job_board_postings"], ["get_salary_benchmarks", "job_board_postings"]]) {
      const s = scans(await plan(db, fn), table);
      expect(s.some((l) => !/never executed/.test(l)), `${fn} did not scan ${table}`).toBe(true);
    }
  });
});

describe("grants, the offered schedule and re-apply", () => {
  it("the page's roles call the readers and never the writer", async () => {
    const db = await boot({ withNew: true });
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      await expect(db.query("SELECT public.refresh_jobs_live_aggregates()")).rejects.toThrow(/permission denied/);
      await db.exec("RESET ROLE");
      expect((await answer(db, role)).takedowns).toBe(8);
    }
  });

  it("the file schedules no writer: every call counts live until the owner schedules it", async () => {
    const db = await boot({ withNew: true });
    expect((await db.query("SELECT 1 FROM cron.job")).rows).toEqual([]);
    expect(await row(db)).toBeUndefined();
  });

  /** The command the file's notice hands the owner. */
  const OFFERED = /cron\.schedule\(''refresh-jobs-live-aggregates'', ''([^']+)'', \$c\$(.*?)\$c\$\)/.exec(NEW);

  it("the command it offers the owner sets its own three-minute timeout, as the writer's header does", async () => {
    expect(OFFERED, "the notice names the command").toBeTruthy();
    expect(OFFERED![2].replace(/''/g, "'")).toBe("SET statement_timeout = '3min'; SELECT public.refresh_jobs_live_aggregates();");
    expect(definitionIn(NEW, "refresh_jobs_live_aggregates")).toContain("SET statement_timeout = '3min'");
  });

  it("the minute it offers is one no job pinned to named minutes runs at, once every wave migration has applied", () => {
    const minute = Number(OFFERED![1].split(/\s+/)[0]);
    expect(OFFERED![1]).toBe(`${minute} * * * *`);
    const live = new Map<string, string>();
    for (const f of readdirSync(MIG).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = read(f);
      for (const m of sql.matchAll(/cron\.schedule\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) live.set(m[1], m[2]);
      for (const m of sql.matchAll(/cron\.unschedule\(\s*'([^']+)'\s*\)/g)) live.delete(m[1]);
    }
    // What the wave unschedules, and moves by cron.alter_job, as it leaves them.
    live.delete("board-recency-ladder");
    live.delete("refresh-explore-role-rows");
    live.set("refresh-board-facets", "2,17,32,47 * * * *");
    live.set("refresh-ghost-stats", "15 * * * *");
    const clash = [...live].filter(([name, schedule]) => {
      const [m, hour] = schedule.split(/\s+/);
      if (name === "refresh-jobs-live-aggregates" || hour !== "*" || /^\*(\/\d+)?$/.test(m)) return false;
      return m.split(",").some((p) => {
        const [range, step] = p.split("/");
        const [a, b] = range.includes("-") ? range.split("-").map(Number) : [Number(range), step ? 59 : Number(range)];
        for (let x = a; x <= b; x += step ? Number(step) : 1) if (x === minute) return true;
        return false;
      });
    });
    expect(clash).toEqual([]);
  });

  it("re-applying keeps the row and a job the owner scheduled, and a database without pg_cron applies cleanly", async () => {
    const db = await boot({ withNew: true });
    await db.query("SELECT cron.schedule('refresh-jobs-live-aggregates', '52 * * * *', $1)", ["SET statement_timeout = '3min'; SELECT public.refresh_jobs_live_aggregates();"]);
    await refresh(db);
    const before = await row(db);
    await db.exec(NEW);
    expect((await db.query("SELECT schedule FROM cron.job WHERE jobname = 'refresh-jobs-live-aggregates'")).rows).toEqual([{ schedule: "52 * * * *" }]);
    expect(await row(db)).toEqual(before);
    const bare = await boot({ withNew: true, cron: false });
    expect(await answer(bare)).toEqual(await answer(await boot({ withNew: false, cron: false })));
  });
});
