/**
 * A MAY 2019 START DATE IS NOT AN IMPOSSIBLE TIMELINE (register S13-022).
 *
 * The fallback scanner read "05/2019 - 08/2022" as "2019 - 08", took the
 * month after the slash for a two-digit year (2008), and put "end date before
 * start date" at the top of the report as a HIGH-priority credibility flag.
 * "2023 - 2027 (expected)" was "contains future year", a degree held beside a
 * teaching job and a business run beside a lecturing role were "significant
 * overlap between roles".
 *
 * Measured on 400 synthetic timelines in real résumé date formats with
 * injected faults (corpus in
 * ~/.config/resumebooster/free-scan-wave-corpora/S13-022, truth from the
 * generator's numbers, plus two held-out seeds of 400): main wrong on 179,
 * 148 of them a false flag; the branch on none.
 *
 * Review fix (2026-11-01). On the reviewer's 360 synthetic timelines the
 * branch missed every reversed or future range glued to the next column by a
 * PDF ("Jun 2027 – Jan 2024Denver, CO": 0 of 24 each, main 24) and every
 * one written in seasons (0 of 24, main 0). The shared reader now opens the
 * seam and reads seasons: 24 of 24 in all four, clean timelines still clean.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectCredibilityIssues } from "../../supabase/functions/free-keyword-scan-stream/date-credibility";
import slice from "./fixtures/free-scan-wave/s13-022-date-credibility.json";

const NOW = new Date(2026, 9, 31);
const types = (text: string) => [...new Set(detectCredibilityIssues(text, NOW).map((i) => i.type))].sort();

describe("the audit's résumés raise nothing", () => {
  it("MM/YYYY dates", () => expect(types("Analyst, Acme | 05/2019 - 08/2022\nClerk, Globex | 01/2016 - 04/2019")).toEqual([]));
  it("an expected graduation", () => expect(types("EDUCATION\nBSc Biology, State University, 2023 - 2027 (expected)")).toEqual([]));
  it("a degree held beside a teaching-assistant job", () => {
    expect(types("EXPERIENCE\nTeaching Assistant, State University | 2015 - 2018\nEDUCATION\nBA English, State University, 2014 - 2018")).toEqual([]);
  });
  it("a business run since 2012 beside a lecturing role", () => {
    expect(types("EXPERIENCE\nOwner, Rivera Tutoring | 2012 - Present\nLecturer, City College | 2015 - 2021")).toEqual([]);
  });
});

describe("real date faults are still flagged", () => {
  it("a range that ends before it starts", () => expect(types("Analyst, Acme | Mar 2022 – Jan 2019")).toEqual(["impossible_timeline"]));
  it("a start decades away", () => expect(types("Analyst, Acme | Jan 2052 – Present")).toEqual(["date_inconsistency"]));
  it("two finished roles overlapping by three years or more", () => {
    expect(types("EXPERIENCE\nManager, Acme | Jan 2012 – Dec 2018\nConsultant, Globex | Jan 2014 – Jun 2020")).toEqual(["timeline_overlap"]);
  });
});

describe("glued and season-written faults are flagged (review fix; SYNTHETIC, review-S13-022/corpus.json)", () => {
  const cv = (top: string, next: string) => `EXPERIENCE\nSenior Analyst, Northwind\n${top}\n- Built reports\nAnalyst, Contoso\n${next}\n- Reconciled ledgers\nEDUCATION\nB.S. Accounting, State University`;
  it("reversed, glued", () => expect(types(cv("Jun 2027 – Jan 2024Denver, CO", "Apr 2022 – Nov 2023"))).toContain("impossible_timeline"));
  it("future, glued", () => expect(types(cv("Nov 2055 – Jun 2057Denver, CO", "Apr 2023 – Apr 2025"))).toContain("date_inconsistency"));
  it("reversed, seasons", () => expect(types(cv("Spring 2025 – Fall 2022", "Fall 2020 – Summer 2022"))).toContain("impossible_timeline"));
  it("future, seasons", () => expect(types(cv("Fall 2066 – Winter 2068", "Summer 2021 – Fall 2023"))).toContain("date_inconsistency"));
  it("clean, glued and seasons", () => {
    expect(types(cv("May 2024 – Jul 2026Denver, CO", "Jan 2023 – Apr 2024"))).toEqual([]);
    expect(types(cv("Fall 2022 – Winter 2024", "Spring 2021 – Summer 2022"))).toEqual([]);
  });
});

describe("the corpus slice: synthetic timelines with injected faults", () => {
  const { now, cases } = slice as { now: { year: number; month: number }; cases: Array<{ id: string; text: string; truth: string[]; mainRight: boolean }> };
  const at = new Date(now.year, now.month, 15);
  it("holds at least 80 cases, half of them ones main got wrong", () => {
    expect(cases.length).toBeGreaterThanOrEqual(80);
    expect(cases.filter((c) => !c.mainRight).length).toBeGreaterThanOrEqual(cases.length / 2);
  });
  for (const c of cases) {
    it(`${c.id}: [${c.truth.join(", ")}]`, () => {
      expect([...new Set(detectCredibilityIssues(c.text, at).map((i) => i.type))].sort()).toEqual(c.truth);
    });
  }
});

describe("the fallback reads dates with the primary's reader", () => {
  const root = resolve(__dirname, "../../supabase/functions");
  const stream = readFileSync(resolve(root, "free-keyword-scan-stream/index.ts"), "utf8");
  it("the stream fork imports the module and keeps no date pattern of its own", () => {
    expect(stream).toContain('import { detectCredibilityIssues } from "./date-credibility.ts";');
    expect(stream).not.toMatch(/function detectCredibilityIssues\(/);
    // the old pattern took a two-digit token after a dash for a year
    expect(stream).not.toMatch(/'\?\(\\d\{4\}\|\\d\{2\}\|present\|current\|now\)/);
  });
  it("employment-gaps.ts is the same file in both forks, byte for byte", () => {
    expect(readFileSync(resolve(root, "free-keyword-scan-stream/employment-gaps.ts"), "utf8"))
      .toBe(readFileSync(resolve(root, "free-keyword-scan/employment-gaps.ts"), "utf8"));
  });
});
