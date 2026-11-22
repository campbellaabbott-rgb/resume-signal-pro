// A DAY-30 LINE IS NOT REFUSED FOR THE SERVER'S ROUNDING.
//
// WHAT HAPPENED. get_category_fill_curve and get_company_fill_curve hold the
// identity R + X + S = 1 within 1e-6 on their UNROUNDED arms (that is what
// sufficient_30 and sum_check_30 say), then publish taken_down_30,
// relist_rate_30 and still_open_30 each rounded to 4 places. The Ghost Job
// Index re-applied the server's 1e-6 to the three ROUNDED columns, so a row
// whose roundings happened to land 0.0001 off printed "the three shares we
// publish together did not add up to one on this read" while the server's
// own check said they did. Measured on 36 hourly reads, 2026-11-16..18
// (cost wave 2, AG-1): 144 of 612 server-sufficient rows were refused that
// way, sum_check_30 was 1 on all 612, and the refusals came and went hour to
// hour (data_ai, read 10:35Z on 11-18: 0.445 + 0.4971 + 0.058 = 1.0001).
//
// THE PROPERTY. The page's identity check allows the server's tolerance PLUS
// three half-units of the last place the server publishes, the decimals read
// from the live definitions, not typed here. It still refuses a row that misses
// by more than rounding can explain.
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  day30Verdict, IDENTITY_SLACK_30, PUBLISHED_DECIMALS_30, SUM_CHECK_TOLERANCE_30, type Day30Row,
} from "../pages/GhostJobIndex";

const ROOT = resolve(__dirname, "../..");
const MIGRATIONS = resolve(ROOT, "supabase/migrations");
const stripSql = (s: string) => s.replace(/--[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

/** The newest migration that (re)defines fn, as executable SQL. */
function liveDefinition(fn: string): { file: string; sql: string } {
  const defines = new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, "i");
  const files = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()
    .filter((f) => defines.test(stripSql(readFileSync(resolve(MIGRATIONS, f), "utf8"))));
  expect(files.length, `no migration defines ${fn}`).toBeGreaterThan(0);
  const file = files[files.length - 1];
  return { file, sql: stripSql(readFileSync(resolve(MIGRATIONS, file), "utf8")) };
}
/** The decimals the definition rounds each of the three day-30 shares to. */
function publishedDecimals(sql: string): number[] {
  return [["s30", "still_open_30"], ["r30", "taken_down_30"], ["x30", "relist_rate_30"]].map(([arm, col]) => {
    const m = new RegExp(`round\\(e30\\.${arm},\\s*(\\d+)\\)[^\\n]*?AS\\s+${col}\\b`).exec(sql);
    expect(m, `the definition no longer rounds ${col} where this guard reads it`).not.toBeNull();
    return Number(m![1]);
  });
}

type Fixture = { missedOneBeyond1e6: number; columns: string[]; rows: unknown[][] };
const FIX = JSON.parse(readFileSync(resolve(__dirname, "fixtures/day30-rows-read-hourly-2026-11-16-to-18.json"), "utf8")) as Fixture;
const ROWS = FIX.rows.map((r) => Object.fromEntries(FIX.columns.map((c, i) => [c, r[i]])) as Day30Row & { read: string; category: string; sum_check_30: number });
const miss = (r: Day30Row) => Math.abs(Number(r.taken_down_30) + Number(r.relist_rate_30) + Number(r.still_open_30) - 1);

describe("the slack is the server's rounding, read from the live definitions", () => {
  for (const fn of ["get_category_fill_curve", "get_company_fill_curve"]) {
    it(`${fn} publishes the three shares at the page's decimals`, () => {
      const { file, sql } = liveDefinition(fn);
      expect(publishedDecimals(sql), `${file}`).toEqual([PUBLISHED_DECIMALS_30, PUBLISHED_DECIMALS_30, PUBLISHED_DECIMALS_30]);
    });
  }
  it("is the server's tolerance plus three half-units of the last published place, and no wider", () => {
    expect(IDENTITY_SLACK_30).toBeCloseTo(SUM_CHECK_TOLERANCE_30 + 0.00015, 12);
    expect(IDENTITY_SLACK_30).toBeLessThan(0.0002);
  });
});

describe("the rows the server called sufficient, read hourly 2026-11-16..18", () => {
  it("are the defect as it was read: every one passed the server's own sum, and some missed one by a rounding", () => {
    expect(ROWS.length).toBe(387);
    expect(ROWS.every((r) => r.sufficient_30 === true && r.sum_check_30 === 1)).toBe(true);
    const missed = ROWS.filter((r) => miss(r) > SUM_CHECK_TOLERANCE_30);
    expect(missed.length, "rows the old check refused").toBe(FIX.missedOneBeyond1e6);
    expect(missed.length).toBeGreaterThan(50);
    expect(Math.max(...ROWS.map(miss))).toBeLessThanOrEqual(IDENTITY_SLACK_30);
  });
  it("no row is refused as arithmetic, and every row refused at all names a term the row fails", () => {
    const verdicts = ROWS.map((r) => ({ r, v: day30Verdict(r) }));
    const arithmetic = verdicts.filter(({ v }) => v.state === "withheld" && v.reason === "arithmetic");
    expect(arithmetic.map(({ r }) => `${r.read} ${r.category}`)).toEqual([]);
    const published = verdicts.filter(({ v }) => v.state === "published").length;
    expect(published, "the rows a rounding no longer hides").toBeGreaterThan(ROWS.length * 0.8);
    for (const { r, v } of verdicts) {
      if (v.state !== "withheld") continue;
      if (v.reason === "relists") expect(Number(r.relists_30)).toBeGreaterThan(Number(r.fills_30));
    }
  });
});

describe("TEETH: the check still refuses what rounding cannot explain", () => {
  const dataAi = ROWS.find((r) => r.category === "data_ai" && r.read === "20261118T1035Z")!;
  it("data_ai as read at 10:35Z on 11-18, summing to 1.0001, publishes", () => {
    expect(dataAi, "the fixture holds the read").toBeDefined();
    expect([dataAi.still_open_30, dataAi.taken_down_30, dataAi.relist_rate_30]).toEqual([0.445, 0.4971, 0.058]);
    expect(miss(dataAi)).toBeGreaterThan(SUM_CHECK_TOLERANCE_30);
    expect(day30Verdict(dataAi).state).toBe("published");
  });
  it("the same row two units off in the last place, beyond three roundings, is refused as arithmetic", () => {
    const row = { ...dataAi, taken_down_30: 0.4972 };
    const v = day30Verdict(row);
    expect(v.state).toBe("withheld");
    expect(v.state === "withheld" && v.reason).toBe("arithmetic");
  });
});
