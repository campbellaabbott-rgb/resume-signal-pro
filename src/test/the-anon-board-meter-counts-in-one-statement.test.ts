// @vitest-environment node
//
// Node, not jsdom: this executes the migration in pglite.
/**
 * THE ANONYMOUS BOARD METER COUNTS IN ONE STATEMENT.
 *
 * WHAT WAS WRONG (measured 2026-10-01/02). job-board answered list, detail and
 * facets to any anonymous caller without limit, and one JS-rendering client
 * loaded /jobs?job=<id> ~5,800 times a day -- about 29,000 counted board calls
 * -- harvesting the corpus through the site's publishable key, around the
 * metered /v1 API. Migration 20261002140000 is the meter; anon-budget.ts
 * decides who reaches it. Migration 20261003180000 (.87) restates the counter
 * with the caller's network, board-pass state and pass id; its own rules
 * (the network block, the pass meter, requirePass and the shared tooling
 * row) are held in the last describe blocks below.
 *
 * WHAT THIS HOLDS, executed against the LAST migration that defines the
 * counter (what the database runs) applied over the meter's own migration, in
 * pglite under Supabase's default privileges:
 *   - the caps: a cap of N admits exactly N calls a day per bucket and counts
 *     the rest as over, in both tables; another bucket is untouched; cap 0
 *     refuses the first call; a mid-day raise re-admits up to the new cap;
 *     yesterday's row does not count today;
 *   - ONE ROW PER ADDRESS: the declared kind picks the cap and nothing else,
 *     so one address rotating every kind it can declare (with the real
 *     anon-budget.ts bucketing) is served at most the LARGEST cap, never the
 *     caps added together -- the header is public;
 *   - kind unknown_address (an address the platform did not hand us, or a
 *     non-public one) is never refused by an address cap -- so a platform
 *     header change cannot become a global wall;
 *   - an absurd override (1e20) is clamped, not raised: the gate fails open
 *     on any error, so a raise would switch the meter off silently;
 *   - the hourly rows keep the caller kind, so an internal caller missing its
 *     reader proof is visible by name;
 *   - the country switch is OFF unless the setting lists a country, and then
 *     refuses only that country's calls, whatever the kind; a non-array list
 *     is ignored; a listed country's callers with no usable address get a
 *     bucket of their own for that country, so the world's no-address calls
 *     never spend its allowance; observe-only counts and flags a listed
 *     country without refusing; the migration seeds observe-only and never
 *     overwrites an existing setting row;
 *   - retention: rows past eight days are removed by a bounded delete that
 *     never waits on a lock, on a bucket's FIRST call of the day only;
 *   - grants: anon and authenticated can touch neither table nor the counter;
 *     anon CAN call the reader, whose columns are aggregates only, and its ALL
 *     rows equal the sum of its country rows;
 *   - the SHAPE: one INSERT into each table, both inside one data-modifying
 *     WITH, the verdict assigned inside the conflict update and returned by
 *     that statement, and no read-then-write of the counter anywhere; the one
 *     other meter INSERT is a pass's own day row, which decides and returns
 *     its verdict the same way.
 * TEETH, in this file: a `<=` cap test lets a fourth call through a cap of 3;
 * a select-then-update rewrite fails the shape check.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { sqlCodeOf } from "./helpers/live-sql";
import { bucketFor, classifyCaller, type CountedCaller } from "../../supabase/functions/job-board/anon-budget";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const DIR = resolve(__dirname, "../../supabase/migrations");
const NAMES = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** The whole LAST migration whose code defines `fn`: what the database holds. */
function lastDefining(fn: string): { file: string; sql: string } {
  const hits = NAMES.filter((f) => new RegExp(`FUNCTION\\s+public\\.${fn}\\s*\\(`).test(sqlCodeOf(readFileSync(resolve(DIR, f), "utf8"))));
  if (!hits.length) throw new Error(`no migration defines ${fn} — searched ${NAMES.length} files`);
  const file = hits[hits.length - 1];
  return { file, sql: readFileSync(resolve(DIR, file), "utf8") };
}

const SUPABASE_DEFAULTS = `
  -- service_role bypasses RLS on Supabase, which is what lets the counter run
  -- as its caller (SECURITY INVOKER) over two RLS-on tables with no policy.
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
  -- Supabase's own defaults: new functions and tables in public are open to the API roles directly.
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
  CREATE TABLE public.job_board_meta (k text PRIMARY KEY, v jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());
  REVOKE ALL ON TABLE public.job_board_meta FROM anon, authenticated;
`;

type Verdict = { is_allowed: boolean; used_today: number; over_today: number; cap_today: number; country_rule: boolean; enforcing: boolean };
const CAPS: [number, number, number] = [3, 10, 5];

async function boot(sql: string): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(SUPABASE_DEFAULTS);
  await db.exec(sql);
  return db;
}
const call = async (db: PGlite, bucket: string, kind: string, cc: string | null, caps = CAPS, bare = false): Promise<Verdict> =>
  (await db.query<Verdict>("SELECT * FROM public.job_board_anon_check($1, $2, $3, $4, $5, $6, $7)", [bucket, kind, cc, ...caps, bare])).rows[0];
const setting = (db: PGlite, v: Record<string, unknown> | null) => v === null
  ? db.exec("DELETE FROM public.job_board_meta WHERE k = 'anon_board_budget'")
  : db.query("INSERT INTO public.job_board_meta (k, v) VALUES ('anon_board_budget', $1::jsonb) ON CONFLICT (k) DO UPDATE SET v = excluded.v", [JSON.stringify(v)]);
const meter = async (db: PGlite, bucket: string) =>
  (await db.query<{ within_cap: number; over_cap: number }>("SELECT within_cap, over_cap FROM public.job_board_anon_meter WHERE bucket = $1 AND day_utc = (now() AT TIME ZONE 'UTC')::date", [bucket])).rows[0];
const hourly = async (db: PGlite, bucket: string) =>
  (await db.query<{ kind: string; country: string; within_cap: number; over_cap: number; bare_calls: number }>(
    "SELECT kind, country, sum(within_cap)::int AS within_cap, sum(over_cap)::int AS over_cap, sum(bare_calls)::int AS bare_calls FROM public.job_board_anon_hourly WHERE bucket = $1 GROUP BY kind, country ORDER BY kind, country", [bucket])).rows;

const MIGRATION = lastDefining("job_board_anon_check");
/** The meter's tables, the hourly reader and the seed: what the newest counter is applied over. */
const BASE = { file: "20261002140000_a_browser_address_gets_a_browsers_day_and_the_count_is_readable.sql", sql: "" };
BASE.sql = readFileSync(resolve(DIR, BASE.file), "utf8");
/** Every migration the meter's state comes from, in order (the base alone when it is still the newest). */
const CHAIN = MIGRATION.file === BASE.file ? BASE.sql : `${BASE.sql}\n${MIGRATION.sql}`;
const chainWith = (counterSql: string) => (MIGRATION.file === BASE.file ? counterSql : `${BASE.sql}\n${counterSql}`);

