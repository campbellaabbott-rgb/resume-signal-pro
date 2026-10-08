// @vitest-environment node
/**
 * THE "REAL USERS" SCORE BENCHMARK COUNTED OUR OWN TEST SCANS.
 *
 * get_public_scan_insights feeds /research/ats-score-benchmarks ("completed
 * scans run by real users"), LiveScanStats and the prerender's Dataset
 * JSON-LD. Its last definition filtered scan_type <> 'heartbeat', which admits
 * 'synthetic', the type our smoke and load tests write: live, overall.n 379
 * over 23 synthetic, 179 free and 178 free-stream rows (register L11-04).
 * 20261008112000 puts it back on the allowlist get_scan_totals uses.
 *
 * Executed: one scan_metrics table, the previous definition and the new one.
 * And every published score statistic's newest definition in the lane is held
 * to an allowlist that names no internal type.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { definitionOf, migFile, migFiles } from "./helpers/fixed-clock-sql";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const WAS = "20260727201433_b00cf43f-49dd-4bc6-aeca-43b15b9a5e5d.sql";
const NOW = "20261008112000_the_real_users_score_benchmark_counts_only_real_users.sql";

let db: PGlite;
let was: { overall: { n: number; median: number } };
let now: { overall: { n: number; median: number } };

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.scan_metrics (
      id bigserial PRIMARY KEY, scan_type text, status text, response_score integer,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
    -- Real scans score 60; our own synthetic runs score 95; the heartbeat 99.
    INSERT INTO public.scan_metrics (scan_type, status, response_score)
    SELECT t, 'completed', s FROM (VALUES ('free', 60, 30), ('free-stream', 60, 30), ('paid', 60, 5),
                                          ('synthetic', 95, 40), ('heartbeat', 99, 50), ('free', 60, 0)) v(t, s, n),
         generate_series(1, n);
    INSERT INTO public.scan_metrics (scan_type, status, response_score) VALUES ('free', 'failed', 10);
  `);
  await db.exec(definitionOf(migFile(WAS), "get_public_scan_insights").replace("public.get_public_scan_insights(", "public.get_public_scan_insights_was("));
  was = (await db.query<{ v: typeof was }>(`SELECT public.get_public_scan_insights_was() AS v`)).rows[0].v;
  await db.exec(migFile(NOW));
  now = (await db.query<{ v: typeof now }>(`SELECT public.get_public_scan_insights() AS v`)).rows[0].v;
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the published score benchmark", () => {
  it("counted our own synthetic scans as real users until this change", () => {
    expect(was.overall.n).toBe(30 + 30 + 5 + 40);
  });

  it("now counts the free, streamed and paid scans and nothing else", () => {
    expect(now.overall.n).toBe(65);
    expect(Number(now.overall.median)).toBe(60);
  });

  it("is still executable by the publishable key and revoked from PUBLIC", async () => {
    const r = (await db.query<{ anon: boolean; pub: boolean }>(`
      SELECT has_function_privilege('anon', 'public.get_public_scan_insights()', 'EXECUTE') AS anon,
             EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                      WHERE p.oid = 'public.get_public_scan_insights()'::regprocedure AND a.grantee = 0) AS pub`)).rows[0];
    expect(r).toEqual({ anon: true, pub: false });
  });

  it("every published score statistic's newest definition filters on an allowlist that names no internal type", () => {
    for (const fn of ["get_public_scan_insights", "get_real_score_distribution"]) {
      const defining = migFiles().filter((f) => new RegExp(`function\\s+public\\.${fn}\\s*\\(`, "i").test(migFile(f)));
      const body = definitionOf(migFile(defining[defining.length - 1]), fn)
        .replace(/--[^\n]*/g, "");
      const allow = /scan_type\s+in\s*\(([^)]*)\)/i.exec(body);
      expect(allow, `${fn}: no scan_type allowlist in ${defining[defining.length - 1]}`).toBeTruthy();
      expect(allow![1], `${fn} admits an internal scan type`).not.toMatch(/synthetic|heartbeat/);
      expect(body, `${fn} filters by denylist`).not.toMatch(/scan_type\s*(<>|!=)/i);
    }
  });
});
