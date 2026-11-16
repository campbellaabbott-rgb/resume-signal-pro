// @vitest-environment node
/**
 * A SCAN THAT DELIVERED NOTHING GIVES ITS DAY BACK (bug round S14X-043,
 * M-S14-090 / C-S14-002; with S14X-145, RC-OI-04 and NB-18, which read the
 * same failed-model run).
 *
 * The free scan counts one of the day's scans (7, or 15 signed in) before
 * the model writes the report, and nothing gave it back: a gateway error, a
 * "Service busy", a rule-based report from a model that did not answer each
 * cost one, and the page's backup scan counted the day again under the same
 * name. The primary now gives the day back on every exit that delivered no
 * full report (give_back_scan_day, service role only), says why the report
 * is partial (partialCause), stops walking the model chain on the gateway's
 * 402 (the whole balance, not one model's), and logs a report the model did
 * not write as MODEL_FALLBACK, which the health reader counts apart from a
 * success. The public scan total no longer counts cache replays. The
 * rule-based report carries the résumé's language and stable codes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import type { EdgeHandler } from "./helpers/edge-harness";
import { gatewayFailing, loadScanners, metricStatuses, modelCalls, resetWorld, scanPrimary, world } from "./helpers/free-scan-world";
import { freeScanDbMigrated, one } from "./helpers/free-scan-pglite";
import { GLOBAL_BUCKET } from "../../supabase/functions/_shared/model-spend-gate";
import { NURSE } from "./fixtures/one-cv-in-several-languages";

vi.setConfig({ testTimeout: 90_000, hookTimeout: 240_000 });

let primary: EdgeHandler;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeAll(async () => {
  ({ primary } = await loadScanners(["primary"]));
}, 240_000);
beforeEach(() => {
  resetWorld();
  for (const m of ["log", "warn", "error", "info"] as const) spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => { while (spies.length) spies.pop()!.mockRestore(); });

const giveBacks = () => world.primaryDb.rpcArgs("give_back_scan_day");
const completedMetric = () => world.primaryDb.rpcArgs("log_scan_metric").find((a) => a.p_status === "completed");

describe("the primary gives the day back when no full report left", () => {
  it("a full report keeps the day, says nothing is partial, and is logged as a plain success", async () => {
    const { status, json } = await scanPrimary(primary);
    expect(status).toBe(200);
    expect(json.partialResults).toBeFalsy();
    expect(json.partialCause).toBeUndefined();
    expect(giveBacks()).toEqual([]);
    expect(completedMetric()?.p_error_code ?? null).toBeNull();
  });

  it("a gateway that errors gives the day back once, and names the cause", async () => {
    world.gateway = gatewayFailing(500);
    const { status, json } = await scanPrimary(primary);
    expect(status).toBe(200);
    expect(json.partialResults).toBe(true);
    expect(json.partialCause).toBe("model_error");
    expect(giveBacks()).toEqual([{ p_ip: "198.51.100.77", p_function: "free-keyword-scan" }]);
  });

  it("the gateway's 402 is the whole balance: no further model is asked, and the day goes back", async () => {
    world.gateway = gatewayFailing(402);
    const { json } = await scanPrimary(primary);
    expect(json.partialCause).toBe("model_credits");
    // One attempt per call (the core report and its enrichment), not one per model in the chain.
    expect(modelCalls()).toBeLessThanOrEqual(2);
    expect(giveBacks()).toHaveLength(1);
  });

  it("a busy gateway answers 'Service busy' and gives the day back", async () => {
    world.gateway = gatewayFailing(429);
    const { status } = await scanPrimary(primary);
    expect(status).toBe(429);
    expect(giveBacks()).toHaveLength(1);
  });

  it("past the function's hour the day was never counted, so nothing is given back, and the cause is the hour", async () => {
    world.answer = (q) => (q.rpc === "check_rate_limit" && (q.calls[0][1][0] as Record<string, unknown>).p_ip === GLOBAL_BUCKET
      ? { data: false, error: null } : undefined);
    const { json } = await scanPrimary(primary);
    expect(json.partialCause).toBe("hour_ceiling");
    expect(giveBacks()).toEqual([]);
    expect(world.primaryDb.rpcArgs("check_rate_limit").some((a) => a.p_window_minutes === 1440)).toBe(false);
  });
});

describe("RC-OI-04: a report the model did not write is not logged as a success", () => {
  it("with the gateway failing, the completed metric carries MODEL_FALLBACK and its cause", async () => {
    world.gateway = gatewayFailing(500);
    await scanPrimary(primary);
    const m = completedMetric();
    expect(m?.p_error_code).toBe("MODEL_FALLBACK");
    expect((m?.p_metadata as Record<string, unknown>).fallbackCause).toBe("model_error");
    expect(metricStatuses(world.primaryDb)).toContain("completed");
  });

  it("a ceiling refusal asked no model, so it is not a model fallback", async () => {
    world.answer = (q) => (q.rpc === "check_rate_limit" && (q.calls[0][1][0] as Record<string, unknown>).p_ip === GLOBAL_BUCKET
      ? { data: false, error: null } : undefined);
    await scanPrimary(primary);
    expect(completedMetric()?.p_error_code ?? null).toBeNull();
  });
});

describe("NB-18: the rule-based report is in the résumé's language, with codes the page can translate", () => {
  it("a Spanish CV's fallback says Spanish, and every English sentence carries a stable code", async () => {
    world.gateway = gatewayFailing(500);
    // The nurse's CV with its figures taken out, so the fallback has advice to give.
    const unquantified = String(NURSE.texts.es).replace(/\d+/g, "varios");
    const { json } = await scanPrimary(primary, { resumeText: unquantified });
    expect(json.detectedLanguage).toBe("es");
    expect(json.formatIssueCode).toBe("automated_review_only");
    const wins = json.quickWins as Array<{ code?: string }>;
    expect(wins.length).toBeGreaterThan(0);
    for (const w of wins) expect(["add_numbers", "rewrite_passive_openers"]).toContain(w.code);
    expect((json.nextBestAction as { code?: string }).code).toBe("number_top_three");
    for (const f of (json.redFlags as Array<{ code?: string; issue?: string }>).filter((r) => r.issue === "A bullet reads as a duty, not a result")) {
      expect(f.code).toBe("duty_not_result");
    }
    // Its own section words are read: "Resumen profesional", "Experiencia laboral", "Habilidades", "Formación académica".
    const check = json.sectionCheck as Record<string, unknown>;
    expect(check.hasSummary).toBe(true);
    expect(check.hasExperience).toBe(true);
    expect(check.hasSkills).toBe(true);
    expect(check.hasEducation).toBe(true);
  });

  it("S14X-168: a 'PERSONAL STATEMENT' heading is a summary on the rule-based report", async () => {
    world.gateway = gatewayFailing(500);
    const uk = [
      "Sam Taylor | sam.taylor@example.co.uk | +44 7700 900123 | Leeds",
      "PERSONAL STATEMENT",
      "Operations coordinator with six years in warehouse logistics and stock control across two regional depots.",
      "WORK HISTORY",
      "Operations Coordinator, Northern Freight Ltd, Jan 2020 - Present",
      "- Cut picking errors by 18% by redesigning the bay labelling scheme",
      "- Scheduled 40 drivers a week across three shifts",
      "Warehouse Operative, Leeds Depot, Mar 2017 - Dec 2019",
      "- Loaded and checked 120 pallets a shift",
      "QUALIFICATIONS",
      "BTEC Level 3 Business, Leeds City College",
    ].join("\n");
    const { json } = await scanPrimary(primary, { resumeText: uk });
    expect((json.sectionCheck as Record<string, unknown>).hasSummary).toBe(true);
  });
});

describe("the database half (pglite, the lane's migration applied twice)", () => {
  let db: PGlite;
  beforeAll(async () => { db = await freeScanDbMigrated(); }, 120_000);
  afterAll(async () => { await db?.close(); });

  it("give_back_scan_day takes one back, never below zero, only the free scan's row inside its day", async () => {
    await db.exec(`
      DELETE FROM public.rate_limits;
      INSERT INTO public.rate_limits (ip_address, function_name, request_count, window_start) VALUES
        ('203.0.113.5', 'free-keyword-scan', 1, now()),
        ('203.0.113.5', 'tailor-resume', 3, now()),
        ('203.0.113.6', 'free-keyword-scan', 4, now() - interval '25 hours');`);
    expect(await one<boolean>(db, "select public.give_back_scan_day('203.0.113.5', 'free-keyword-scan')")).toBe(true);
    expect(await one<boolean>(db, "select public.give_back_scan_day('203.0.113.5', 'free-keyword-scan')")).toBe(false);
    expect(await one<boolean>(db, "select public.give_back_scan_day('203.0.113.5', 'tailor-resume')")).toBe(false);
    expect(await one<boolean>(db, "select public.give_back_scan_day('203.0.113.6', 'free-keyword-scan')")).toBe(false);
    const rows = await db.query<{ ip_address: string; function_name: string; request_count: number }>(
      "select ip_address, function_name, request_count from public.rate_limits order by 1, 2");
    expect(rows.rows.map((r) => [r.ip_address, r.function_name, r.request_count])).toEqual([
      ["203.0.113.5", "free-keyword-scan", 0], ["203.0.113.5", "tailor-resume", 3], ["203.0.113.6", "free-keyword-scan", 4],
    ]);
  });

  it("only the service role can run it: a client that could would have an unlimited day", async () => {
    for (const role of ["anon", "authenticated"]) {
      expect(await one<boolean>(db, `select has_function_privilege('${role}', 'public.give_back_scan_day(text, text)', 'EXECUTE')`)).toBe(false);
    }
    expect(await one<boolean>(db, "select has_function_privilege('service_role', 'public.give_back_scan_day(text, text)', 'EXECUTE')")).toBe(true);
    await db.exec("SET ROLE anon");
    await expect(db.query("select public.give_back_scan_day('203.0.113.5', 'free-keyword-scan')")).rejects.toThrow(/permission denied/);
    await db.exec("RESET ROLE");
  });

  it("S14X-145: the public total leaves out a cache replay and names its basis", async () => {
    await db.exec(`
      DELETE FROM public.scan_metrics;
      INSERT INTO public.scan_metrics (scan_type, status, duration_ms, cache_hit) VALUES
        ('free', 'completed', 900, false), ('free-stream', 'completed', 40, true);`);
    const totals = await one<Record<string, unknown>>(db, "select public.get_scan_totals()");
    expect(totals.total_scans).toBe(1);
    expect(String(totals.basis)).toMatch(/cache/);
  });

  it("RC-OI-04: two completed rows of which one is a model fallback read 50% success and one fallback", async () => {
    await db.exec(`
      DELETE FROM public.scan_metrics;
      INSERT INTO public.scan_metrics (scan_type, status, duration_ms, error_code) VALUES
        ('free', 'completed', 900, NULL), ('free', 'completed', 800, 'MODEL_FALLBACK');`);
    const r = await db.query<{ success_rate_last_hour: string; model_fallback_last_hour: number; issues: string[] }>(
      "select success_rate_last_hour, model_fallback_last_hour, issues from public.get_scan_health_status()");
    expect(Number(r.rows[0].success_rate_last_hour)).toBe(50);
    expect(Number(r.rows[0].model_fallback_last_hour)).toBe(1);
    expect(r.rows[0].issues.some((i) => i.startsWith("Model fallback: 1 of 2"))).toBe(true);
  });

  it("the health reader keeps its first eight columns in order, the new one appended", async () => {
    const r = await db.query("select * from public.get_scan_health_status()");
    expect(r.fields.map((f) => f.name)).toEqual([
      "status", "last_successful_scan", "scans_last_hour", "success_rate_last_hour", "avg_latency_last_hour",
      "last_heartbeat_status", "last_heartbeat_time", "issues", "model_fallback_last_hour",
    ]);
  });
});
