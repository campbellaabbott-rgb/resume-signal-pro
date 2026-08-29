import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeFilters } from "../../supabase/functions/job-board/filters";

/**
 * Two filter defects, both measured live on 2026-08-27.
 *
 * 1. "REMOTE OR HYBRID" WAS UNASKABLE. category, country, experience and vendor
 *    all take several values; work_mode alone took one, all the way down —
 *    a single string in filters.ts, .eq() in the query builder, and
 *    `p.work_mode = quote_literal(...)` in all three SQL functions. In GB that
 *    is 1,476 remote and 3,765 hybrid, so the either-question is 5,241 postings
 *    against the 1,476 a searcher could reach. work_mode is populated on 28.1%
 *    of servable rows — the board's second-most-populated discretionary column,
 *    and it could only be asked a third of a question.
 *
 * 2. A PAY CEILING SILENTLY CANCELLED includeUnstatedPay. The toggle widens an
 *    active floor by ORing `salary_rank_usd IS NULL` back in; the ceiling
 *    shipped later as a plain .lte(), which PostgREST ANDs — and NULL fails
 *    `<=`, so every unpriced row the toggle had just re-admitted was thrown
 *    straight back out. category=design at a $100k floor: 405 without the
 *    toggle, 3,375 with it, and 404 once a $300k ceiling is added. Three lit
 *    controls, and the toggle contributing nothing. This is the pay-floor NULL
 *    discard — the exact bug includeUnstatedPay exists to fix — re-armed by a
 *    second predicate.
 */
const applied = (body: Record<string, unknown>) => normalizeFilters(body, 64).applied;
const ignored = (body: Record<string, unknown>) => normalizeFilters(body, 64).ignored;

const BOARD = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const API = readFileSync(
  resolve(__dirname, "../../supabase/functions/public-api/index.ts"), "utf8");
const BOARD_UI = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");
const ALERTS = readFileSync(
  resolve(__dirname, "../../supabase/functions/check-alerts/index.ts"), "utf8");
const SCAN_REPORT = readFileSync(
  resolve(__dirname, "../../supabase/functions/send-scan-report/index.ts"), "utf8");

describe("either mode, and a band that keeps its widening", () => {
  it("accepts several work modes", () => {
    expect(applied({ workMode: "remote,hybrid" }).workMode).toBe("remote,hybrid");
    expect(applied({ workMode: ["remote", "onsite"] }).workMode).toBe("remote,onsite");
  });

  it("leaves a single mode byte-identical — no existing caller changes meaning", () => {
    expect(applied({ workMode: "remote" }).workMode).toBe("remote");
    expect(applied({ workMode: "hybrid" }).workMode).toBe("hybrid");
    expect(applied({}).workMode).toBeNull();
  });

  it("keeps the good elements, drops the bad, and says it dropped them", () => {
    expect(applied({ workMode: "remote,bogus" }).workMode).toBe("remote");
    expect(ignored({ workMode: "remote,bogus" })).toContain("workMode");
    // Every element unusable is the same as asking for nothing — and is still
    // reported, exactly as before.
    expect(applied({ workMode: "bogus" }).workMode).toBeNull();
    expect(ignored({ workMode: "bogus" })).toContain("workMode");
    // A clean request must NOT be reported.
    expect(ignored({ workMode: "remote,hybrid" })).not.toContain("workMode");
  });

  it("dedupes and cannot exceed the closed domain", () => {
    expect(applied({ workMode: "remote,remote,hybrid" }).workMode).toBe("remote,hybrid");
    const all = applied({ workMode: "remote,hybrid,onsite" }).workMode!;
    expect(all.split(",")).toHaveLength(3);
  });

  it("stays a string, so no RPC signature moves", () => {
    // p_work_mode stays `text` and carries a comma-joined list precisely so no
    // overload can be created. A stray overload makes PostgREST answer PGRST203
    // to every call — the failure that killed affiliate conversion for eight
    // months and took ranked search down twice.
    expect(typeof applied({ workMode: "remote,hybrid" }).workMode).toBe("string");
    expect(BOARD).toMatch(/q\.in\("work_mode", applied\.workMode\.split\(","\)\)/);
  });

  it("the pay ceiling shares the toggle's widening on BOTH read paths", () => {
    // Without this the ceiling re-arms the NULL discard and the toggle
    // contributes zero on every banded search.
    expect(BOARD, "the board's query builder").toMatch(
      /salary_rank_usd\.lte\.\$\{applied\.salaryCeiling\},salary_rank_usd\.is\.null/);
    expect(API, "and the public API, or the two disagree about one band").toMatch(
      /salary_rank_usd\.lte\.\$\{salaryMax\},salary_rank_usd\.is\.null/);
    // Still a plain ceiling when the toggle is off — widening unasked-for would
    // be the opposite bug.
    expect(BOARD).toMatch(/: q\.lte\("salary_rank_usd", applied\.salaryCeiling\);/);
    expect(API).toMatch(/: qb\.lte\("salary_rank_usd", salaryMax\);/);
  });

  it('"Clear all" actually clears every selected mode', () => {
    // A bug I shipped with multi-select. "Clear all" invokes every removable
    // chip's clear() in one pass, and each closure had captured the SAME
    // workMode string — so removing "remote" queued "hybrid" and removing
    // "hybrid" queued "remote". Last write won and the board stayed filtered by
    // one mode after the visitor asked for no filters at all.
    //
    // The functional updater makes the removals compose rather than overwrite,
    // and fixes rapid successive chip clicks for free.
    expect(BOARD_UI).toMatch(/setWorkMode\(\(prev\) => withoutMode\(prev, m\)\)/);
    expect(BOARD_UI, "a captured value here is the bug")
      .not.toMatch(/setWorkMode\(withoutMode\(workMode, m\)\)/);
  });

  it("an alert that cannot fire on a total outage is not an alert", () => {
    // check-alerts read `rate || 100`. Zero is falsy, so a 0% success rate — the
    // whole pipeline down — became 100, and all three of these are `lt` alerts
    // that fire when a value drops BELOW a threshold. The worse the incident,
    // the healthier it read.
    expect(ALERTS).toMatch(/delivery_rate \?\? 100/);
    expect(ALERTS).toMatch(/success_rate \?\? 100/);
    // Comments stripped: the note explaining this bug necessarily quotes the
    // broken form, and a scanner that read it would flag the fix as the defect —
    // the false positive this repo has now shipped five times.
    const alertsCode = ALERTS.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ");
    expect(alertsCode, "no falsy default may come back").not.toMatch(/_rate \|\| 100/);
    // And a check that could not RUN must be distinguishable from a healthy one.
    expect(ALERTS).toMatch(/unavailable\.push\(fn\)/);
    expect(ALERTS).toMatch(/ALERTS BLIND/);
  });

  it("an opt-in cannot resurrect someone who unsubscribed", () => {
    // email is the PRIMARY KEY, so the upsert is an UPDATE for anyone already
    // there — and send-market-pulse selects its recipients with
    // `.is("unsubscribed_at", null)`. Writing null to that column from an
    // unauthenticated endpoint re-subscribed anyone whose address you knew.
    const pulse = SCAN_REPORT.slice(SCAN_REPORT.indexOf('from("market_pulse_subscribers")'));
    expect(pulse.slice(0, 400), "an opt-in must never clear an opt-out")
      .not.toMatch(/unsubscribed_at: null/);
    // And the mailer itself is bounded — it sends from the project's own domain
    // and enqueues four more over fourteen days.
    expect(SCAN_REPORT).toMatch(/p_function: "send-scan-report"/);
  });
});
