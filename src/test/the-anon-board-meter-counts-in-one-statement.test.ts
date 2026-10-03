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
 * decides who reaches it.
 *
 * WHAT THIS HOLDS, executed against the LAST migration that defines the
 * counter (what the database runs), in pglite under Supabase's default
 * privileges:
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
 *     that statement, and no read-then-write of the counter anywhere.
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

describe("the anonymous board meter, executed", () => {
  let db: PGlite;
  beforeAll(async () => { db = await boot(MIGRATION.sql); });
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("DELETE FROM public.job_board_anon_meter WHERE true; DELETE FROM public.job_board_anon_hourly WHERE true;");
    await setting(db, { enforce: true });
  });

  it("the reader and the counter are defined in the same, newest, migration", () => {
    expect(lastDefining("get_board_anon_hourly").file).toBe(MIGRATION.file);
  });

  it("the migration seeds observe-only, and never overwrites a setting row that exists", async () => {
    const fresh = await boot(MIGRATION.sql);
    try {
      const seeded = (await fresh.query<{ v: Record<string, unknown> }>("SELECT v FROM public.job_board_meta WHERE k = 'anon_board_budget'")).rows[0];
      expect(seeded?.v, "ships counting, not refusing").toEqual({ enforce: false });
      await fresh.exec(`UPDATE public.job_board_meta SET v = '{"enforce": true, "addressCap": 7}'::jsonb WHERE k = 'anon_board_budget'`);
      await fresh.exec(MIGRATION.sql); // idempotent, and the owner's row survives a re-run
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
    const deletes = [...body.matchAll(/DELETE FROM public\.job_board_anon_(?:meter|hourly)\b[\s\S]*?;/g)].map((m) => m[0]);
    expect(deletes).toHaveLength(2);
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
  const meterIns = body.match(/INSERT INTO public\.job_board_anon_meter\b/g) ?? [];
  const hourIns = body.match(/INSERT INTO public\.job_board_anon_hourly\b/g) ?? [];
  if (meterIns.length !== 1) out.push(`expected one INSERT into the meter, found ${meterIns.length}`);
  if (hourIns.length !== 1) out.push(`expected one INSERT into the hourly table, found ${hourIns.length}`);
  const stmts = statements(body);
  const counting = stmts.find((s) => /INSERT INTO public\.job_board_anon_meter\b/.test(s)) ?? "";
  if (!/^WITH\b/i.test(counting) || !/INSERT INTO public\.job_board_anon_hourly\b/.test(counting)) {
    out.push("the two upserts are not one data-modifying WITH statement");
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
    const counting = stmts.find((s) => /INSERT INTO public\.job_board_anon_meter\b/.test(s))!;
    const racy = body.replace(counting, `SELECT m.within_cap INTO v_within FROM public.job_board_anon_meter m WHERE m.day_utc = v_day AND m.bucket = v_bucket;
  UPDATE public.job_board_anon_meter m SET within_cap = m.within_cap + 1 WHERE m.day_utc = v_day AND m.bucket = v_bucket;
  INSERT INTO public.job_board_anon_hourly AS hh (hour_utc, bucket, kind, country) VALUES (v_hour, v_bucket, v_kind, v_cc)`);
    expect(racy).not.toBe(body);
    const off = shapeOffences(racy);
    expect(off.some((o) => /read of the counter/.test(o))).toBe(true);
    expect(off.some((o) => /separate UPDATE/.test(o))).toBe(true);
  });

  it("teeth: an off-by-one cap test lets a fourth call through a cap of 3", async () => {
    const loose = MIGRATION.sql.split("m.within_cap < v_cap").join("m.within_cap <= v_cap");
    expect(loose).not.toBe(MIGRATION.sql);
    const db = await boot(loose);
    try {
      await setting(db, { enforce: true });
      const got: boolean[] = [];
      for (let i = 0; i < 5; i++) got.push((await call(db, "ip:aaa", "address", "US")).is_allowed);
      expect(got, "the mutant must break the cap the executed test pins").not.toEqual([true, true, true, false, false]);
      expect(got.filter(Boolean).length).toBe(4);
    } finally { await db.close(); }
  });
});
