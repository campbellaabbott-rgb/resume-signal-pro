/**
 * A SALES ASSOCIATE IS NOT C-SUITE, AND "INCOME" IS NOT THE ARMY (register S13-009).
 *
 * The career-trajectory card and prompt ranked titles with includes() and a
 * `c: 7` key: every title holding the letter c ("Sales Associate",
 * "Coordinator", "Director" via "cto") ranked as C-suite, so ordinary
 * promotion histories read as "regression". Transition evidence was looked
 * for anywhere in the résumé: "nco" in "income", "ngo" in "ongoing",
 * "marines" in "submarines", and any volunteer line, "foundational" or Loan
 * Officer made the candidate "a career transitioner from military/nonprofit".
 *
 * Measured (corpus in ~/.config/resumebooster/free-scan-wave-corpora/S13-009):
 * 2,636 real titles, main wrong on 2,043, the branch on none; 320 synthetic
 * résumés from real titles and real posting sentences, main naming a
 * transition that was not there on 276, the branch on none.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeCareerTrajectory, extractSeniorityFromTitle } from "../../supabase/functions/free-keyword-scan/market-intelligence";
import slice from "./fixtures/free-scan-wave/s13-009-seniority-and-transition.json";

describe("the audit's retail history is a promotion", () => {
  const titles = ["Store Manager, Northwind", "Assistant Store Manager, Northwind", "Sales Associate, Northwind"];
  const text = ["EXPERIENCE", ...titles, "- Grew store income 12% while ongoing training ran", "- Volunteer, food bank"].join("\n");
  it("upward, no transition", () => {
    const t = analyzeCareerTrajectory(titles, "retail", text);
    expect(t.trajectory).toBe("upward");
    expect(t.industryTransitionDetected).toBe(false);
  });
});

describe("titles rank by their words", () => {
  const cases: Array<[string, number]> = [
    ["Sales Associate", 2], ["Program Coordinator", 2], ["Director of People & Talent", 4], ["Science Teacher", 2],
    ["Chief Financial Officer", 7], ["CTO", 7], ["Co-Founder", 7], ["VP of Sales", 5], ["SVP, Operations", 6],
    ["Sr Demand Planner", 3], ["Team Leader", 3], ["Board of Directors", 4], ["Projektmanager Marketing (m/w/d)", 4],
    ["Internal Auditor", 2], ["Headquarters Receptionist", 2], ["Staffing Coordinator", 2],
  ];
  for (const [t, r] of cases) it(`${t} → ${r}`, () => expect(extractSeniorityFromTitle(t)).toBe(r));
});

describe("a move from another field is read from the role lines, as words", () => {
  it("a Sergeant, U.S. Army line is a transition from the military", () => {
    const titles = ["Logistics Manager, Acme", "Sergeant, U.S. Army"];
    expect(analyzeCareerTrajectory(titles, "logistics", titles.join("\n")).fromIndustry).toBe("military");
  });
  it("submarines, foundational skills, a Loan Officer and a volunteer line are not", () => {
    const titles = ["Loan Officer, First Bank", "Teller, First Bank"];
    const text = [...titles, "Built foundational submarine-cable models", "Volunteer, animal shelter", "Grew income 9%"].join("\n");
    expect(analyzeCareerTrajectory(titles, "finance", text).industryTransitionDetected).toBe(false);
  });
});

describe("the corpus slice", () => {
  const s = slice as { titles: Array<{ title: string; rank: number; main: number }>; resumes: Array<{ id: string; roles: string[]; text: string; transitionFrom: string | null; main: string | null }> };
  it("holds at least 60 titles and 50 résumés, most of them ones main got wrong", () => {
    expect(s.titles.length).toBeGreaterThanOrEqual(60);
    expect(s.titles.filter((t) => t.main !== t.rank).length).toBeGreaterThanOrEqual(s.titles.length / 2);
    expect(s.resumes.length).toBeGreaterThanOrEqual(50);
  });
  for (const t of s.titles) it(`title "${t.title.slice(0, 60)}" → ${t.rank}`, () => expect(extractSeniorityFromTitle(t.title)).toBe(t.rank));
  for (const c of s.resumes) {
    it(`${c.id}: ${c.transitionFrom ?? "no transition"}`, () => {
      const r = analyzeCareerTrajectory(c.roles, "retail", c.text);
      expect(r.industryTransitionDetected ? r.fromIndustry : null).toBe(c.transitionFrom);
    });
  }
});

describe("the tables", () => {
  const src = readFileSync(resolve(__dirname, "../../supabase/functions/free-keyword-scan/market-intelligence.ts"), "utf8");
  it("no single-letter key and no includes() in the rank or transition tests", () => {
    expect(src).not.toMatch(/evp: 6,\s*c: 7/);
    expect(src).not.toMatch(/lower\.includes\(kw\) && r > rank/);
    expect(src).not.toMatch(/lowerText\.includes\(k\)/);
  });
});
