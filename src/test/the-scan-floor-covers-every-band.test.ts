// @vitest-environment node
/**
 * THE SCAN FLOOR COVERS EVERY BAND (S14X-193).
 *
 * /research/ats-score-benchmarks and its Dataset markup say a bucket is
 * published only at n >= 25 scans. get_public_scan_insights (20261101100000)
 * held industries and experience levels to that floor and published every
 * histogram band whatever its size, and stated an 80+ share from no scan at
 * all ("Only 0% scored 80 or higher"). The fixture is shaped like the live
 * answer of 2026-11-15: 190 scans, four bands of 2, 4, 24 and 8, none at 80+.
 *
 * Executed: one scan_metrics table on Supabase's default grants, the live
 * definition (renamed) as the positive control, then this round's file.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { definitionOf, migFile } from "./helpers/fixed-clock-sql";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const WAS = "20261101100000_the_score_benchmark_is_one_scorers_in_one_vocabulary.sql";
const NOW = "20261112195000_the_scan_floor_covers_every_band.sql";

type Insights = {
  overall: { n: number; median: number; pct_80_plus: number | null; pct_under_50: number | null };
  histogram: Array<{ bucket: number; n: number }>;
  histogram_hidden_n?: number;
  band_floor?: number;
  industries: Array<{ industry: string; n: number }>;
  excluded: { fallback_scanner: number; rule_based_report: number };
};

let db: PGlite;
let was: Insights;
let now: Insights;
const read = async () => (await db.query<{ v: Insights }>(`SELECT public.get_public_scan_insights() AS v`)).rows[0].v;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon NOLOGIN NOINHERIT; CREATE ROLE authenticated NOLOGIN NOINHERIT;
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE TABLE public.scan_metrics (
      id bigserial PRIMARY KEY, scan_type text, status text, response_score integer,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
    INSERT INTO public.scan_metrics (scan_type, status, response_score, metadata)
    SELECT 'free', 'completed', s, '{"industry":"technology"}'::jsonb
      FROM (VALUES (15, 2), (25, 4), (35, 24), (45, 60), (55, 52), (65, 40), (75, 8)) v(s, n), generate_series(1, n);
    -- The fallback scanner's 80+ scans stay out of every figure.
    INSERT INTO public.scan_metrics (scan_type, status, response_score)
    SELECT 'free-stream', 'completed', 88 FROM generate_series(1, 30);
  `);
  await db.exec(definitionOf(migFile(WAS), "get_public_scan_insights").replace("public.get_public_scan_insights(", "public.get_public_scan_insights_was("));
  was = (await db.query<{ v: Insights }>(`SELECT public.get_public_scan_insights_was() AS v`)).rows[0].v;
  await db.exec(migFile(NOW));
  now = await read();
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the live definition (the positive control)", () => {
  it("published four histogram bands under the floor and an 80+ share from no scan", () => {
    expect(was.overall.n).toBe(190);
    expect(was.histogram.filter((b) => b.n < 25).map((b) => b.n)).toEqual([2, 4, 24, 8]);
    expect(Number(was.overall.pct_80_plus)).toBe(0);
  });
});

describe("the benchmark now", () => {
  it("publishes no histogram band under 25 scans", () => {
    expect(now.histogram.length).toBeGreaterThan(0);
    for (const b of now.histogram) expect(b.n, `band ${b.bucket}`).toBeGreaterThanOrEqual(25);
    expect(now.histogram.map((b) => b.bucket)).toEqual([40, 50, 60]);
  });

  it("counts the scans it held back and names the floor", () => {
    expect(now.histogram_hidden_n).toBe(2 + 4 + 24 + 8);
    expect(now.band_floor).toBe(25);
    expect(now.histogram.reduce((s, b) => s + b.n, 0) + (now.histogram_hidden_n ?? 0)).toBe(now.overall.n);
  });

  it("states no 80+ share when fewer than 25 scans scored 80 or more", () => {
    expect(now.overall.pct_80_plus).toBeNull();
  });

  it("leaves every other figure as it was", () => {
    expect(now.overall.n).toBe(was.overall.n);
    expect(now.overall.median).toEqual(was.overall.median);
    expect(now.overall.pct_under_50).toEqual(was.overall.pct_under_50);
    expect(now.industries).toEqual(was.industries);
    expect(now.excluded).toEqual(was.excluded);
  });

  it("states the 80+ share once 25 primary scans scored 80 or more", async () => {
    await db.exec(`INSERT INTO public.scan_metrics (scan_type, status, response_score)
                   SELECT 'paid', 'completed', 85 FROM generate_series(1, 25)`);
    const v = await read();
    expect(Number(v.overall.pct_80_plus)).toBeCloseTo((100 * 25) / 215, 1);
    expect(v.histogram.find((b) => b.bucket === 80)).toEqual({ bucket: 80, n: 25 });
    await db.exec(`DELETE FROM public.scan_metrics WHERE scan_type = 'paid'`);
  });

  it("is executable by the publishable key, revoked from PUBLIC, and still SECURITY DEFINER", async () => {
    const r = (await db.query<{ anon: boolean; pub: boolean; definer: boolean }>(`
      SELECT has_function_privilege('anon', 'public.get_public_scan_insights()', 'EXECUTE') AS anon,
             EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                      WHERE p.oid = 'public.get_public_scan_insights()'::regprocedure AND a.grantee = 0) AS pub,
             (SELECT prosecdef FROM pg_proc WHERE oid = 'public.get_public_scan_insights()'::regprocedure) AS definer`)).rows[0];
    expect(r).toEqual({ anon: true, pub: false, definer: true });
  });
});

describe("the file", () => {
  it("runs twice", async () => {
    await expect(db.exec(migFile(NOW))).resolves.toBeDefined();
    expect((await read()).histogram_hidden_n).toBe(38);
  });

  it("its end-state block refuses a definition that publishes a band under the floor", async () => {
    const mutant = migFile(NOW).replace("select bucket, n from hist_all where n >= 25", "select bucket, n from hist_all where n >= 1");
    expect(mutant).not.toBe(migFile(NOW));
    await expect(db.exec(`BEGIN;\n${mutant}`)).rejects.toThrow(/under the 25-scan floor is still published/);
    await db.exec("ROLLBACK");
  });
});