describe("the anonymous board meter, executed", () => {
  let db: PGlite;
  beforeAll(async () => { db = await boot(CHAIN); });
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("DELETE FROM public.job_board_anon_meter WHERE true; DELETE FROM public.job_board_anon_hourly WHERE true;");
    await setting(db, { enforce: true });
  });

  it("the hourly reader lives in the meter's migration; the counter and the network reader in the newest", () => {
    expect(lastDefining("get_board_anon_hourly").file).toBe(BASE.file);
    expect(lastDefining("get_board_anon_networks").file).toBe(MIGRATION.file);
    expect(MIGRATION.file >= BASE.file).toBe(true);
  });

  it("the migrations seed observe-only, and never overwrite a setting row that exists", async () => {
    const fresh = await boot(CHAIN);
    try {
      const seeded = (await fresh.query<{ v: Record<string, unknown> }>("SELECT v FROM public.job_board_meta WHERE k = 'anon_board_budget'")).rows[0];
      expect(seeded?.v, "ships counting, not refusing").toEqual({ enforce: false });
      await fresh.exec(`UPDATE public.job_board_meta SET v = '{"enforce": true, "addressCap": 7}'::jsonb WHERE k = 'anon_board_budget'`);
      await fresh.exec(CHAIN); // idempotent, and the owner's row survives a re-run
      expect((await fresh.query<{ v: unknown }>("SELECT v FROM public.job_board_meta WHERE k = 'anon_board_budget'")).rows[0].v).toEqual({ enforce: true, addressCap: 7 });
    } finally { await fresh.close(); }
  });

  it("a cap of 3 admits three calls and counts the rest as over, in both tables", async () => {
    const got: Verdict[] = [];
    for (let i = 0; i < 5; i++) got.push(await call(db, "ip:aaa", "address", "US"));
    expect(got.map((r) => r.is_allowed)).toEqual([true, true, true, false, false]);
    expect(got.map((r) => r.used_today)).toEqual([1, 2, 3, 3, 3]);
    expect(got.map((r) => r.over_today)).toEqual([0, 0, 0, 1, 2]);
    expect(got.every((r) => r.cap_today === 3 && r.enforcing && !r.country_rule)).toBe(true);
    expect(await meter(db, "ip:aaa")).toEqual({ within_cap: 3, over_cap: 2 });
    expect(await hourly(db, "ip:aaa")).toEqual([{ kind: "address", country: "US", within_cap: 3, over_cap: 2, bare_calls: 0 }]);
  });

  it("another bucket is untouched by a spent one", async () => {
    for (let i = 0; i < 4; i++) await call(db, "ip:aaa", "address", "US");
    const other = await call(db, "ip:bbb", "address", "US");
    expect(other).toMatchObject({ is_allowed: true, used_today: 1, over_today: 0 });
  });

  it("cap 0 refuses the first call and still records it", async () => {
    expect(await call(db, "ip:zero", "address", "US", [0, 10, 5])).toMatchObject({ is_allowed: false, used_today: 0, over_today: 1, cap_today: 0 });
    expect(await meter(db, "ip:zero")).toEqual({ within_cap: 0, over_cap: 1 });
  });

  it("a mid-day raise re-admits an address up to the new cap; a cut refuses at once", async () => {
    for (let i = 0; i < 5; i++) await call(db, "ip:aaa", "address", "US");
    await setting(db, { enforce: true, addressCap: 4 });
    expect((await call(db, "ip:aaa", "address", "US")).is_allowed).toBe(true);
    expect((await call(db, "ip:aaa", "address", "US")).is_allowed).toBe(false);
    await setting(db, { enforce: true, addressCap: 1 });
    expect(await call(db, "ip:aaa", "address", "US")).toMatchObject({ is_allowed: false, cap_today: 1 });
  });

  it("yesterday's row does not count today", async () => {
    await db.exec("INSERT INTO public.job_board_anon_meter VALUES ((now() AT TIME ZONE 'UTC')::date - 1, 'ip:y', 99, 9, true)");
    expect(await call(db, "ip:y", "address", "US")).toMatchObject({ is_allowed: true, used_today: 1, over_today: 0 });
  });

  it("one address rotating every kind it can declare is served at most the LARGEST cap, never the caps added", async () => {
    // The real bucketing from anon-budget.ts, so this holds the pair, not the SQL alone.
    const declare: Record<string, string>[] = [{}, { "x-rb-budget": "build" }, { "x-rb-budget": "probe" }, { "x-rsp-caller": "mcp" }];
    let served = 0;
    const buckets = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const c = await classifyCaller(new Headers({ "cf-connecting-ip": "203.0.113.9", "cf-ipcountry": "US", ...declare[i % 4] }), "svc") as CountedCaller;
      const bucket = await bucketFor(c, "svc");
      buckets.add(bucket);
      if ((await call(db, bucket, c.kind, c.country)).is_allowed) served++;
    }
    expect(served, `caps ${CAPS.join("/")}: the most is the largest, ${Math.max(...CAPS)}, not their sum ${CAPS[0] + CAPS[1] + CAPS[2]}`).toBe(Math.max(...CAPS));
    expect(buckets.size, "one address, one day row").toBe(1);
    expect((await hourly(db, [...buckets][0])).map((r) => r.kind), "the hourly rows still name every kind").toEqual(["address", "build", "probe", "unproven_mcp"]);
  });

  it("kind unknown_address is never refused, whatever the address cap", async () => {
    const got: Verdict[] = [];
    for (let i = 0; i < 3; i++) got.push(await call(db, "unknown", "unknown_address", "US", [1, 1, 1]));
    expect(got.map((r) => r.is_allowed), "an address we were never told must not become one shared wall").toEqual([true, true, true]);
    expect(got[0].cap_today).toBe(100_000_000);
    expect((await hourly(db, "unknown")).map((r) => r.kind)).toEqual(["unknown_address"]);
  });

  it("the kind picks the cap and its override, judged against the address's one row", async () => {
    expect((await call(db, "ip:x", "build", "US")).cap_today).toBe(10);
    expect((await call(db, "ip:x", "probe", "US")).cap_today).toBe(5);
    await setting(db, { enforce: true, buildCap: 3, probeCap: 0 });
    expect((await call(db, "ip:x", "build", "US")).is_allowed, "two already served on this row, a third under buildCap 3").toBe(true);
    expect((await call(db, "ip:x", "build", "US")).is_allowed).toBe(false);
    expect((await call(db, "ip:y", "probe", "US")).is_allowed, "probeCap 0: the deploy note's one-off 429 proof").toBe(false);
  });

  it("an absurd override is clamped, not raised, and a junk kind counts as an address", async () => {
    await setting(db, { enforce: true, addressCap: 1e20 });
    expect(await call(db, "ip:big", "address", "US")).toMatchObject({ is_allowed: true, cap_today: 100_000_000 });
    await setting(db, { enforce: true, addressCap: -5 });
    expect(await call(db, "ip:neg", "address", "US")).toMatchObject({ is_allowed: false, cap_today: 0 });
    await setting(db, { enforce: true });
    await call(db, "ip:junk", "root", "us");
    expect(await hourly(db, "ip:junk")).toEqual([{ kind: "address", country: "US", within_cap: 1, over_cap: 0, bare_calls: 0 }]);
  });

  it("the hourly rows keep the caller kind, and count bare calls", async () => {
    await call(db, "ip:k", "unproven_api", "US", CAPS, true);
    await call(db, "ip:k", "unproven_mcp", "US");
    await call(db, "ip:k", "unproven_mcp", "US", CAPS, true);
    expect(await hourly(db, "ip:k")).toEqual([
      { kind: "unproven_api", country: "US", within_cap: 1, over_cap: 0, bare_calls: 1 },
      { kind: "unproven_mcp", country: "US", within_cap: 2, over_cap: 0, bare_calls: 1 },
    ]);
    expect(await meter(db, "ip:k"), "one address bucket, whatever the kind").toEqual({ within_cap: 3, over_cap: 0 });
  });

  it("the country switch is OFF until a country is listed, and then refuses only that country", async () => {
    expect(await call(db, "ip:cn1", "address", "CN")).toMatchObject({ is_allowed: true, country_rule: false, cap_today: 3 });
    await setting(db, { enforce: true, countries: ["cn"], countryCap: 0 });
    expect(await call(db, "ip:cn2", "address", "CN")).toMatchObject({ is_allowed: false, country_rule: true, cap_today: 0 });
    expect(await call(db, "ip:us", "address", "US")).toMatchObject({ is_allowed: true, country_rule: false });
    expect(await call(db, "ip:xx", "address", null)).toMatchObject({ is_allowed: true, country_rule: false });
    expect(await call(db, "ip:t1", "address", "T1"), "Tor's T1 is not a country").toMatchObject({ is_allowed: true, country_rule: false });
    await setting(db, { enforce: true, countries: [" CN ", 7], countryCap: 2 });
    const held = [await call(db, "ip:cn3", "address", "CN"), await call(db, "ip:cn3", "address", "CN"), await call(db, "ip:cn3", "address", "CN")];
    expect(held.map((r) => r.is_allowed), "a small budget, not a refusal").toEqual([true, true, false]);
    await setting(db, { enforce: true, countries: "CN", countryCap: 0 });
    expect(await call(db, "ip:cn4", "address", "CN"), "a non-array list is ignored, not half-applied").toMatchObject({ is_allowed: true, country_rule: false });
    await setting(db, { enforce: true, countries: ["CN"], countryCap: 0 });
    expect(await call(db, "ip:cnb", "build", "CN"), "a public header cannot buy its way past the country rule").toMatchObject({ is_allowed: false, country_rule: true });
    await db.exec("UPDATE public.job_board_meta SET v = v - 'countries' - 'countryCap' WHERE k = 'anon_board_budget'");
    expect(await call(db, "ip:cn5", "address", "CN"), "the deploy note's DISABLE statement turns it off").toMatchObject({ is_allowed: true, country_rule: false });
  });

  it("a listed country's callers with no usable address get a bucket of their own for that country, never the world's", async () => {
    await setting(db, { enforce: true, countries: ["CN"], countryCap: 0 });
    expect(await call(db, "unknown", "unknown_address", "CN"), "countryCap 0 refuses that country, address or not").toMatchObject({ is_allowed: false, country_rule: true, cap_today: 0 });
    expect(await call(db, "unknown", "unknown_address", "US"), "and nobody else").toMatchObject({ is_allowed: true, country_rule: false, cap_today: 100_000_000 });
    await setting(db, { enforce: true, countries: ["CN"], countryCap: 2 });
    for (let i = 0; i < 5; i++) expect((await call(db, "unknown", "unknown_address", "US")).is_allowed).toBe(true);
    const cn: boolean[] = [];
    for (let i = 0; i < 3; i++) cn.push((await call(db, "unknown", "unknown_address", "CN")).is_allowed);
    expect(cn, "five US no-address calls do not spend the listed country's 2").toEqual([true, true, false]);
    expect((await call(db, "unknown", "unknown_address", "US")).is_allowed, "and the listed country's calls do not wall off the world").toBe(true);
    expect(await meter(db, "unknown"), "the world's 'unknown' row never saw a CN call").toEqual({ within_cap: 7, over_cap: 0 });
    expect(await meter(db, "unknown:CN")).toEqual({ within_cap: 2, over_cap: 2 });
    expect((await hourly(db, "unknown:CN")).map((r) => [r.kind, r.country])).toEqual([["unknown_address", "CN"]]);
  });

  it("a listed country while observing is counted, flagged and served", async () => {
    await setting(db, { enforce: false, countries: ["CN"], countryCap: 0 });
    expect(await call(db, "ip:cnobs", "address", "CN")).toMatchObject({ is_allowed: true, country_rule: true, enforcing: false, cap_today: 0, over_today: 1 });
    expect(await call(db, "unknown", "unknown_address", "CN")).toMatchObject({ is_allowed: true, country_rule: true, enforcing: false });
    expect(await call(db, "ip:usobs", "address", "US")).toMatchObject({ is_allowed: true, country_rule: false });
  });

  it("observe-only counts without refusing, and says so", async () => {
    await setting(db, { enforce: false });
    const got: Verdict[] = [];
    for (let i = 0; i < 5; i++) got.push(await call(db, "ip:obs", "address", "US"));
    expect(got.every((r) => r.is_allowed && !r.enforcing)).toBe(true);
    expect(got.map((r) => r.over_today)).toEqual([0, 0, 0, 1, 2]);
    await setting(db, null);
    expect(await call(db, "ip:obs", "address", "US"), "no row at all means the code default: enforce").toMatchObject({ is_allowed: false, enforcing: true });
  });

  it("rows past eight days are removed on a bucket's first call of the day", async () => {
    await db.exec(`
      INSERT INTO public.job_board_anon_meter VALUES ((now() AT TIME ZONE 'UTC')::date - 9, 'ip:old', 5, 0, false);
      INSERT INTO public.job_board_anon_meter VALUES ((now() AT TIME ZONE 'UTC')::date - 6, 'ip:recent', 5, 0, false);
      INSERT INTO public.job_board_anon_hourly VALUES (now() - interval '9 days', 'ip:old', 'address', 'US', 5, 0, 0);
      INSERT INTO public.job_board_anon_hourly VALUES (now() - interval '6 days', 'ip:recent', 'address', 'US', 5, 0, 0);`);
    await call(db, "ip:first", "probe", "US");
    const left = (await db.query<{ m: number; h: number; mr: number; hr: number }>(`SELECT
      (SELECT count(*)::int FROM public.job_board_anon_meter WHERE bucket = 'ip:old') AS m,
      (SELECT count(*)::int FROM public.job_board_anon_hourly WHERE bucket = 'ip:old') AS h,
      (SELECT count(*)::int FROM public.job_board_anon_meter WHERE bucket = 'ip:recent') AS mr,
      (SELECT count(*)::int FROM public.job_board_anon_hourly WHERE bucket = 'ip:recent') AS hr`)).rows[0];
    expect(left).toEqual({ m: 0, h: 0, mr: 1, hr: 1 });
    const body = sqlCodeOf(MIGRATION.sql);
    const deletes = [...body.matchAll(/DELETE FROM public\.job_board_anon_(?:meter|hourly|net_hourly)\b[\s\S]*?;/g)].map((m) => m[0]);
    expect(deletes, "the meter, the hourly table and the network table").toHaveLength(3);
    for (const d of deletes) expect(d, "bounded, and never waits on a row another call holds").toMatch(/LIMIT \d+ FOR UPDATE SKIP LOCKED/);
  });

  it("the sweep runs on a bucket's FIRST call of the day only, not on every call", async () => {
    await call(db, "ip:busy", "address", "US");
    const seedOld = () => db.exec(`
      INSERT INTO public.job_board_anon_meter VALUES ((now() AT TIME ZONE 'UTC')::date - 9, 'ip:old', 5, 0, false) ON CONFLICT DO NOTHING;
      INSERT INTO public.job_board_anon_hourly VALUES (now() - interval '9 days', 'ip:old', 'address', 'US', 5, 0, 0) ON CONFLICT DO NOTHING;`);
    const old = async () => (await db.query<{ m: number; h: number }>(`SELECT
      (SELECT count(*)::int FROM public.job_board_anon_meter WHERE bucket = 'ip:old') AS m,
      (SELECT count(*)::int FROM public.job_board_anon_hourly WHERE bucket = 'ip:old') AS h`)).rows[0];
    await seedOld();
    await call(db, "ip:busy", "address", "US");
    await call(db, "ip:busy", "address", "US");
    expect(await old(), "a bucket's second and third calls of the day sweep nothing").toEqual({ m: 1, h: 1 });
    await call(db, "ip:fresh", "address", "US");
    expect(await old(), "another bucket's first call does").toEqual({ m: 0, h: 0 });
  });

  it("anon and authenticated reach neither table nor the counter; anon reads the reader, aggregates only", async () => {
    await call(db, "ip:r1", "address", "US");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`SET ROLE ${role}`);
      try {
        for (const q of [
          "SELECT * FROM public.job_board_anon_check('x', 'address', 'US', 1, 1, 1, false)",
          "SELECT * FROM public.job_board_anon_meter",
          "SELECT * FROM public.job_board_anon_hourly",
          "INSERT INTO public.job_board_anon_meter (day_utc, bucket) VALUES (current_date, 'forged')",
        ]) {
          await expect(db.query(q), `${role}: ${q}`).rejects.toThrow(/permission denied/);
        }
        if (role === "anon") {
          const r = await db.query("SELECT * FROM public.get_board_anon_hourly(24)");
          expect(r.fields.map((f) => f.name)).toEqual([
            "bh_hour", "bh_kind", "bh_country", "bh_requests", "bh_over_cap", "bh_addresses",
            "bh_addresses_over_cap", "bh_top_address_requests", "bh_bare_requests",
          ]);
          expect(r.rows.length).toBeGreaterThan(0);
        }
      } finally { await db.exec("RESET ROLE"); }
    }
    await db.exec("SET ROLE service_role");
    try {
      expect((await call(db, "ip:svc", "address", "US")).is_allowed, "the counter runs as its caller; service_role holds the grants it needs").toBe(true);
    } finally { await db.exec("RESET ROLE"); }
  });

  it("the reader's ALL rows equal the sum of its country rows, and name the busiest bucket", async () => {
    for (let i = 0; i < 4; i++) await call(db, "ip:cnA", "address", "CN");
    for (let i = 0; i < 2; i++) await call(db, "ip:cnB", "address", "CN");
    await call(db, "ip:us1", "address", "US", CAPS, true);
    await call(db, "ip:xx1", "address", null);
    await call(db, "probe:p", "probe", "US");
    type Row = { bh_hour: Date; bh_kind: string; bh_country: string; bh_requests: number; bh_over_cap: number; bh_addresses: number; bh_addresses_over_cap: number; bh_top_address_requests: number; bh_bare_requests: number };
    const rows = (await db.query<Row>("SELECT * FROM public.get_board_anon_hourly(2)")).rows.map((r) => ({ ...r, bh_requests: Number(r.bh_requests), bh_over_cap: Number(r.bh_over_cap), bh_addresses: Number(r.bh_addresses), bh_addresses_over_cap: Number(r.bh_addresses_over_cap), bh_top_address_requests: Number(r.bh_top_address_requests), bh_bare_requests: Number(r.bh_bare_requests) }));
    const addr = rows.filter((r) => r.bh_kind === "address");
    const all = addr.filter((r) => r.bh_country === "ALL");
    const parts = addr.filter((r) => r.bh_country !== "ALL");
    expect(all.length, "one ALL row per hour and kind").toBeGreaterThan(0);
    const sum = (k: keyof Row) => parts.reduce((n, r) => n + (r[k] as number), 0);
    const tot = (k: keyof Row) => all.reduce((n, r) => n + (r[k] as number), 0);
    expect(tot("bh_requests")).toBe(sum("bh_requests"));
    expect(tot("bh_requests")).toBe(8);
    expect(tot("bh_over_cap")).toBe(1);
    expect(tot("bh_addresses")).toBe(4);
    expect(tot("bh_addresses_over_cap")).toBe(1);
    expect(tot("bh_bare_requests")).toBe(1);
    expect(Math.max(...all.map((r) => r.bh_top_address_requests))).toBe(4);
    expect(parts.find((r) => r.bh_country === "CN")).toMatchObject({ bh_requests: 6, bh_addresses: 2, bh_over_cap: 1, bh_top_address_requests: 4 });
    expect(rows.some((r) => r.bh_kind === "probe" && r.bh_country === "ALL" && r.bh_requests === 1)).toBe(true);
    expect(JSON.stringify(rows)).not.toMatch(/ip:|probe:p/);
  });
});

