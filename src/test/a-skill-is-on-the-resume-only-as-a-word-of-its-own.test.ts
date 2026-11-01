/**
 * A SKILL IS ON THE RÉSUMÉ ONLY AS A WORD OF ITS OWN (register S13-004).
 *
 * The free scan asked "is this keyword on the résumé?" with includes(). Java
 * was found in "JavaScript", Git in "digital", Excel in "excellence", ML and
 * Machine Learning in "HTML", UI and User Interface in "build", Deep Learning
 * in "handled" and AWS in "award" (a plural strip cut "aws" to "aw"). Those
 * real gaps vanished from the keyword card, were kept out of the prompt's
 * "verified absent" list, and the model was told the skills were there. The
 * stream fork's own table read "ts" in "results" as TypeScript, "git" as
 * GitHub and "rest" in "interest" as REST API.
 *
 * Measured on 4,032 cases of real posting text before the change (corpus in
 * ~/.config/resumebooster/free-scan-wave-corpora/S13-004): main wrong on
 * 1,463, the branch on none. A slice of it is the fixture below.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { phraseMatchesResume, resumeHasTerm } from "../../supabase/functions/free-keyword-scan/market-intelligence";
import slice from "./fixtures/free-scan-wave/s13-004-keyword-presence.json";

const AUDIT_RESUME = "Built responsive pages in HTML, CSS and JavaScript at a digital agency. Handled deadlines. Won an award for excellence.";

describe("the audit's résumé keeps its real gaps", () => {
  for (const kw of ["Java", "Git", "Excel", "ML", "Machine Learning", "UI", "User Interface", "Deep Learning", "AWS", "Python"]) {
    it(`${kw} is missing`, () => expect(phraseMatchesResume(kw, AUDIT_RESUME)).toBe(false));
  }
  for (const kw of ["HTML", "CSS", "JavaScript"]) {
    it(`${kw} is there`, () => expect(phraseMatchesResume(kw, AUDIT_RESUME)).toBe(true));
  }
});

describe("the stream fork's old variations are not the skill", () => {
  const MARKETING = "Drove results for clients across digital channels. Built interest with a CRM-led nurture programme. Ran TS/SCI-cleared events.";
  for (const kw of ["TypeScript", "GitHub", "REST API", "Salesforce"]) {
    it(`${kw} is missing`, () => expect(phraseMatchesResume(kw, MARKETING)).toBe(false));
  }
});

describe("spellings of the same skill still count", () => {
  const cases: Array<[string, string, boolean]> = [
    ["Built KPIs dashboards", "KPI", true],
    ["Coordinated product launches", "product launch", true],
    ["Refreshed our strategies", "strategy", true],
    ["Shipped REST APIs", "REST API", true],
    ["Ran K8s clusters", "Kubernetes", true],
    ["Amazon Web Services certified", "AWS", true],
    ["full-stack engineer", "Full Stack", true],
    ["CI-CD pipelines", "CI/CD", true],
    ["machine\nlearning models", "Machine Learning", true],
    ["Node.js services", "Node", true],
    ["ASP.NET MVC", ".NET", true],
    ["C++17 and Python", "C++", true],
    ["Python, R and SQL", "R", true],
    // ... and look-alikes do not
    ["Led R&D for thin films", "R", false],
    ["Briefed the C-suite", "C", false],
    ["Wrote C++ only", "C", false],
    ["DCFS regulations", "DCF", false],
    ["Familiar with IFRS", "IFR", false],
    ["Read P&IDs", "IDS", false],
    ["Managed budgeting cycles", "budget", false],
  ];
  for (const [text, kw, want] of cases) it(`${JSON.stringify(text)} → ${kw}: ${want}`, () => expect(resumeHasTerm(text, kw)).toBe(want));
});

describe("a plural is stripped only when four letters stay", () => {
  it("AWS keeps its s, APIs and KPIs are not stripped to three letters", () => {
    expect(resumeHasTerm("Won an award under state laws", "AWS")).toBe(false);
    expect(resumeHasTerm("Designed an API", "APIs")).toBe(false);
    expect(resumeHasTerm("Owned the KPI review", "KPIs")).toBe(false);
    expect(resumeHasTerm("Closed new accounts", "account")).toBe(true);
  });
});

describe("the corpus slice: real posting text, labelled", () => {
  const cases = (slice as { cases: Array<{ keyword: string; text: string; present: boolean; main: boolean }> }).cases;
  it("holds at least 60 cases, most of them ones main got wrong", () => {
    expect(cases.length).toBeGreaterThanOrEqual(60);
    expect(cases.filter((c) => c.main !== c.present).length).toBeGreaterThanOrEqual(45);
  });
  for (const c of cases) {
    it(`${c.keyword}: ${c.present ? "present" : "absent"} in "${c.text.slice(0, 50)}…"`, () => {
      expect(phraseMatchesResume(c.keyword, c.text)).toBe(c.present);
    });
  }
});

describe("one presence test everywhere", () => {
  const root = resolve(__dirname, "../../supabase/functions");
  const primary = readFileSync(resolve(root, "free-keyword-scan/index.ts"), "utf8");
  const stream = readFileSync(resolve(root, "free-keyword-scan-stream/index.ts"), "utf8");
  it("the primary's gap filter, verified-absent list and rule scores read resumeHasTerm, never includes()", () => {
    expect(primary).not.toMatch(/normalizedResumeText\.includes|resumeLowerForGaps\.includes|primary\.filter\([^)]*lower\.includes/);
    expect(primary.match(/resumeHasTerm\(resumeText/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
  });
  it("the stream fork's variations table is gone and its filters use the same test", () => {
    expect(stream).not.toMatch(/const variations: Record<string, string\[\]>/);
    expect(stream).not.toMatch(/resumeLower\.includes/);
    expect(stream).toContain("phraseMatchesResume(keyword, resumeText)");
    expect(stream).toContain("resumeHasTerm(resumeText, kw.keyword)");
  });
  it("cached reports refresh: the engine version moved", () => {
    const version = primary.match(/const REPORT_ENGINE_VERSION = '([^']+)'/)?.[1];
    expect(version).toBeTruthy();
    expect(version).not.toBe(["scan", "v2026-10-09-s11"].join("-"));
    expect(stream).toMatch(/const cacheInput = `v7\|/);
  });
});
