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
 *
 * Review fix (2026-11-01). The branch built one Unicode pattern per term and
 * kept every one of them (a cold scan cost 0.5-0.85 s and ~246 MB of heap
 * that was never given back); the test is now plain indexOf over the text,
 * read once, with only the last four texts kept (5-8 ms cold, 0.1 MB). Over
 * 1,206,744 term/posting pairs of both corpora the rewrite reads 59 pairs
 * differently from the branch, every one of them an acronym's plural. And the
 * branch read "APIs" as missing where the page said "API", "LLMs" where it
 * said "LLM": the reviewer's adjudication found 36 such false gaps. An
 * acronym's plural is now read back to its singular when it is known to be a
 * plural: three capitals and a lower-case s, or one of the reviewed table
 * entries ("apis", "llms", "slos"...); an S that is a letter of its own
 * (ACLS, PALS, FCAS, eNPS) stays a letter.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { phraseMatchesResume, resumeHasTerm } from "../../supabase/functions/free-keyword-scan/market-intelligence";
import { TABLE_PLURAL_ACRONYMS, presenceCacheSize } from "../../supabase/functions/free-keyword-scan/term-presence";
import { codeOf } from "./helpers/strip-comments";
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
  it("AWS keeps its s; a word's plural is read back only to four letters or more", () => {
    expect(resumeHasTerm("Won an award under state laws", "AWS")).toBe(false);
    expect(resumeHasTerm("Closed new accounts", "account")).toBe(true);
    expect(resumeHasTerm("Fixed the bus lanes", "buses")).toBe(false);
  });
});

describe("an acronym's plural is on the page where its singular is (review fix)", () => {
  // The first five are real contexts from the reviewer's adjudication
  // (review-S13-004/adjudicated.json, branchWorse_acronymPlural).
  const cases: Array<[string, string, boolean]> = [
    ["familiarity with the AI/LLM product landscape", "llms", true],
    ["add LLM-assisted and highly controlled review", "llms", true],
    ["reporting packages, and KPI dashboards without external help", "kpis", true],
    ["shipped 100+ LLM applications", "LLMs", true],
    ["Designed an API", "APIs", true],
    ["Owned the KPI review", "KPIs", true],
    ["Answered every RFI within a day", "rfis", true],
    ["Set the SLO for checkout", "slos", true],
    ["Wrote the team OKR drafts", "okrs", true],
    // ... an S that is a letter of its own stays a letter
    ["top-tier venues (NeurIPS, ICML, ICLR, ACL, EMNLP)", "ACLS", false],
    ["update a Property Activity Log (PAL) for each vacant property", "pals", false],
    ["the requirements of the Fair Chance Act (FCA)", "fcas", false],
    ["Ran the NPS survey", "eNPS", false],
    // ... and a two-letter stem is too ambiguous to read back
    ["Opened 12 PR reviews", "PRs", false],
  ];
  for (const [text, kw, want] of cases) it(`${JSON.stringify(text)} → ${kw}: ${want}`, () => expect(resumeHasTerm(text, kw)).toBe(want));
});

describe("every lower-case acronym plural in the scanners' tables is read one way or the other", () => {
  // Words, and acronyms whose S is a letter of their own: never read back.
  const NOT_A_PLURAL = new Set([
    "acas", "acls", "ains", "airs", "bcps", "cims", "cips", "cmms", "cscs", "ctms", "cuts", "dans", "enps", "fcas",
    "hris", "hrms", "ifrs", "kurs", "laws", "lims", "mlis", "news", "nmls", "pacs", "pals", "pbis", "roas", "ross",
    "saas", "spss", "this", "usds",
  ]);
  const root = resolve(__dirname, "../../supabase/functions");
  const found = new Set<string>();
  for (const dir of ["free-keyword-scan", "free-keyword-scan-stream"]) {
    for (const f of readdirSync(resolve(root, dir)).filter((n) => n.endsWith(".ts") && n !== "term-presence.ts")) {
      for (const m of codeOf(readFileSync(resolve(root, dir, f), "utf8")).matchAll(/['"]([a-z]{3}s)['"]/g)) found.add(m[1]);
    }
  }
  it("finds the tables' entries of that shape", () => expect(found.size).toBeGreaterThanOrEqual(30));
  for (const entry of [...found].sort()) {
    it(entry, () => expect(TABLE_PLURAL_ACRONYMS.has(entry) !== NOT_A_PLURAL.has(entry)).toBe(true));
  }
});

describe("the presence test builds nothing per term and keeps nothing per text", () => {
  const RESUME = Array.from({ length: 400 }, (_, i) => `Led project ${i} with SQL, Python and stakeholder reviews across teams.`).join(" ");
  it("2,000 distinct terms against one 28,000-character résumé take well under a second", () => {
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) resumeHasTerm(RESUME, `skill${i} platform`);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
  it("only the last few texts are kept", () => {
    for (let i = 0; i < 50; i++) resumeHasTerm(`${RESUME} ${i}`, "SQL");
    expect(presenceCacheSize()).toBeLessThanOrEqual(4);
  });
  it("no pattern is compiled per term", () => {
    const src = codeOf(readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/term-presence.ts"), "utf8"));
    expect(src).not.toMatch(/new RegExp\(|RegExp\(/);
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
