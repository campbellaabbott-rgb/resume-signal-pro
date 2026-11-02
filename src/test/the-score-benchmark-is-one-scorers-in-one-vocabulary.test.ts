// @vitest-environment node
/**
 * THE SCORE BENCHMARK IS ONE SCORER'S, IN ONE VOCABULARY (register S13-050).
 *
 * /research/ats-score-benchmarks printed Technology (n=103, median 55) beside
 * Software Engineering (n=35, median 91): every Software Engineering row was
 * the fallback scanner's ('free-stream'), a different scorer that kept
 * 'software_engineering' as an industry of its own where the primary reads
 * 'technology', and the fallback's scores sat in the overall median, the
 * quartiles and the 80+ share with no disclosure. 20261101100000 leaves the
 * fallback scanner and the primary's rule-based report out of every figure,
 * says how many it left out, and reads labels in the primary's vocabulary;
 * the fallback's alias table now resolves a generic "software" the way the
 * primary does.
 *
 * Executed: one scan_metrics table, the previous definition and the new one.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { definitionOf, migFile } from "./helpers/fixed-clock-sql";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const WAS = "20261008112000_the_real_users_score_benchmark_counts_only_real_users.sql";
const NOW = "20261101100000_the_score_benchmark_is_one_scorers_in_one_vocabulary.sql";

type Insights = {
  overall: { n: number; median: number; pct_80_plus: number };
  industries: Array<{ industry: string; n: number; median: number }>;
  excluded?: { fallback_scanner: number; rule_based_report: number };
  scorer?: string;
};
let db: PGlite;
let was: Insights;
let now: Insights;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.scan_metrics (
      id bigserial PRIMARY KEY, scan_type text, status text, response_score integer,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
    -- The primary scores technology résumés 55; the fallback scores the same
    -- field 91 under its own name; the rule-based report gives 40; our own
    -- synthetic runs 95.
    INSERT INTO public.scan_metrics (scan_type, status, response_score, metadata)
    SELECT t, 'completed', s, m::jsonb FROM (VALUES
      ('free',        55, 40, '{"industry":"technology","usedFallback":false}'),
      ('paid',        55, 10, '{"industry":"technology"}'),
      ('free',        62, 30, '{"industry":"healthcare","usedFallback":false}'),
      ('free-stream', 91, 35, '{"industry":"software_engineering"}'),
      ('free-stream', 70, 10, '{"industry":"technology"}'),
      ('free',        40, 12, '{"industry":"technology","usedFallback":true}'),
      ('synthetic',   95, 20, '{"industry":"technology"}')
    ) v(t, s, n, m), generate_series(1, n);
  `);
  await db.exec(definitionOf(migFile(WAS), "get_public_scan_insights").replace("public.get_public_scan_insights(", "public.get_public_scan_insights_was("));
  was = (await db.query<{ v: Insights }>(`SELECT public.get_public_scan_insights_was() AS v`)).rows[0].v;
  await db.exec(migFile(NOW));
  now = (await db.query<{ v: Insights }>(`SELECT public.get_public_scan_insights() AS v`)).rows[0].v;
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the published score benchmark", () => {
  it("printed one field twice and blended the fallback's scores in, until this change", () => {
    expect(was.overall.n).toBe(40 + 10 + 30 + 35 + 10 + 12);
    expect(was.industries.map((i) => i.industry)).toEqual(expect.arrayContaining(["technology", "software_engineering"]));
  });

  it("now counts the primary's model-written reports only", () => {
    expect(now.overall.n).toBe(40 + 10 + 30);
    expect(now.overall.pct_80_plus).toBe(0);
    expect(now.scorer).toBe("primary");
  });

  it("says how many it left out, and why", () => {
    expect(now.excluded).toEqual({ fallback_scanner: 45, rule_based_report: 12 });
  });

  it("lists technology once, at the primary's median, and no software_engineering", () => {
    expect(now.industries.map((i) => i.industry).sort()).toEqual(["healthcare", "technology"]);
    expect(now.industries.find((i) => i.industry === "technology")).toMatchObject({ n: 50, median: 55 });
  });

  it("a primary row labelled software_engineering is read as technology", async () => {
    await db.exec(`INSERT INTO public.scan_metrics (scan_type, status, response_score, metadata)
                   SELECT 'free', 'completed', 55, '{"industry":"software_engineering"}'::jsonb FROM generate_series(1, 30)`);
    const v = (await db.query<{ v: Insights }>(`SELECT public.get_public_scan_insights() AS v`)).rows[0].v;
    expect(v.industries.find((i) => i.industry === "technology")?.n).toBe(80);
    expect(v.industries.some((i) => i.industry === "software_engineering")).toBe(false);
  });

  it("is still executable by the publishable key and revoked from PUBLIC", async () => {
    const r = (await db.query<{ anon: boolean; pub: boolean }>(`
      SELECT has_function_privilege('anon', 'public.get_public_scan_insights()', 'EXECUTE') AS anon,
             EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                      WHERE p.oid = 'public.get_public_scan_insights()'::regprocedure AND a.grantee = 0) AS pub`)).rows[0];
    expect(r).toEqual({ anon: true, pub: false });
  });

  it("re-runs cleanly", async () => {
    await expect(db.exec(migFile(NOW))).resolves.toBeDefined();
  });
});

describe("one vocabulary across the runtimes", () => {
  const root = resolve(__dirname, "../../supabase/functions");
  const aliasesOf = (file: string) => {
    const src = readFileSync(resolve(root, file), "utf8");
    const at = src.indexOf("const INDUSTRY_ALIASES: Record<string, string> = {");
    return Object.fromEntries([...src.slice(at, src.indexOf("\n};", at)).matchAll(/'([^']+)':\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
  };
  const primary = aliasesOf("free-keyword-scan/index.ts");
  const fallback = aliasesOf("free-keyword-scan-stream/index.ts");

  it("the benchmark reads software_engineering as the primary's alias table does", () => {
    expect(primary["software_engineering"]).toBe("technology");
    expect(migFile(NOW)).toContain(`when 'software_engineering' then '${primary["software_engineering"]}'`);
  });
  it("the fallback resolves a generic software answer the way the primary does", () => {
    for (const k of ["software", "software development"]) expect(fallback[k], k).toBe(primary[k]);
    for (const k of ["web development", "app development"]) expect(fallback[k], k).toBe("technology");
  });
});