// ── the shape ────────────────────────────────────────────────────────────────

/** The counter's plpgsql body, comment-stripped. */
function counterBody(sql: string): string {
  const code = sqlCodeOf(sql);
  const at = code.indexOf("FUNCTION public.job_board_anon_check(");
  const start = code.indexOf("AS $$", at);
  return code.slice(start + 5, code.indexOf("$$;", start + 5));
}

/** Statements at paren depth 0, split on `;` outside quotes. */
function statements(body: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = false, cur = "";
  for (const ch of body) {
    if (ch === "'") quote = !quote;
    if (!quote && ch === "(") depth++;
    if (!quote && ch === ")") depth--;
    if (!quote && depth === 0 && ch === ";") { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function shapeOffences(body: string): string[] {
  const out: string[] = [];
  const hourIns = body.match(/INSERT INTO public\.job_board_anon_hourly\b/g) ?? [];
  if (hourIns.length !== 1) out.push(`expected one INSERT into the hourly table, found ${hourIns.length}`);
  const stmts = statements(body);
  const meterStmts = stmts.filter((s) => /INSERT INTO public\.job_board_anon_meter\b/.test(s));
  const counting = meterStmts.find((s) => /INSERT INTO public\.job_board_anon_hourly\b/.test(s)) ?? "";
  if (!/^WITH\b/i.test(counting)) {
    out.push("the two upserts are not one data-modifying WITH statement");
  }
  const meterInCounting = (counting.match(/INSERT INTO public\.job_board_anon_meter\b/g) ?? []).length;
  if (meterInCounting !== 1) out.push(`expected one INSERT into the meter in the counting statement, found ${meterInCounting}`);
  // .87: the only other meter INSERT is a pass's own day row, and it decides
  // and returns its verdict inside its own conflict update, the same way.
  const others = meterStmts.filter((s) => s !== counting);
  if (others.length > 1) out.push(`expected at most one other INSERT into the meter (a pass's day row), found ${others.length}`);
  for (const o of others) {
    if (!/VALUES\s*\(\s*v_day,\s*'pass:'\s*\|\|/.test(o)) out.push(`a meter INSERT outside the counting statement that is not a pass's day row: ${o.slice(0, 80)}`);
    if (!/ON CONFLICT \(day_utc, bucket\) DO UPDATE SET[\s\S]*?\blast_call_over\s*=/.test(o)) out.push("the pass row's verdict is not assigned inside its conflict update");
    if (!/RETURNING[^;]*\blast_call_over\s+INTO\b/.test(o)) out.push("the pass row's upsert does not return its own verdict");
  }
  if (!/ON CONFLICT \(day_utc, bucket\) DO UPDATE SET[\s\S]*?\blast_call_over\s*=/.test(counting)) out.push("the verdict is not assigned inside the conflict update");
  if (!/RETURNING[^;]*\blast_call_over\b/.test(counting)) out.push("the statement does not return its own verdict");
  for (const s of stmts) {
    if (/^\s*SELECT\b/i.test(s) && /\bINTO\b/i.test(s) && /\bFROM\s+public\.job_board_anon_meter\b/.test(s)) out.push(`a read of the counter into a variable: ${s.slice(0, 80)}`);
    if (/\bUPDATE\s+public\.job_board_anon_meter\b/.test(s)) out.push(`a separate UPDATE of the counter: ${s.slice(0, 80)}`);
  }
  return out;
}

describe("the shape: one statement counts, decides and returns", () => {
  const body = counterBody(MIGRATION.sql);

  it("the live counter has the one-statement shape", () => {
    expect(body.length, "counter body not found").toBeGreaterThan(500);
    expect(shapeOffences(body)).toEqual([]);
  });

  it("teeth: a select-then-update rewrite fails the shape check", () => {
    const stmts = statements(body);
    const counting = stmts.find((s) => /INSERT INTO public\.job_board_anon_meter\b/.test(s) && /INSERT INTO public\.job_board_anon_hourly\b/.test(s))!;
    const racy = body.replace(counting, `SELECT m.within_cap INTO v_within FROM public.job_board_anon_meter m WHERE m.day_utc = v_day AND m.bucket = v_bucket;
  UPDATE public.job_board_anon_meter m SET within_cap = m.within_cap + 1 WHERE m.day_utc = v_day AND m.bucket = v_bucket;
  INSERT INTO public.job_board_anon_hourly AS hh (hour_utc, bucket, kind, country) VALUES (v_hour, v_bucket, v_kind, v_cc)`);
    expect(racy).not.toBe(body);
    const off = shapeOffences(racy);
    expect(off.some((o) => /read of the counter/.test(o))).toBe(true);
    expect(off.some((o) => /separate UPDATE/.test(o))).toBe(true);
  });

  it("teeth: a pass row that reads its count back instead of returning its verdict fails the shape check", () => {
    const passRow = statements(body).find((s) => /'pass:'\s*\|\|/.test(s) && /INSERT INTO public\.job_board_anon_meter\b/.test(s))!;
    expect(passRow, "the pass row is in the counter").toBeTruthy();
    const racy = body.replace(passRow, passRow.replace(/RETURNING pm\.last_call_over INTO v_pass_spent/, "RETURNING pm.within_cap INTO v_within"));
    expect(racy).not.toBe(body);
    expect(shapeOffences(racy)).toContain("the pass row's upsert does not return its own verdict");
    const second = body.replace(passRow, `${passRow};\n    INSERT INTO public.job_board_anon_meter AS q (day_utc, bucket) VALUES (v_day, v_bucket || ':x') ON CONFLICT DO NOTHING`);
    expect(shapeOffences(second).some((o) => /at most one other INSERT/.test(o))).toBe(true);
  });

  it("teeth: an off-by-one cap test lets a fourth call through a cap of 3", async () => {
    const loose = MIGRATION.sql.split("m.within_cap < v_cap").join("m.within_cap <= v_cap");
    expect(loose).not.toBe(MIGRATION.sql);
    const db = await boot(chainWith(loose));
    try {
      await setting(db, { enforce: true });
      const got: boolean[] = [];
      for (let i = 0; i < 5; i++) got.push((await call(db, "ip:aaa", "address", "US")).is_allowed);
      expect(got, "the mutant must break the cap the executed test pins").not.toEqual([true, true, true, false, false]);
      expect(got.filter(Boolean).length).toBe(4);
    } finally { await db.close(); }
  });
});

// ── .87: the network and the pass, executed ─────────────────────────────────
//
// 20261003180000. A pool rotating its addresses (~180-340 an hour, none over
// 80 calls) is invisible to a per-address cap; the owner blocks where it lives
// (blockedNetworks) or asks browsers for a Turnstile pass (requirePass). Held
// here: both refuse only while enforcing; an entry or a p_net that is not an
// address is ignored, never an error (an error fails the gate open and turns
// the whole meter off); 'unconfigured' and an older job-board's NULL are never
// refused; kinds address, unknown_address and unproven_* are asked for a pass
// (a declaration is not the reader proof); passless build and probe share ONE
// row per kind at the code cap, so a public header cannot be multiplied by a
// pool's addresses; a pass is metered by its id and is 'spent' past passCap;
// a listed network or a zero-cap country refuses whatever the pass, and then
// says so instead of pass_rule; every call lands in the network table; the
// reader clamps and publishes aggregates only; the migration's own check has
// teeth, in the catalogue and in behaviour.

type Verdict9 = Verdict & { network_rule: boolean; pass_rule: boolean };
const call9 = async (db: PGlite, bucket: string, kind: string, cc: string | null, net: string | null, pass: string | null, caps = CAPS): Promise<Verdict9> =>
  (await db.query<Verdict9>("SELECT * FROM public.job_board_anon_check($1, $2, $3, $4, $5, $6, $7, $8, $9)", [bucket, kind, cc, ...caps, false, net, pass])).rows[0];
/** The call job-board .87 makes: the pass id beside a valid pass. */
const call10 = async (db: PGlite, bucket: string, kind: string, net: string | null, pass: string | null, passId: string | null, caps = CAPS): Promise<Verdict9> =>
  (await db.query<Verdict9>("SELECT * FROM public.job_board_anon_check($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)", [bucket, kind, "US", ...caps, false, net, pass, passId])).rows[0];
type NetRow = { net: string; kind: string; pass: string; within_cap: number; over_cap: number };
const netRows = async (db: PGlite) =>
  (await db.query<NetRow>("SELECT net, kind, pass, within_cap, over_cap FROM public.job_board_anon_net_hourly ORDER BY net, kind, pass")).rows;

describe(".87: the network and the pass, executed", () => {
  let db: PGlite;
  beforeAll(async () => { db = await boot(CHAIN); });
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("DELETE FROM public.job_board_anon_meter WHERE true; DELETE FROM public.job_board_anon_hourly WHERE true; DELETE FROM public.job_board_anon_net_hourly WHERE true;");
    await setting(db, { enforce: true });
  });

  it("a network inside a listed one is refused whatever its kind; entries that are not a /24-or-wider address are ignored", async () => {
    await setting(db, {
      enforce: true,
      blockedNetworks: ["43.128.0.0/10", "nonsense", 7, null, "1.2.3.4", "10.9.8.0/25", "2001:db8::/32", " 47.74.0.0/16 ", "203.0.113.77/16"],
    });
    expect(await call9(db, "ip:a", "address", "SG", "43.130.5.0/24", "valid")).toMatchObject({ is_allowed: false, network_rule: true, pass_rule: false, cap_today: 0 });
    expect(await call9(db, "ip:b", "build", "SG", "43.131.0.0/24", "none"), "a public header buys nothing past a listed network").toMatchObject({ is_allowed: false, network_rule: true });
    expect(await call9(db, "ip:c", "probe", "XX", "47.74.200.0/24", "none"), "whitespace around an entry is not a typo").toMatchObject({ is_allowed: false, network_rule: true });
    expect(await call9(db, "ip:d", "address", "XX", "203.0.5.0/24", "none"), "host bits in an entry are read as its network").toMatchObject({ is_allowed: false, network_rule: true });
    expect(await call9(db, "ip:e", "address", "US", "8.8.8.0/24", "none")).toMatchObject({ is_allowed: true, network_rule: false, cap_today: 3 });
    expect(await call9(db, "ip:f", "address", "US", "1.2.3.0/24", "none"), "a /32 entry is narrower than a network and is ignored").toMatchObject({ is_allowed: true, network_rule: false });
    expect(await call9(db, "ip:g", "address", "US", "10.9.8.0/24", "none"), "so is a /25").toMatchObject({ is_allowed: true, network_rule: false });
    expect(await call9(db, "ip:h", "address", "XX", "2001:db8:5::/48", "none")).toMatchObject({ is_allowed: false, network_rule: true });
    expect(await call9(db, "ip:i", "address", "XX", "2001:db9:5::/48", "none")).toMatchObject({ is_allowed: true, network_rule: false });
    await setting(db, { enforce: true, blockedNetworks: "43.128.0.0/10" });
    expect(await call9(db, "ip:j", "address", "SG", "43.130.5.0/24", "none"), "a non-array list is ignored, not half-applied").toMatchObject({ is_allowed: true, network_rule: false });
    await db.exec("UPDATE public.job_board_meta SET v = v - 'blockedNetworks' WHERE k = 'anon_board_budget'");
    expect(await call9(db, "ip:k", "address", "SG", "43.130.5.0/24", "none"), "the UNBLOCK statement").toMatchObject({ is_allowed: true, network_rule: false });
  });

  it("a p_net that is not exactly a /24 or a /48 is no network: never an error, never blocked, telemetry 'none'", async () => {
    await setting(db, { enforce: true, blockedNetworks: ["0.0.0.0/0", "::/0"] });
    for (const junk of ["garbage", "1.2.3.4/24", "1.2.3.0/25", "1.2.0.0/16", "2001:db8:1::/64", "", "256.1.1.0/24"]) {
      expect(await call9(db, `ip:${junk}`, "address", "US", junk, "none"), JSON.stringify(junk)).toMatchObject({ is_allowed: true, network_rule: false });
    }
    expect(await call9(db, "ip:real", "address", "US", "9.9.9.0/24", "none"), "the positive control: a real /24 under 0.0.0.0/0").toMatchObject({ is_allowed: false, network_rule: true });
    expect((await netRows(db)).filter((r) => r.net === "none").reduce((n, r) => n + r.within_cap, 0)).toBe(7);
  });

  it("requirePass refuses a browser without a valid pass, and nothing else", async () => {
    await setting(db, { enforce: true, requirePass: true });
    expect(await call9(db, "ip:v", "address", "US", "8.8.8.0/24", "valid")).toMatchObject({ is_allowed: true, pass_rule: false, cap_today: 3 });
    expect(await call9(db, "ip:n", "address", "US", "8.8.8.0/24", "none")).toMatchObject({ is_allowed: false, pass_rule: true, network_rule: false, cap_today: 0 });
    expect(await call9(db, "ip:i", "address", "US", "8.8.8.0/24", "invalid")).toMatchObject({ is_allowed: false, pass_rule: true });
    expect(await call9(db, "unknown", "unknown_address", "XX", null, "none"), "a browser with no usable address is asked too").toMatchObject({ is_allowed: false, pass_rule: true });
    expect(await call9(db, "ip:u", "address", "US", "8.8.8.0/24", "unconfigured"), "a missing secret never takes the board down").toMatchObject({ is_allowed: true, pass_rule: false });
    expect(await call9(db, "ip:j", "address", "US", "8.8.8.0/24", "VALID"), "any other text is unconfigured").toMatchObject({ is_allowed: true, pass_rule: false });
    expect(await call(db, "ip:old", "address", "US"), "an older job-board's seven arguments: NULL is unconfigured").toMatchObject({ is_allowed: true });
    for (const kind of ["unproven_api", "unproven_mcp", "unproven_digest"]) {
      expect(await call9(db, `ip:${kind}`, kind, "US", "8.8.8.0/24", "none"), `${kind}: a declaration without the reader proof is asked`).toMatchObject({ is_allowed: false, pass_rule: true });
      expect(await call9(db, `ip:${kind}:v`, kind, "US", "8.8.8.0/24", "valid")).toMatchObject({ is_allowed: true, pass_rule: false });
      expect(await call9(db, `ip:${kind}:u`, kind, "US", "8.8.8.0/24", "unconfigured")).toMatchObject({ is_allowed: true, pass_rule: false });
    }
    for (const kind of ["build", "probe"]) {
      expect(await call9(db, `ip:${kind}`, kind, "US", "8.8.8.0/24", "none"), `${kind} cannot solve a browser check, so it is not refused for one`).toMatchObject({ is_allowed: true, pass_rule: false });
    }
    await setting(db, { enforce: true, requirePass: "true" });
    expect(await call9(db, "ip:s", "address", "US", "8.8.8.0/24", "none"), "a string is not the switch").toMatchObject({ is_allowed: true, pass_rule: false });
    await db.exec("UPDATE public.job_board_meta SET v = v - 'requirePass' WHERE k = 'anon_board_budget'");
    expect(await call9(db, "ip:s2", "address", "US", "8.8.8.0/24", "none"), "the UNREQUIRE statement").toMatchObject({ is_allowed: true, pass_rule: false });
  });

  it("a listed network or a zero-cap country refuses whatever the pass and says so; a country with a cap leaves the pass to decide", async () => {
    await setting(db, { enforce: true, requirePass: true, blockedNetworks: ["43.128.0.0/10"] });
    expect(await call9(db, "ip:n1", "address", "SG", "43.130.1.0/24", "none")).toMatchObject({ is_allowed: false, network_rule: true, pass_rule: false });
    await setting(db, { enforce: true, requirePass: true, countries: ["CN"], countryCap: 0 });
    expect(await call9(db, "ip:c1", "address", "CN", "1.80.0.0/24", "none"), "a fresh pass cannot lift a zero-cap country").toMatchObject({ is_allowed: false, country_rule: true, pass_rule: false });
    await setting(db, { enforce: true, requirePass: true, countries: ["CN"], countryCap: 5 });
    expect(await call9(db, "ip:c2", "address", "CN", "1.80.0.0/24", "none"), "here a pass would admit it").toMatchObject({ is_allowed: false, country_rule: true, pass_rule: true, cap_today: 0 });
    expect(await call9(db, "ip:c2", "address", "CN", "1.80.0.0/24", "valid")).toMatchObject({ is_allowed: true, country_rule: true, pass_rule: false, cap_today: 5 });
  });

  it("enforce false refuses nothing new, and still names the rule that would have", async () => {
    await setting(db, { enforce: false, requirePass: true, blockedNetworks: ["43.128.0.0/10"] });
    expect(await call9(db, "ip:o1", "address", "SG", "43.130.1.0/24", "valid")).toMatchObject({ is_allowed: true, network_rule: true, enforcing: false, over_today: 1 });
    expect(await call9(db, "ip:o2", "address", "US", "8.8.8.0/24", "none")).toMatchObject({ is_allowed: true, pass_rule: true, enforcing: false, over_today: 1 });
    expect(await call9(db, "ip:o3", "address", "US", "8.8.8.0/24", "valid")).toMatchObject({ is_allowed: true, network_rule: false, pass_rule: false, over_today: 0 });
  });

  it("under requirePass, passless build and probe share ONE row per kind at the code cap, whatever the override says", async () => {
    await setting(db, { enforce: true, requirePass: true, buildCap: 100000000, probeCap: 100000000 });
    // CAPS = address 3, build 10, probe 5: the shared rows are judged at 10 and 5, not at 100,000,000.
    const builds: Verdict9[] = [];
    for (let i = 0; i < 12; i++) builds.push(await call9(db, `ip:pool${i}`, "build", "US", `198.51.${i}.0/24`, "none"));
    expect(builds.map((r) => r.is_allowed), "twelve addresses claiming build: ten served in total, not ten each").toEqual([...Array(10).fill(true), false, false]);
    expect(builds.every((r) => r.cap_today === 10 && !r.pass_rule && !r.network_rule)).toBe(true);
    expect(await meter(db, "tool:build")).toEqual({ within_cap: 10, over_cap: 2 });
    expect(await meter(db, "ip:pool0"), "no per-address row for the pool to multiply").toBeUndefined();
    expect((await hourly(db, "tool:build")).map((r) => r.kind)).toEqual(["build"]);
    expect(await call9(db, "ip:probe1", "probe", "US", "8.8.8.0/24", "invalid")).toMatchObject({ is_allowed: true, cap_today: 5 });
    expect(await meter(db, "tool:probe")).toEqual({ within_cap: 1, over_cap: 0 });
    await setting(db, { enforce: true, requirePass: true, buildCap: 2 });
    expect(await call9(db, "ip:pool99", "build", "US", "198.51.99.0/24", "none"), "a lower override still lowers it").toMatchObject({ is_allowed: false, cap_today: 2 });
    expect(await call9(db, "ip:own", "build", "US", "8.8.8.0/24", "unconfigured"), "no secret: its own row, as before").toMatchObject({ is_allowed: true, cap_today: 2, used_today: 1 });
    expect(await call9(db, "ip:own2", "build", "US", "8.8.8.0/24", "valid"), "a valid pass: its own row").toMatchObject({ is_allowed: true, used_today: 1 });
    await setting(db, { enforce: true, requirePass: false });
    expect(await call9(db, "ip:own3", "build", "US", "8.8.8.0/24", "none"), "requirePass off: its own row, as before").toMatchObject({ is_allowed: true, used_today: 1, cap_today: 10 });
    await setting(db, { enforce: true, requirePass: true, countries: ["CN"], countryCap: 0 });
    expect(await call9(db, "ip:cnb", "build", "CN", "1.80.0.0/24", "none"), "the country rule still outranks it").toMatchObject({ is_allowed: false, country_rule: true });
    expect(await meter(db, "ip:cnb")).toEqual({ within_cap: 0, over_cap: 1 });
  });

  it("a pass is metered by its id: past passCap it is 'spent', shown by name, and refused only under requirePass", async () => {
    const A = "0123456789abcdef";
    const B = "fedcba9876543210";
    await setting(db, { enforce: true, passCap: 2 });
    const observed: Verdict9[] = [];
    for (let i = 0; i < 4; i++) observed.push(await call10(db, `ip:rot${i}`, "address", `203.0.${i}.0/24`, "valid", A));
    expect(observed.every((r) => r.is_allowed && !r.pass_rule), "observing: every call served").toBe(true);
    expect(await meter(db, `pass:${A}`), "one pass, four addresses, one row").toEqual({ within_cap: 2, over_cap: 2 });
    expect((await netRows(db)).map((r) => [r.pass, r.within_cap + r.over_cap]), "the telemetry names the spent calls").toEqual([["spent", 2], ["valid", 2]]);
    await setting(db, { enforce: true, passCap: 2, requirePass: true });
    expect(await call10(db, "ip:rot9", "address", "203.0.9.0/24", "valid", A), "under requirePass a spent pass is no pass").toMatchObject({ is_allowed: false, pass_rule: true, cap_today: 0 });
    expect(await call10(db, "ip:rot9", "address", "203.0.9.0/24", "valid", B), "a fresh pass reads at once").toMatchObject({ is_allowed: true, pass_rule: false });
    expect(await call10(db, "ip:rotb", "build", "203.0.9.0/24", "valid", A), "a spent pass does not buy a tool its own row either").toMatchObject({ is_allowed: true, cap_today: 10 });
    expect(await meter(db, "tool:build")).toEqual({ within_cap: 1, over_cap: 0 });
    for (const junk of ["0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0", "xyz", ""]) {
      expect(await call10(db, `ip:junk${junk}`, "address", "8.8.8.0/24", "valid", junk), JSON.stringify(junk)).toMatchObject({ is_allowed: true });
      expect(await meter(db, `pass:${junk}`), `${JSON.stringify(junk)} is no id`).toBeUndefined();
    }
    await call10(db, "ip:inv", "address", "8.8.8.0/24", "invalid", "aaaaaaaaaaaaaaaa");
    expect(await meter(db, "pass:aaaaaaaaaaaaaaaa"), "an id beside a pass that is not valid is not metered").toBeUndefined();
  });

  it("the default passCap is 600 counted reads per pass per UTC day", async () => {
    await setting(db, { enforce: true, requirePass: true });
    await db.exec("INSERT INTO public.job_board_anon_meter VALUES ((now() AT TIME ZONE 'UTC')::date, 'pass:1111111111111111', 599, 0, false)");
    expect(await call10(db, "ip:d1", "address", "8.8.8.0/24", "valid", "1111111111111111"), "the 600th").toMatchObject({ is_allowed: true });
    expect(await call10(db, "ip:d2", "address", "8.8.8.0/24", "valid", "1111111111111111"), "the 601st").toMatchObject({ is_allowed: false, pass_rule: true });
    await setting(db, { enforce: true, requirePass: true, passCap: 1e20 });
    expect(await call10(db, "ip:d3", "address", "8.8.8.0/24", "valid", "1111111111111111"), "an absurd override is clamped, never an error").toMatchObject({ is_allowed: true });
  });

  it("with today's production row (CN at 0, the caps out of reach) nothing the .87 job-board sends is refused unless it reads CN", async () => {
    await setting(db, { enforce: true, countries: ["CN"], countryCap: 0, addressCap: 100000000, buildCap: 100000000, probeCap: 100000000 });
    for (const [net, pass] of [["8.8.8.0/24", "none"], ["43.130.1.0/24", "invalid"], ["2001:db8:1::/48", "valid"], [null, "unconfigured"]] as const) {
      expect(await call9(db, `ip:${net}`, "address", "XX", net, pass), `${net} ${pass}`).toMatchObject({ is_allowed: true, network_rule: false, pass_rule: false });
    }
    expect(await call9(db, "ip:cn", "address", "CN", "1.80.0.0/24", "valid"), "the China block still refuses").toMatchObject({ is_allowed: false, country_rule: true });
    for (const kind of ["build", "probe", "unproven_api"]) {
      expect(await call10(db, `ip:prod-${kind}`, kind, "8.8.8.0/24", "none", null), kind).toMatchObject({ is_allowed: true, pass_rule: false });
    }
    expect(await meter(db, "tool:build"), "no requirePass: nobody shares a tooling row").toBeUndefined();
    for (let i = 0; i < 3; i++) expect((await call10(db, `ip:prod-p${i}`, "address", "8.8.8.0/24", "valid", "2222222222222222")).is_allowed).toBe(true);
  });

  it("every call lands in the network table by /16 (IPv4) or /32 (IPv6), kind and pass state; 'none' without a network", async () => {
    await call9(db, "ip:t1", "address", "US", "43.130.5.0/24", "valid");
    await call9(db, "ip:t2", "address", "US", "43.130.200.0/24", "valid");
    await call9(db, "ip:t3", "address", "US", "43.130.9.0/24", "none");
    await call9(db, "ip:t4", "build", "US", "2001:db8:abcd::/48", "none");
    await call9(db, "unknown", "unknown_address", "XX", null, "unconfigured");
    await setting(db, { enforce: true, addressCap: 0 });
    await call9(db, "ip:t5", "address", "US", "43.130.5.0/24", "valid");
    expect(await netRows(db)).toEqual([
      { net: "2001:db8::/32", kind: "build", pass: "none", within_cap: 1, over_cap: 0 },
      { net: "43.130.0.0/16", kind: "address", pass: "none", within_cap: 1, over_cap: 0 },
      { net: "43.130.0.0/16", kind: "address", pass: "valid", within_cap: 2, over_cap: 1 },
      { net: "none", kind: "unknown_address", pass: "unconfigured", within_cap: 1, over_cap: 0 },
    ]);
    expect(await meter(db, "ip:t1"), "the day row is counted as before").toEqual({ within_cap: 1, over_cap: 0 });
    expect((await hourly(db, "ip:t4")).map((r) => r.kind)).toEqual(["build"]);
  });

  it("network rows past eight days are removed on a bucket's first call of the day, bounded", async () => {
    await db.exec(`
      INSERT INTO public.job_board_anon_net_hourly VALUES (now() - interval '9 days', '43.130.0.0/16', 'address', 'none', 5, 0);
      INSERT INTO public.job_board_anon_net_hourly VALUES (now() - interval '6 days', '43.131.0.0/16', 'address', 'none', 5, 0);`);
    await call9(db, "ip:sweep", "address", "US", "8.8.8.0/24", "none");
    expect((await netRows(db)).map((r) => r.net)).toEqual(["43.131.0.0/16", "8.8.0.0/16"]);
  });

  it("the network reader: aggregates only, the busiest rows first, hours and limit clamped, open to anon", async () => {
    await db.exec(`
      INSERT INTO public.job_board_anon_net_hourly
      SELECT date_trunc('hour', now()), '10.' || g || '.0.0/16', 'address', 'none', g, 0 FROM generate_series(1, 205) g;
      INSERT INTO public.job_board_anon_net_hourly VALUES (date_trunc('hour', now()) - interval '5 hours', '99.99.0.0/16', 'address', 'valid', 9999, 7);
      INSERT INTO public.job_board_anon_net_hourly VALUES (date_trunc('hour', now()) - interval '200 hours', '98.98.0.0/16', 'address', 'valid', 99999, 0);`);
    type Bn = { bn_hour: Date; bn_net: string; bn_kind: string; bn_pass: string; bn_requests: number; bn_over_cap: number };
    const read = async (h: number | null, l: number | null) => (await db.query<Bn>("SELECT * FROM public.get_board_anon_networks($1, $2)", [h, l])).rows;
    const r = await db.query<Bn>("SELECT * FROM public.get_board_anon_networks()");
    expect(r.fields.map((f) => f.name)).toEqual(["bn_hour", "bn_net", "bn_kind", "bn_pass", "bn_requests", "bn_over_cap"]);
    expect(r.rows.length, "the default limit").toBe(40);
    expect(r.rows[0].bn_net, "the default window is 3 hours: the 5-hour-old row is out").toBe("10.205.0.0/16");
    expect(r.rows.map((x) => Number(x.bn_requests))).toEqual([...r.rows.map((x) => Number(x.bn_requests))].sort((a, b) => b - a));
    expect((await read(6, 1))[0]).toMatchObject({ bn_net: "99.99.0.0/16", bn_pass: "valid" });
    expect(Number((await read(6, 1))[0].bn_over_cap)).toBe(7);
    expect((await read(0, 1))[0].bn_net, "hours clamp up to 1").toBe("10.205.0.0/16");
    expect((await read(100000, 1))[0].bn_net, "hours clamp down to 168, so a row 200 hours old is out").toBe("99.99.0.0/16");
    expect(await read(3, 0), "limit clamps up to 1").toHaveLength(1);
    expect(await read(3, 100000), "limit clamps down to 200").toHaveLength(200);
    expect((await read(null, null)).length, "nulls take the defaults").toBe(40);
    await db.exec("SET ROLE anon");
    try {
      expect((await db.query("SELECT * FROM public.get_board_anon_networks(3, 5)")).rows).toHaveLength(5);
      await expect(db.query("SELECT * FROM public.job_board_anon_net_hourly")).rejects.toThrow(/permission denied/);
      await expect(db.query("INSERT INTO public.job_board_anon_net_hourly (hour_utc, net, kind, pass) VALUES (now(), 'x', 'address', 'valid')")).rejects.toThrow(/permission denied/);
      await expect(db.query("SELECT * FROM public.job_board_anon_check('x', 'address', 'US', 1, 1, 1, false, '8.8.8.0/24', 'valid')")).rejects.toThrow(/permission denied/);
    } finally { await db.exec("RESET ROLE"); }
  });

  it("the migration's own check has teeth: a client grant or a surviving seven-argument counter makes it raise", async () => {
    const code = sqlCodeOf(MIGRATION.sql);
    const check = code.slice(code.lastIndexOf("DO $$"));
    expect(check).toMatch(/RAISE EXCEPTION/);
    await db.exec(check); // passes on the state the migration left
    const ten = "public.job_board_anon_check(text, text, text, integer, integer, integer, boolean, text, text, text)";
    await db.exec(`GRANT EXECUTE ON FUNCTION ${ten} TO anon`);
    await expect(db.exec(check)).rejects.toThrow(/executable by anon/);
    await db.exec(`REVOKE EXECUTE ON FUNCTION ${ten} FROM anon`);
    for (const [role, priv] of [["authenticated", "SELECT"], ["authenticated", "UPDATE"], ["anon", "DELETE"], ["anon", "INSERT"], ["authenticated", "TRUNCATE"]]) {
      await db.exec(`GRANT ${priv} ON public.job_board_anon_net_hourly TO ${role}`);
      await expect(db.exec(check), `${role} ${priv}`).rejects.toThrow(/readable or writable by a client role/);
      await db.exec(`REVOKE ${priv} ON public.job_board_anon_net_hourly FROM ${role}`);
    }
    await db.exec("CREATE FUNCTION public.job_board_anon_check(text, text, text, integer, integer, integer, boolean) RETURNS integer LANGUAGE sql AS 'SELECT 1'");
    await expect(db.exec(check)).rejects.toThrow(/want exactly one/);
    await db.exec("DROP FUNCTION public.job_board_anon_check(text, text, text, integer, integer, integer, boolean)");
    await db.exec(check);
  });

  it("the check's behaviour half rolls itself back: the owner's row and every table are exactly as they were", async () => {
    const code = sqlCodeOf(MIGRATION.sql);
    const check = code.slice(code.lastIndexOf("DO $$"));
    const prod = { enforce: true, countries: ["CN"], countryCap: 0, addressCap: 100000000, buildCap: 100000000, probeCap: 100000000 };
    await setting(db, prod);
    await call9(db, "ip:before", "address", "US", "8.8.8.0/24", "none");
    const snap = async () => (await db.query<{ t: string }>(`SELECT
      coalesce((SELECT jsonb_agg(m ORDER BY m.bucket) FROM public.job_board_anon_meter m)::text, '-')
      || coalesce((SELECT jsonb_agg(h ORDER BY h.bucket, h.kind) FROM public.job_board_anon_hourly h)::text, '-')
      || coalesce((SELECT jsonb_agg(n ORDER BY n.net, n.kind, n.pass) FROM public.job_board_anon_net_hourly n)::text, '-')
      || coalesce((SELECT v::text FROM public.job_board_meta WHERE k = 'anon_board_budget'), '-') AS t`)).rows[0].t;
    const before = await snap();
    expect(before).toMatch(/ip:before/);
    await db.exec(check);
    expect(await snap()).toBe(before);
    await setting(db, null);
    await db.exec(check);
    expect((await db.query("SELECT 1 FROM public.job_board_meta WHERE k = 'anon_board_budget'")).rows, "a database with no row is left with none").toHaveLength(0);
  });

  it("teeth in behaviour: the counter without its defaults, or with a body that applies no rule, fails the migration", async () => {
    // .86 calls with seven NAMED arguments; without the four defaults it gets
    // PGRST202 and its gate fails open, switching the China block off.
    const head = MIGRATION.sql.indexOf("CREATE OR REPLACE FUNCTION public.job_board_anon_check(");
    const params = MIGRATION.sql.slice(head, MIGRATION.sql.indexOf("RETURNS TABLE", head));
    const bare = params.replace(/ DEFAULT (?:false|NULL)/g, "");
    expect(bare).not.toBe(params);
    expect((params.match(/ DEFAULT /g) ?? []).length).toBe(4);
    const noDefaults = MIGRATION.sql.replace(params, bare);
    await expect(boot(chainWith(noDefaults)), "a counter without its defaults").rejects.toThrow(/want the last four arguments defaulted/);

    const fresh = await boot(CHAIN);
    try {
      const code = sqlCodeOf(MIGRATION.sql);
      const check = code.slice(code.lastIndexOf("DO $$"));
      // The same signature and return shape, a body that refuses nothing: the
      // catalogue half cannot tell; the behaviour half must.
      await fresh.exec(`${params}
        RETURNS TABLE (is_allowed boolean, used_today integer, over_today integer, cap_today integer, country_rule boolean, enforcing boolean, network_rule boolean, pass_rule boolean)
        LANGUAGE sql AS $f$ SELECT true, 1, 0, 10000, false, true, false, false $f$`);
      await expect(fresh.exec(check)).rejects.toThrow(/does not behave as this file intends: a caller inside a blockedNetworks entry was not refused/);
      await fresh.exec(MIGRATION.sql); // the real file again: idempotent, and it passes its own check
      await fresh.exec(check);
    } finally { await fresh.close(); }
  });
});

// ── .87: the owner's levers, run VERBATIM from the deploy note ──────────────
//
// The deploy note tells the owner to hand these statements to Lovable's agent
// word for word, so a statement that does not parse, or drops the rest of the
// setting row, ships as an instruction. Each one is lifted out of the note and
// executed here against the real counter.

const NOTES = readFileSync(resolve(__dirname, "../../docs/job-board-deploy-notes.md"), "utf8");
const NOTE87 = NOTES.slice(NOTES.indexOf("## 2026-09-09.87"), NOTES.indexOf("\n## ", NOTES.indexOf("## 2026-09-09.87") + 5));
const lever = (name: string): string => {
  const m = new RegExp(`^- ${name}\\b[^\`\\n]*\`([^\`]+)\``, "m").exec(NOTE87);
  if (!m) throw new Error(`the .87 note has no lever "${name}"`);
  return m[1];
};

describe(".87: the owner's levers, run verbatim from the deploy note", () => {
  let db: PGlite;
  beforeAll(async () => { db = await boot(CHAIN); });
  afterAll(async () => { await db?.close(); });
  const row = async () => (await db.query<{ v: Record<string, unknown> }>("SELECT v FROM public.job_board_meta WHERE k = 'anon_board_budget'")).rows[0]?.v;

  it("the note carries every lever, and READ THE NETWORKS names the reader's own arguments", async () => {
    expect(NOTE87.length).toBeGreaterThan(2000);
    for (const n of ["READ THE NETWORKS", "BLOCK NETWORKS", "UNBLOCK ONE NETWORK", "UNBLOCK NETWORKS", "SET THE PASS CAP", "REQUIRE THE PASS", "UNREQUIRE"]) expect(lever(n).length, n).toBeGreaterThan(20);
    const read = lever("READ THE NETWORKS");
    expect(read).toMatch(/rest\/v1\/rpc\/get_board_anon_networks/);
    const args = JSON.parse(/-d '([^']+)'/.exec(read)![1]) as Record<string, number>;
    const names = (await db.query<{ n: string[] }>("SELECT proargnames AS n FROM pg_proc WHERE proname = 'get_board_anon_networks'")).rows[0].n;
    for (const k of Object.keys(args)) expect(names, k).toContain(k);
  });

  it("block, block again, unblock one, unblock all, require, unrequire: each does what the note says and keeps the rest of the row", async () => {
    const prod = { enforce: true, countries: ["CN"], countryCap: 0, addressCap: 100000000, buildCap: 100000000, probeCap: 100000000 };
    await setting(db, prod);
    await db.exec(lever("BLOCK NETWORKS"));
    expect((await row())?.blockedNetworks).toEqual(["198.51.100.0/24", "203.0.113.0/24"]);
    expect(await call9(db, "ip:l1", "address", "XX", "203.0.113.0/24", "none")).toMatchObject({ is_allowed: false, network_rule: true });
    await db.exec(lever("BLOCK NETWORKS"));
    expect((await row())?.blockedNetworks, "adding again lists each network once").toEqual(["198.51.100.0/24", "203.0.113.0/24"]);
    await db.exec(lever("UNBLOCK ONE NETWORK"));
    expect((await row())?.blockedNetworks).toEqual(["198.51.100.0/24"]);
    expect(await call9(db, "ip:l2", "address", "XX", "203.0.113.0/24", "none")).toMatchObject({ is_allowed: true, network_rule: false });
    expect(await call9(db, "ip:l3", "address", "XX", "198.51.100.0/24", "none")).toMatchObject({ is_allowed: false, network_rule: true });
    await db.exec(lever("UNBLOCK NETWORKS"));
    expect(await row()).toEqual(prod);
    await db.exec(lever("REQUIRE THE PASS"));
    expect((await row())?.requirePass).toBe(true);
    expect(await call9(db, "ip:l4", "address", "XX", "8.8.8.0/24", "none")).toMatchObject({ is_allowed: false, pass_rule: true });
    expect(await call9(db, "ip:l5", "address", "XX", "8.8.8.0/24", "unconfigured")).toMatchObject({ is_allowed: true });
    await db.exec(lever("UNREQUIRE"));
    expect(await row(), "every lever leaves the owner's row exactly as it found it").toEqual(prod);
    expect(await call9(db, "ip:l6", "address", "XX", "8.8.8.0/24", "none")).toMatchObject({ is_allowed: true });
  });

  it("set the pass cap, and back to the default: the cap moves and the rest of the row stays", async () => {
    const prod = { enforce: true, countries: ["CN"], countryCap: 0, addressCap: 100000000, buildCap: 100000000, probeCap: 100000000 };
    await setting(db, prod);
    await db.exec(lever("SET THE PASS CAP"));
    expect(await row()).toEqual({ ...prod, passCap: 300 });
    const line = NOTE87.split("\n").find((l) => l.startsWith("- SET THE PASS CAP"))!;
    const statements = [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((x) => /^(?:INSERT|UPDATE)\b/.test(x));
    expect(statements, "the lever and its way back").toHaveLength(2);
    await db.exec(statements[1]);
    expect(await row(), "back to the default leaves the owner's row exactly as it found it").toEqual(prod);
  });
});
