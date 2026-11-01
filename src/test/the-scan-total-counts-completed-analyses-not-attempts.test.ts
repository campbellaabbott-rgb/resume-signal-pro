// @vitest-environment node
/**
 * THE SCAN TOTAL COUNTS COMPLETED ANALYSES, NOT ATTEMPTS (S13-087).
 *
 * get_scan_totals is printed as "the scanner has completed N scans" (the
 * homepage bake), "N Resumes Analyzed" (/trust) and "N resumes analyzed"
 * (/methodology). Its last definition counted every scan_metrics row of the
 * real-scan types whatever its status: failed attempts, and the
 * validation_error row the free scan logs before it carries on to its
 * rule-based report and logs that scan again as completed. Executed here
 * against both definitions.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { definitionOf, migFile } from "./helpers/fixed-clock-sql";

vi.setConfig({ hookTimeout: 120_000, testTimeout: 60_000 });

const WAS = "20260709124621_cb917d97-39d7-401d-bc3e-f7ed3eefaf74.sql";
const NOW = "20261103190000_the_scan_total_counts_completed_analyses_only.sql";

let db: PGlite;
type Totals = { total_scans: number; countries: number };
let was: Totals;
let now: Totals;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE public.scan_metrics (
      id bigserial PRIMARY KEY, scan_type text, status text, response_score integer, ip_country text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
    -- Ten finished scans from two countries; three of them logged a
    -- validation_error first; four attempts failed; the heartbeat finished too.
    INSERT INTO public.scan_metrics (scan_type, status, response_score, ip_country)
    SELECT t, s, 60, c FROM (VALUES ('free', 'completed', 'US', 6), ('free-stream', 'completed', 'DE', 3), ('paid', 'completed', 'US', 1),
                                    ('free', 'validation_error', 'FR', 3), ('free', 'failed', 'BR', 2), ('free-stream', 'failed', 'IN', 2),
                                    ('heartbeat', 'completed', 'US', 9)) v(t, s, c, n),
         generate_series(1, n);
  `);
  await db.exec(definitionOf(migFile(WAS), "get_scan_totals").replace("public.get_scan_totals(", "public.get_scan_totals_was("));
  was = (await db.query<{ v: Totals }>(`SELECT public.get_scan_totals_was() AS v`)).rows[0].v;
  await db.exec(migFile(NOW));
  now = (await db.query<{ v: Totals }>(`SELECT public.get_scan_totals() AS v`)).rows[0].v;
});

afterAll(async () => { try { await db.close(); } catch { /* best effort */ } });

describe("the public scan total", () => {
  it("counted failures and the validation_error rows before this change", () => {
    expect(Number(was.total_scans)).toBe(6 + 3 + 1 + 3 + 2 + 2);
    expect(Number(was.countries)).toBe(5);
  });

  it("now counts the analyses the scanner completed, over the countries those came from", () => {
    expect(Number(now.total_scans)).toBe(10);
    expect(Number(now.countries)).toBe(2);
  });

  it("stays callable by a visitor and is safe to run twice", async () => {
    const r = await db.query<{ ok: boolean }>(`SELECT has_function_privilege('anon', 'public.get_scan_totals()', 'EXECUTE') AS ok`);
    expect(r.rows[0].ok).toBe(true);
    await db.exec(migFile(NOW));
  });
});
