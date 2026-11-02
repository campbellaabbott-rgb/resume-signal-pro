/**
 * OPENING THE ACCOUNT PAGE SPENDS ONLY A SMALL SHARE OF THE FIT CHECKS (the
 * audit-rest fixer's review of S13-093).
 *
 * WHAT WAS WRONG. Every time /account loaded, its gap report re-measured up
 * to twelve tracked postings with application-fit, which allows one address
 * 60 checks an hour. A new tab started again (its measurements are kept per
 * tab), so a person with thirty tracked jobs who opened the page in a few
 * tabs spent their own allowance, and the next fit check they asked for on
 * the board failed as rate-limited.
 *
 * WHAT HOLDS NOW: the page starts at most AUTO_REMEASURE_PER_HOUR automatic
 * checks an hour across every load and tab of this browser (the times are
 * kept, nothing personal), a reload in the same tab repeats none (the tab's
 * measurements), and the page's loop asks the allowance before each call.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { AUTO_REMEASURE_PER_HOUR, GAP_AUTO_SPEND_KEY, REMEASURE_PER_LOAD, autoRemeasureAllowance, rowsToRemeasure, spendAutoRemeasure, type GapRow } from "@/lib/gap-report";

const POSTING = "We need Kubernetes, Terraform and Go experience. ".repeat(4);
const rows: GapRow[] = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, scan_id: "old", fit_pct: 50, fit_missing: ["k"], job_posting: POSTING }));
const T0 = Date.parse("2026-11-03T10:00:00Z");

beforeEach(() => localStorage.clear());

describe("the hour's automatic allowance", () => {
  it("is a small share of application-fit's 60 an hour, below one load's old twelve", () => {
    expect(AUTO_REMEASURE_PER_HOUR).toBeLessThanOrEqual(10);
    expect(AUTO_REMEASURE_PER_HOUR).toBeLessThan(REMEASURE_PER_LOAD);
  });

  it("thirty tracked jobs and three opens in an hour start at most the hour's allowance, not 36", () => {
    let started = 0;
    for (let open = 0; open < 3; open++) {
      const now = T0 + open * 5 * 60_000;
      for (const _row of rowsToRemeasure(rows, "new", {}, Math.min(REMEASURE_PER_LOAD, autoRemeasureAllowance(now)))) {
        if (!spendAutoRemeasure(now)) break;
        started++;
      }
    }
    expect(started).toBe(AUTO_REMEASURE_PER_HOUR);
    expect(autoRemeasureAllowance(T0 + 15 * 60_000)).toBe(0);
  });

  it("comes back as the hour rolls on", () => {
    for (let i = 0; i < AUTO_REMEASURE_PER_HOUR; i++) spendAutoRemeasure(T0);
    expect(autoRemeasureAllowance(T0 + 59 * 60_000)).toBe(0);
    expect(autoRemeasureAllowance(T0 + 61 * 60_000)).toBe(AUTO_REMEASURE_PER_HOUR);
  });

  it("keeps times only, and a corrupt record starts the hour fresh", () => {
    spendAutoRemeasure(T0);
    expect(JSON.parse(localStorage.getItem(GAP_AUTO_SPEND_KEY)!)).toEqual([T0]);
    localStorage.setItem(GAP_AUTO_SPEND_KEY, "{not json");
    expect(autoRemeasureAllowance(T0)).toBe(AUTO_REMEASURE_PER_HOUR);
  });
});

describe("the account page", () => {
  it("asks the allowance for its list and spends it before each call", () => {
    const code = codeOf(readFileSync(resolve(__dirname, "../pages/Account.tsx"), "utf8"));
    expect(code).toMatch(/rowsToRemeasure\(gapRowsRef\.current, gapBasis, fits, Math\.min\(REMEASURE_PER_LOAD, autoRemeasureAllowance\(\)\)\)/);
    const loop = code.slice(code.indexOf("for (const row of todo)"), code.indexOf('supabase.functions.invoke("application-fit"'));
    expect(loop).toMatch(/if \(!spendAutoRemeasure\(\)\) return;/);
  });
});
