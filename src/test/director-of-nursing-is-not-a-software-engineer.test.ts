/**
 * DIRECTOR OF NURSING IS NOT A SOFTWARE ENGINEER (register S13-092).
 *
 * The report's "Industry & Role Keywords" section matched by raw substring.
 * findRoleConfig's partial pass tested nw.includes(word) || word.includes(nw),
 * so "software".includes("of") gave every "Director of Nursing" and "VP of
 * Sales" the Software Engineer card ("missing Code Review, Unit Testing"), the
 * lone "I" in "Assembler I" did the same through "engineer", and the alias
 * "dev" caught every "Business Development Manager". analyzeKeywordPresence
 * ticked Git present from "digital", REST from "interested", AWS from "laws",
 * Excel from "excellent" and R from any "r".
 *
 * Both cards now read words with the scanner's own presence test
 * (term-presence.ts, shared with both scan forks). A title names a config
 * when it holds the config's title or an alias as a phrase, or every word of
 * the config's title; the longest name wins; otherwise there is no card.
 *
 * Measured (corpus in ~/.config/resumebooster/free-scan-wave-corpora/S13-092):
 *   titles: 2,636 real job titles, 1,426 disagreements labelled. Main right
 *     on 1,224, the branch on 2,611. Main claimed a card for 1,731 titles,
 *     the branch for 450.
 *   keywords: 3,333 real-posting disagreements across all 56 industry
 *     configs. Main right on 1, the branch on 3,332.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeRoleKeywords, findRoleConfig } from "@/config/role-keywords";
import { analyzeKeywordPresence } from "@/config/industry-keywords";
import slice from "./fixtures/free-scan-wave/s13-092-role-and-industry-cards.json";

const card = (title: string) => findRoleConfig(title)?.title ?? null;
const presentIn = (industry: string, text: string) => analyzeKeywordPresence(industry, text).present.map((k) => k.keyword);

describe("the audit's titles", () => {
  it("a nurse leader, a sales VP and a business developer get no Software Engineer card", () => {
    expect(card("Director of Nursing")).toBeNull();
    expect(card("VP of Sales")).not.toBe("Software Engineer");
    expect(card("Business Development Manager")).toBeNull();
    expect(card("Learning and Development Specialist")).toBeNull();
    expect(card("Assembler I")).toBeNull();
  });
  it("Head of Customer Success gets the Customer Success card", () => {
    expect(card("Head of Customer Success")).toBe("Customer Success Manager");
  });
});

describe("a title names a config by a phrase or every word of its title, and the longest name wins", () => {
  const cases: Array<[string, string | null]> = [
    ["Senior Data Analyst - Enterprise Services", "Data Analyst"],
    ["Store Manager", null],
    ["Senior Interior Designer", null],
    ["UX Design Associate", "UX Designer"],
    ["Senior Backend Developer", "Backend Developer"],
    ["Salesforce Developer", "Software Engineer"],
    ["Web Developer (Full Stack)", "Frontend Developer"],
    ["Product Marketing Manager", "Marketing Manager"],
    ["Senior Product Manager, AI", "Product Manager"],
    ["Human Resources Business Partner II", "HR Business Partner"],
    ["Senior Recruiter, GTM, EMEA", "Recruiter"],
    ["Stationary Engineer", null],
  ];
  for (const [title, want] of cases) it(`${title} → ${want ?? "no card"}`, () => expect(card(title)).toBe(want));
});

describe("the keyword cards read words", () => {
  it("digital, interested, laws, excellent and interpersonal hold no Git, REST, AWS, Excel or ERP", () => {
    const text = "Excellent interpersonal skills, digital literacy, interested in IT support, compliance with all laws.";
    const found = [...presentIn("technology", text), ...presentIn("manufacturing", text), ...presentIn("finance", text)];
    for (const k of ["Git", "REST", "AWS", "Excel", "ERP"]) expect(found).not.toContain(k);
  });
  it("R&D is not the R language; a word of its own is still found in its spellings", () => {
    expect(presentIn("data_science", "Led R&D programs.")).not.toContain("R");
    expect(presentIn("data_science", "Python, R and SQL.")).toContain("R");
  });
  it("the role card uses the same test", () => {
    const { present, missing } = analyzeRoleKeywords("Software Engineer", "Ran the version-control migration; wrote unit tests; excellent debugging.");
    expect(present.map((k) => k.keyword)).toEqual(expect.arrayContaining(["Version Control", "Debugging"]));
    expect(missing.map((k) => k.keyword)).toContain("Code Review");
  });
});

describe("the corpus slice", () => {
  const s = slice as { titles: Array<{ title: string; config: string | null; main: string | null }>; keywords: Array<{ industry: string; keyword: string; text: string; present: boolean; main: boolean }> };
  it("holds at least 80 titles and 40 keyword windows, most of them ones main got wrong", () => {
    expect(s.titles.length).toBeGreaterThanOrEqual(80);
    expect(s.titles.filter((t) => t.main !== t.config).length).toBeGreaterThanOrEqual(s.titles.length / 2);
    expect(s.keywords.length).toBeGreaterThanOrEqual(40);
    expect(s.keywords.filter((k) => k.main !== k.present).length).toBeGreaterThanOrEqual(s.keywords.length / 2);
  });
  for (const t of s.titles) it(`title "${t.title.slice(0, 60)}" → ${t.config ?? "no card"}`, () => expect(card(t.title)).toBe(t.config));
  for (const k of s.keywords) {
    it(`${k.industry} ${k.keyword} ${k.present ? "on" : "not on"} "${k.text.slice(0, 50)}"`, () => {
      expect(presentIn(k.industry, k.text).includes(k.keyword)).toBe(k.present);
    });
  }
});

describe("one presence test", () => {
  const root = resolve(__dirname, "../../supabase/functions");
  it("term-presence.ts is the same file in both scan forks, and market-intelligence takes it from there", () => {
    const primary = readFileSync(resolve(root, "free-keyword-scan/term-presence.ts"), "utf8");
    expect(readFileSync(resolve(root, "free-keyword-scan-stream/term-presence.ts"), "utf8")).toBe(primary);
    for (const fork of ["free-keyword-scan", "free-keyword-scan-stream"]) {
      const mi = readFileSync(resolve(root, `${fork}/market-intelligence.ts`), "utf8");
      expect(mi).toContain("from './term-presence.ts'");
      expect(mi).not.toMatch(/function presencePattern\(/);
    }
  });
  it("the cards keep no includes() of their own", () => {
    const src = resolve(__dirname, "../config");
    expect(readFileSync(resolve(src, "role-keywords.ts"), "utf8")).not.toMatch(/normalized\.includes\(alias\)|nw\.includes\(word\)/);
    expect(readFileSync(resolve(src, "industry-keywords.ts"), "utf8")).not.toMatch(/normalizedResume\.includes\(/);
  });
});
