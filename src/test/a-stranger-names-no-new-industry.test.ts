// @vitest-environment node
/**
 * A STRANGER NAMES NO NEW INDUSTRY (bug round S14X-046, C-S14-006).
 *
 * The industry-correction log is open to the publishable key and took any
 * label of fifty characters or fewer. "zz-not-an-industry" was stored; the
 * primary scanner loaded thirty days of rows unfiltered, so the label became
 * a boost target and could be introduced as an industry, and one visitor's
 * twenty a minute counted twenty; the backup scanner put the label in its
 * prompt as a "known misclassification pattern".
 *
 * Now the database refuses an unknown or unchanged label before the
 * address's write budget is read, the digest leaves those rows (and
 * confirmations) out, and both scanners read only labels they know: the
 * primary counts a pair's distinct visitors and needs two of them.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { EdgeHandler } from "./helpers/edge-harness";
import { loadScanners, resetWorld, scanPrimary, scanStream, world } from "./helpers/free-scan-world";
import { FSE_MIGRATION, freeScanDbMigrated, one } from "./helpers/free-scan-pglite";
import { definitionOf, migFile } from "./helpers/fixed-clock-sql";
import { SCAN_INDUSTRY_IDS } from "../config/scan-industries";
import { CORRECTION_MENU_INDUSTRIES } from "../../supabase/functions/_shared/correction-menu-industries";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 240_000 });

const UNKNOWN = "zz-not-an-industry";

describe("the database refuses a label the scanner does not know (pglite)", () => {
  let db: PGlite;
  beforeAll(async () => { db = await freeScanDbMigrated(); }, 120_000);
  afterAll(async () => { await db?.close(); });

  const stored = () => one<number>(db, "select count(*)::int from public.industry_corrections");
  const budgetReads = () => one<number>(db, "select count(*)::int from public.client_write_calls");

  it("an unknown label and an unchanged one write nothing, and spend none of the address's budget", async () => {
    const [rows, reads] = [await stored(), await budgetReads()];
    await db.query(`select public.log_industry_correction(p_detected => 'technology', p_corrected => '${UNKNOWN}')`);
    await db.query(`select public.log_industry_correction(p_detected => 'technology', p_corrected => 'Technology')`);
    await db.query(`select public.log_industry_correction(p_original_industry => 'technology', p_corrected_industry => '${UNKNOWN}')`);
    await db.query(`select public.log_industry_correction(p_original_industry => 'technology', p_corrected_industry => 'technology')`);
    expect(await stored()).toBe(rows);
    expect(await budgetReads()).toBe(reads);
  });

  it("control: a real correction is still stored, the four-argument call in lower case, the menu's own label verbatim", async () => {
    const rows = await stored();
    await db.query("select public.log_industry_correction(p_detected => 'technology', p_corrected => 'Healthcare')");
    await db.query("select public.log_industry_correction(p_original_industry => 'technology', p_corrected_industry => 'humanResources', p_visitor_id => 'v-1')");
    expect(await stored()).toBe(rows + 2);
    const r = await db.query<{ corrected_industry: string }>("select corrected_industry from public.industry_corrections order by created_at, corrected_industry");
    expect(r.rows.map((x) => x.corrected_industry)).toEqual(expect.arrayContaining(["healthcare", "humanResources"]));
  });

  it("the digest leaves out unknown labels, unchanged pairs and confirmations, and keeps real corrections", async () => {
    await db.exec(`
      INSERT INTO public.industry_corrections (original_industry, corrected_industry, detection_source) VALUES
        ('technology', '${UNKNOWN}', 'menu'), ('technology', '${UNKNOWN}', 'menu'),
        ('sales', 'sales', 'menu'),
        ('janitorial', 'clergy', 'user_confirmed'),
        ('sales', 'marketing', 'menu'), ('sales', 'marketing', 'menu');`);
    const r = await db.query<{ detected: string; corrected: string; corrections: number }>("select * from public.get_industry_correction_stats(30)");
    const pairs = r.rows.map((x) => `${x.detected}>${x.corrected}`);
    expect(pairs).toContain("sales>marketing");
    expect(pairs.some((p) => p.includes(UNKNOWN))).toBe(false);
    expect(pairs).not.toContain("sales>sales");
    expect(pairs).not.toContain("janitorial>clergy");
  });

  it("the page's three calls keep their grants; the label check itself is not a client's", async () => {
    for (const fn of [
      "public.log_industry_correction(text, text, text, text)",
      "public.log_industry_correction(text, text, text, text, integer, text[], text, text, text)",
      "public.get_industry_correction_stats(integer)",
    ]) expect(await one<boolean>(db, `select has_function_privilege('anon', '${fn}', 'EXECUTE')`)).toBe(true);
    expect(await one<boolean>(db, "select has_function_privilege('anon', 'public.is_scan_industry(text)', 'EXECUTE')")).toBe(false);
  });

  it("the SQL list is exactly the scanner's industries and the correction menu's, in lower case", () => {
    const def = definitionOf(migFile(FSE_MIGRATION), "is_scan_industry");
    const inSql = [...def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    const want = [...new Set([...SCAN_INDUSTRY_IDS, ...CORRECTION_MENU_INDUSTRIES].map((l) => l.toLowerCase()))].sort();
    expect(inSql).toEqual(want);
  });
});

describe("the scanners read only labels they know", () => {
  let primary: EdgeHandler;
  let stream: EdgeHandler;
  let logs: string[];
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeAll(async () => { ({ primary, stream } = await loadScanners(["primary", "stream"])); }, 240_000);
  beforeEach(() => {
    resetWorld();
    logs = [];
    for (const m of ["log", "warn", "error", "info"] as const) {
      spies.push(vi.spyOn(console, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(" ")); }));
    }
  });
  afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

  /** Thirty days of corrections as the primary reads them: every industry it knows "corrected" to `to`. */
  const rowsTo = (to: string, visitors: number) => [
    "technology", "finance", "sales", "marketing", "healthcare", "operations", "consulting", "general",
  ].flatMap((from) => Array.from({ length: 20 }, (_, i) => ({ original_industry: from, corrected_industry: to, visitor_id: `v-${i % visitors}` })));

  it("the primary never introduces an unknown label, however many rows name it", async () => {
    world.answer = (q) => (q.table === "industry_corrections" ? { data: rowsTo(UNKNOWN, 20), error: null } : undefined);
    const { json } = await scanPrimary(primary);
    expect(JSON.stringify(json)).not.toContain(UNKNOWN);
    expect(logs.filter((l) => l.includes(UNKNOWN))).toEqual([]);
    expect(logs.some((l) => /Loaded \d+ dynamic correction patterns/.test(l))).toBe(false);
  });

  it("one visitor's twenty rows are one visitor: a pair needs two", async () => {
    world.answer = (q) => (q.table === "industry_corrections" ? { data: rowsTo("legal", 1), error: null } : undefined);
    await scanPrimary(primary);
    expect(logs.some((l) => /Loaded \d+ dynamic correction patterns/.test(l))).toBe(false);
  });

  it("control: a known pair from several visitors is still learned", async () => {
    world.answer = (q) => (q.table === "industry_corrections" ? { data: rowsTo("legal", 5), error: null } : undefined);
    await scanPrimary(primary);
    expect(logs.some((l) => /Loaded \d+ dynamic correction patterns/.test(l))).toBe(true);
  });

  it("the backup scanner's prompt names no unknown label, and still names a real pattern", async () => {
    world.answer = (q) => (q.rpc === "get_industry_correction_stats"
      ? { data: [
        { detected: "finance", corrected: UNKNOWN, corrections: 9, last_seen: null },
        { detected: "sales", corrected: "sales", corrections: 7, last_seen: null },
        { detected: "sales", corrected: "marketing", corrections: 4, last_seen: null },
      ], error: null }
      : undefined);
    await scanStream(stream);
    const prompts = world.fetched.filter((f) => f.url.includes("ai.gateway.lovable.dev")).map((f) => f.body).join("\n");
    expect(prompts).toContain('\\"sales\\" is often corrected to \\"marketing\\"');
    expect(prompts).not.toContain(UNKNOWN);
    expect(prompts).not.toContain('\\"sales\\" is often corrected to \\"sales\\"');
  });
});
