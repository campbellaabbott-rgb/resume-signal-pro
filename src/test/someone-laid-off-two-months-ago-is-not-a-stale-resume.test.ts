/**
 * SOMEONE LAID OFF TWO MONTHS AGO IS NOT A STALE RÉSUMÉ (register S10-007).
 *
 * The free scan's gap pre-check sorted the date ranges newest-first, took
 * the OLDEST end date as "the most recent role", and compared each role with
 * the next one in that order. Someone laid off two months ago was told their
 * last role "ended ~117 months ago", a real 19-month gap was never found, and
 * the prompt was told both were "confirmed from resume dates". "To date",
 * "Till date", "Présent", "heute", "actualidad" and "attuale" were not read as
 * a current role, and "05/2019 - 08/2022" was not read at all.
 *
 * Measured on 420 synthetic timelines written in real résumé date formats
 * (corpus in ~/.config/resumebooster/free-scan-wave-corpora/S10-007, truth
 * from the generator's timeline, plus two held-out seeds of 420): main wrong
 * on 270 (124 of them a false claim), the branch on none.
 *
 * Review fix (2026-11-01). The reviewer's four shipping probes all failed on
 * the branch: "Mar 2022 to date" (the separator took "to", leaving "date"),
 * "till date" the same way, "Sep 2023 – PresentSan Francisco" (a PDF glues
 * the next column on) and "Fall 2022 – Fall 2024" (a season was not a month,
 * so a degree's two years opened a 32-month gap). Seasons are now read as
 * their first month as a start and their last as an end, a seam between a
 * lower-case letter or digit and a capital is opened before ranges are read,
 * and "date" is a current role after "to", "till" or "until". On the
 * reviewer's corpus: to-date 2 → 60 of 60, till-date 6 → 60, glued present
 * 4 → 60 (main 32), glued end 15 → 60 (main 14), season degree 31 → 54 (main
 * 29); the builder's 420 stay 420 on three seeds. The fallback's timeline
 * card read "two years more than two apart" as a gap ("B.S. 2008 – 2012" and
 * "2016 – Present"): it now asks this reader, so the reviewer's 188 false
 * fallback gaps are 0 and the two scanners disagree on none of 296 résumés.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { detectEmploymentGaps, extractDateRanges, timelineGapOf } from "../../supabase/functions/free-keyword-scan/employment-gaps";
import { codeOf } from "./helpers/strip-comments";
import slice from "./fixtures/free-scan-wave/s10-007-employment-gaps.json";

const NOW = new Date(2026, 9, 31); // 31 Oct 2026, local time
const resume = (...lines: string[]) => ["Sam Lee | sam@example.com", "EXPERIENCE", ...lines, "EDUCATION", "BA History, State University"].join("\n");

describe("the audit's timelines", () => {
  it("laid off two months ago: not stale, and the latest end is the most recent role", () => {
    const r = detectEmploymentGaps(resume("Store Manager, Northwind | Mar 2021 – Aug 2026", "Assistant Manager, Northwind | Jan 2017 – Feb 2021", "Sales Associate, Globex | Jun 2014 – Dec 2016"), NOW);
    expect(r.isStale).toBe(false);
    expect([r.mostRecentEndYear, r.mostRecentEndMonth]).toEqual([2026, 7]);
    expect(r.gaps).toEqual([]);
  });

  it("a real 19-month gap is found, with the lines on each side", () => {
    const r = detectEmploymentGaps(resume("Accountant, Initech | Oct 2023 – Present", "Junior Accountant, Hooli | Jan 2019 – Mar 2022"), NOW);
    expect(r.gaps.map((g) => [g.startDate, g.endDate, g.gapMonths])).toEqual([["Mar 2022", "Oct 2023", 19]]);
    expect(r.gaps[0].between[0]).toContain("Hooli");
    expect(r.gaps[0].between[1]).toContain("Initech");
  });

  it("a role ended long ago with nothing current is stale", () => {
    const r = detectEmploymentGaps(resume("Teacher, Stark Schools | Sep 2018 – Jun 2023", "Teaching Assistant, Stark Schools | Sep 2016 – Jun 2018"), NOW);
    expect(r.isStale).toBe(true);
    expect(r.staleDuration).toBe("~40 months");
  });

  it("an overlapping role does not open a gap the longer one covers", () => {
    const r = detectEmploymentGaps(resume("Consultant | Jan 2016 – Present", "Adjunct Lecturer | Sep 2017 – May 2018", "Board Member | 2019 – 2021"), NOW);
    expect(r.gaps).toEqual([]);
  });

  it("a degree is time accounted for, and an expected one is current", () => {
    const r = detectEmploymentGaps(resume("Barista, Bean Co | Jun 2019 – Aug 2022", "BSc Nursing, State University, Sep 2022 – Expected May 2027"), NOW);
    expect(r.isStale).toBe(false);
    expect(r.gaps).toEqual([]);
  });

  it("a bare year starts in January and ends in December, so the page claims no gap", () => {
    expect(detectEmploymentGaps(resume("Driver | 2018 – 2021", "Loader | 2015 – 2017"), NOW).gaps).toEqual([]);
  });
});

describe("current roles in the words résumés use", () => {
  for (const word of ["Present", "Current", "To date", "Till date", "Présent", "heute", "actualidad", "attuale", "aktuell", "presente", "atual", "heden", "Now"]) {
    it(`"Jan 2020 – ${word}" is a current role`, () => {
      const r = extractDateRanges(`Analyst, Acme | Jan 2020 – ${word}`);
      expect(r).toHaveLength(1);
      expect(r[0].end).toBe("present");
    });
  }
});

describe("date formats", () => {
  const cases: Array<[string, [number, number], [number, number] | "present"]> = [
    ["05/2019 - 08/2022", [2019, 4], [2022, 7]],
    ["5/2019 – 8/2022", [2019, 4], [2022, 7]],
    ["05.2019 – 08.2022", [2019, 4], [2022, 7]],
    ["2019-05 - 2022-08", [2019, 4], [2022, 7]],
    ["2019-05-Present", [2019, 4], "present"],
    ["Sept. 2019 to March 2022", [2019, 8], [2022, 2]],
    ["janvier 2020 – décembre 2022", [2020, 0], [2022, 11]],
    ["März 2018 bis heute", [2018, 2], "present"],
    ["enero de 2020 – actualidad", [2020, 0], "present"],
    ["2015 – 2017", [2015, 0], [2017, 11]],
  ];
  for (const [text, start, end] of cases) {
    it(text, () => {
      const [r] = extractDateRanges(text);
      expect([r.start.year, r.start.month]).toEqual(start);
      expect(r.end === "present" ? "present" : [r.end.year, r.end.month]).toEqual(end);
    });
  }
  it("a two-digit year is never read as a year", () => {
    expect(extractDateRanges("05/19 - 08/22")).toEqual([]);
  });
});

describe("the corpus slice: synthetic timelines in real date formats", () => {
  const { now, cases } = slice as { now: { year: number; month: number }; cases: Array<{ id: string; text: string; gaps: string[]; stale: boolean; mainRight: boolean }> };
  const at = new Date(now.year, now.month, 15);
  it("holds at least 60 cases, most of them ones main got wrong", () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
    expect(cases.filter((c) => !c.mainRight).length).toBeGreaterThanOrEqual(45);
  });
  for (const c of cases) {
    it(`${c.id}: ${c.stale ? "stale" : "not stale"}, gaps [${c.gaps.join(", ")}]`, () => {
      const r = detectEmploymentGaps(c.text, at);
      expect(r.isStale).toBe(c.stale);
      expect(r.gaps.map((g) => `${g.startDate}→${g.endDate}`)).toEqual(c.gaps);
    });
  }
});

describe("the reviewer's shipping probes (SYNTHETIC résumés, labelled; review-ship-S10-007/probe.json)", () => {
  const probes: Array<{ id: string; text: string; stale: boolean; gaps: number }> = [
    { id: "ship-1", text: "Priya Sharma | priya@example.com\nEXPERIENCE\nOperations Manager, Northwind\nMar 2022 to date\nOperations Analyst, Contoso\nJun 2020 – Jan 2022\nEDUCATION\nB.Com., Delhi University, 2016 – 2020", stale: false, gaps: 0 },
    { id: "ship-2", text: "Priya Sharma | priya@example.com\nEXPERIENCE\nOperations Manager, Northwind\nNov 2021 till date\nOperations Analyst, Contoso\nSep 2020 – Nov 2021\nEDUCATION\nB.Com., Delhi University, 2016 – 2020", stale: false, gaps: 0 },
    { id: "ship-3", text: "Priya Sharma | priya@example.com\nEXPERIENCE\nOperations Manager, Northwind\nSep 2023 – PresentSan Francisco, CA\nOperations Analyst, Contoso\nMar 2022 – Jun 2023\nEDUCATION\nB.Com., Delhi University, 2018 – 2022", stale: false, gaps: 0 },
    { id: "ship-4", text: "Priya Sharma | priya@example.com\nEXPERIENCE\nOperations Manager, Northwind\nJan 2025 – Present\nOperations Analyst, Contoso\nMar 2019 – May 2022\nEDUCATION\nM.B.A., State University, Fall 2022 – Fall 2024", stale: false, gaps: 0 },
  ];
  for (const c of probes) {
    it(`${c.id}: not stale, no gap`, () => {
      const r = detectEmploymentGaps(c.text, NOW);
      expect(r.isStale).toBe(c.stale);
      expect(r.gaps).toHaveLength(c.gaps);
    });
  }
});

describe("dates as PDFs and résumés really write them (review fix)", () => {
  it('"to Date" and "till Date" are current roles; "Date" after a dash is not a date', () => {
    expect(extractDateRanges("Manager | June 2018 to Date")[0].end).toBe("present");
    expect(extractDateRanges("Manager | Nov 2021 till date")[0].end).toBe("present");
    expect(extractDateRanges("Manager | Nov 2021 until Date")[0].end).toBe("present");
    expect(extractDateRanges("Update date: Jan 2020")).toEqual([]);
  });
  it("a column glued on by a PDF does not hide the end", () => {
    expect(extractDateRanges("Sep 2023 – PresentSan Francisco, CA")[0].end).toBe("present");
    const [r] = extractDateRanges("Mar 2020 – Jan 2021Denver, CO");
    expect(r.end === "present" ? null : [r.end.year, r.end.month]).toEqual([2021, 0]);
  });
  it("a season is its first month as a start and its last as an end", () => {
    const [r] = extractDateRanges("Fall 2016 – Spring 2020");
    expect([r.start.year, r.start.month]).toEqual([2016, 8]);
    expect(r.end === "present" ? null : [r.end.year, r.end.month]).toEqual([2020, 4]);
    const [w] = extractDateRanges("Winter 2019 – Winter 2020");
    expect([w.start.month, w.end === "present" ? -1 : w.end.month]).toEqual([0, 11]);
  });
  it("an end that names no month still names its year", () => {
    const [r] = extractDateRanges("Jan 2018 – Mid 2020");
    expect(r.end === "present" ? null : [r.end.year, r.end.month]).toEqual([2020, 11]);
  });
  it("a degree written in seasons is time accounted for", () => {
    expect(detectEmploymentGaps(resume("Analyst, Contoso | Mar 2019 – May 2022", "Manager, Northwind | Jan 2025 – Present", "MBA, State University, Fall 2022 – Fall 2024"), NOW).gaps).toEqual([]);
  });
});

describe("the fallback's timeline card asks the same reader (review fix)", () => {
  it("the years inside one range are not a gap (a four-year degree, a role held since 2016)", () => {
    expect(timelineGapOf(resume("Analyst, Acme | 2016 – Present"), NOW)).toEqual({ hasGaps: false });
    expect(timelineGapOf("EXPERIENCE\nAnalyst, Acme | 2012 – Present\nEDUCATION\nB.S. Biology, 2008 – 2012", NOW)).toEqual({ hasGaps: false });
  });
  it("a real gap is the one the primary reports", () => {
    const text = resume("Accountant, Initech | Oct 2023 – Present", "Junior Accountant, Hooli | Jan 2019 – Mar 2022");
    expect(timelineGapOf(text, NOW)).toEqual({ hasGaps: true, gapNote: "Gap detected between Mar 2022 and Oct 2023" });
    expect(detectEmploymentGaps(text, NOW).gaps).toHaveLength(1);
  });
  it("the stream fork calls it and keeps no year-jump loop of its own", () => {
    const stream = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan-stream/index.ts"), "utf8"));
    expect(stream).toContain('import { timelineGapOf } from "./employment-gaps.ts";');
    expect(stream).toContain("timelineGapOf(resumeText)");
    expect(stream).not.toMatch(/years\[i\] - years\[i - 1\] > 2/);
  });
});

describe("the scanner reads the module", () => {
  const primary = readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/index.ts"), "utf8");
  it("index.ts imports detectEmploymentGaps and keeps no copy of its own", () => {
    expect(primary).toContain('import { detectEmploymentGaps, type GapAnalysis } from "./employment-gaps.ts";');
    expect(primary).not.toMatch(/function detectEmploymentGaps\(/);
    expect(primary).not.toMatch(/const MONTH_MAP\b/);
  });
});
