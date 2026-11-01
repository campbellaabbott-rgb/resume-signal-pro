/**
 * THE FREE SCAN HOLDS ON A THIRD CORPUS (the recheck of 2026-11-01).
 *
 * The free scan's review round was measured on two corpora: the builder's and
 * the reviewer's. A third, gathered for the recheck from sources neither had
 * used, found the places where the fixes were still worse than main or made
 * claims main did not:
 *
 *   S10-007  a Portuguese LinkedIn export ("o momento") read as a stale résumé;
 *   S13-022  apostrophe years ("Mar '21") were never read;
 *   S10-006  version floors ("Windows 7+"), street numbers ("48 rue"), "360",
 *            code cites and "201 files" were metrics; "Salary Range: 125k –
 *            165k" and "Grew revenue 20M to 50M" were not;
 *   S13-004  plurals that are other words ("futures", "dynamics", "customs")
 *            were read back to their singulars; "check-ins", "P&IDs" and
 *            "auditorías" were not read at all;
 *   S13-005  a posting link percent-encoded inside a redirect named no system;
 *   S13-009  "Marine Engineer", "City of Hope" and a "Business Administration"
 *            degree line made transitions; the FBI, FEMA, FDIC, "The Bill and
 *            Melinda Gates Foundation", "Postdoctoral" and "PhD Candidate"
 *            lost theirs; "Staff+" and "Teamleader" lost their rank;
 *   S13-092  "Back-end Engineer", "Software Architect", "Sales Supervisor",
 *            "Data & Analytics Lead" and "… Lead RC377" lost their cards;
 *   S13-024  Bulgarian and Serbian were named Russian, Malay Indonesian, and
 *            Spanish and Portuguese prose was told the report does not cover it.
 *
 * Every class is fixed and each heuristic was re-measured on all three
 * corpora (~/.config/resumebooster/free-scan-wave-corpora, fix3/). This file
 * holds a slice of the third corpus (fixtures/free-scan-wave/
 * recheck-third-corpus.json: real texts, except the gaps and credibility
 * résumés, which are synthetic in real export formats) and the named cases.
 */
import { describe, expect, it } from "vitest";
import slice from "./fixtures/free-scan-wave/recheck-third-corpus.json";
import { detectResumeLanguage } from "../../supabase/functions/free-keyword-scan/resume-language";
import { detectEmploymentGaps } from "../../supabase/functions/free-keyword-scan/employment-gaps";
import { detectCredibilityIssues } from "../../supabase/functions/free-keyword-scan-stream/date-credibility";
import { metricEvidence } from "../../supabase/functions/free-keyword-scan/bullet-metrics";
import { resumeHasTerm } from "../../supabase/functions/free-keyword-scan/term-presence";
import { analyzeCareerTrajectory, detectAtsSystem, extractSeniorityFromTitle } from "../../supabase/functions/free-keyword-scan/market-intelligence";
import { findRoleConfig } from "@/config/role-keywords";

const NOW = new Date(2026, 10, 1);
type S = typeof slice;

describe("the slice", () => {
  it("holds every heuristic's cases", () => {
    expect(slice.language.length).toBeGreaterThanOrEqual(50);
    expect(slice.gaps.length).toBeGreaterThanOrEqual(30);
    expect(slice.credibility.length).toBeGreaterThanOrEqual(20);
    expect(slice.metrics.length).toBeGreaterThanOrEqual(90);
    expect(slice.presence.length).toBeGreaterThanOrEqual(30);
    expect(slice.roles.length).toBeGreaterThanOrEqual(50);
    expect(slice.ranks.length).toBeGreaterThanOrEqual(40);
  });
});

describe("S13-024: the language a text is written in", () => {
  for (const c of slice.language as S["language"]) {
    it(`${c.group} ${c.id.slice(0, 40)} → ${c.expected}`, () => expect(detectResumeLanguage(c.text).language).toBe(c.expected));
  }
});

describe("S10-007: gaps and staleness in real export formats (synthetic résumés)", () => {
  for (const c of slice.gaps as S["gaps"]) {
    it(`${c.format} ${c.timeline}`, () => {
      const g = detectEmploymentGaps(c.text, NOW);
      expect({ gap: g.gaps.length > 0, stale: g.isStale }).toEqual(c.truth);
    });
  }
  it("a Portuguese LinkedIn export's current role is current", () => {
    const text = "EXPERIÊNCIA\nAnalista Sênior\nNorthwind\njaneiro de 2019 - o momento (7 anos 10 meses)\nAnalista\nContoso\nfevereiro de 2015 - dezembro de 2018";
    expect(detectEmploymentGaps(text, NOW).isStale).toBe(false);
  });
});

describe("S13-022: the fallback's date flags (synthetic résumés)", () => {
  for (const c of slice.credibility as S["credibility"]) {
    it(`${c.format} ${c.case}`, () => {
      expect(detectCredibilityIssues(c.text, NOW).map((i) => `${i.severity}:${i.type}`).sort()).toEqual(c.expected);
    });
  }
  it("a reversed apostrophe range is impossible; an expected degree is not", () => {
    expect(detectCredibilityIssues("EXPERIENCE\nAnalyst, Contoso\nMar '21 – Jan '19", NOW).map((i) => i.type)).toContain("impossible_timeline");
    expect(detectCredibilityIssues("EDUCATION\nB.Sc., University of Leeds\nSep '24 – Expected '28", NOW)).toEqual([]);
  });
});

describe("S10-006: what counts as a number of the reader's own", () => {
  for (const c of slice.metrics as S["metrics"]) {
    it(`${c.kind}: ${c.text.slice(0, 60)}`, () => expect(metricEvidence(c.text) !== null).toBe(c.expected));
  }
  const named: Array<[string, boolean]> = [
    ["Requires Windows 7+ and Angular 6+", false], ["Next.js 13+ experience", false], ["A 360 recruitment role", false],
    ["Office at 48 rue de Rivoli", false], ["Compliance with 14 CFR part 120", false], ["Horario de 9 a 13 hs", false],
    ["Maintain 201 files and other employee records", false],
    ["Managed accounts with 20M-50M revenue", true], ["Salary Range: 125k – 165k", true], ["Grew revenue 20M to 50M", true],
    ["Have 2+ years of professional experience", true], ["Typically 3+ years' related experience.", true],
    ["Experience: Ideally 1+ years of experience", true], ["Managed 5+ direct reports", true],
  ];
  for (const [text, want] of named) it(`${JSON.stringify(text)} → ${want}`, () => expect(metricEvidence(text) !== null).toBe(want));
});

describe("S13-004: a plural that is another word is read as written", () => {
  for (const c of slice.presence as S["presence"]) {
    it(`${c.term} in "${c.text.slice(0, 50)}" → ${c.expected}`, () => expect(resumeHasTerm(c.text, c.term)).toBe(c.expected));
  }
  const named: Array<[string, string, boolean]> = [
    ["web application security", "securities", false], ["daily standups", "dailies", false], ["the future of insurance", "futures", false],
    ["a dynamic environment", "dynamics", false], ["custom software", "customs", false], ["design in Canva", "canvas", false],
    ["traded futures and options", "futures", true], ["Microsoft Dynamics 365", "dynamics", true], ["cleared goods through customs", "customs", true],
    ["Marine Engineer", "marines", false],
  ];
  for (const [text, term, want] of named) it(`${term} in "${text}" → ${want}`, () => expect(resumeHasTerm(text, term)).toBe(want));
});

describe("S13-005: a posting link wrapped by a redirect still names its system", () => {
  it("percent-encoded inside a safelinks or LinkedIn redirect", () => {
    expect(detectAtsSystem("Apply: https://www.linkedin.com/redir/redirect?url=https%3A%2F%2Fjobs.smartrecruiters.com%2FAcme%2F744000-analyst")).toBe("smartrecruiters");
    expect(detectAtsSystem("https://nam02.safelinks.protection.outlook.com/?url=https%3A%2F%2Fboards.greenhouse.io%2Facme%2Fjobs%2F123&data=x")).toBe("greenhouse");
  });
  it("a bare word is still not a system", () => {
    expect(detectAtsSystem("We use smart recruiters and a greenhouse on site.")).toBe("unknown");
  });
});

describe("S13-009: a move from another field, on real employer names", () => {
  const move = (oldTitle: string, employer: string, target = "technology", edu: string[] = []) => {
    const titles = ["Senior Software Engineer, Datadog", `${oldTitle}, ${employer}`];
    const text = ["EXPERIENCE", "Senior Software Engineer, Datadog", "- Built a metrics pipeline", `${oldTitle}, ${employer}`, "- Reviewed 300 case files", ...edu].join("\n");
    const t = analyzeCareerTrajectory(titles, target, text);
    return t.industryTransitionDetected ? t.fromIndustry : null;
  };
  const cases: Array<[string, string, string | null]> = [
    ["Program Analyst", "Federal Bureau of Investigation", "government"],
    ["Emergency Management Specialist", "Federal Emergency Management Agency", "government"],
    ["Bank Examiner", "Federal Deposit Insurance Corporation", "government"],
    ["Campaign Manager", "The Bill and Melinda Gates Foundation", "nonprofit"],
    ["Program Officer", "Bill & Melinda Gates Foundation", "nonprofit"],
    ["Postdoctoral Researcher", "ETH Zurich", "academia"],
    ["PhD Candidate", "University of Toronto", "academia"],
    ["Intelligence Officer", "Israel Defense Forces", "military"],
    ["Marine Engineer", "Maersk Line", null],
    ["Marine Biologist", "SeaWorld Parks & Entertainment", null],
    ["Registered Nurse", "City of Hope", null],
    ["Data Analyst", "State Street", null],
  ];
  for (const [title, employer, want] of cases) it(`${title}, ${employer} → ${want}`, () => expect(move(title, employer)).toBe(want));
  it("a Business Administration degree line is not a government employer", () => {
    expect(move("Data Analyst", "State Street", "technology", ["EDUCATION", "Bachelor of Science", "Business Administration", "University of Florida | 2008 – 2012"])).toBe(null);
  });
});

describe("S13-009: rank", () => {
  for (const c of slice.ranks as S["ranks"]) it(`${c.title} → ${c.expected}`, () => expect(extractSeniorityFromTitle(c.title)).toBe(c.expected));
});

describe("S13-092: the role card a real title gets", () => {
  for (const c of slice.roles as S["roles"]) {
    it(`${c.title.slice(0, 60)} → ${c.expected}`, () => expect(findRoleConfig(c.title)?.title ?? null).toBe(c.expected));
  }
  const named: Array<[string, string | null]> = [
    ["Back-end Engineer", "Backend Developer"], ["Front End Engineer", "Frontend Developer"], ["Software Architect", "Software Engineer"],
    ["Dir. Sales", "Sales Manager"], ["Sales Team Leader", "Sales Manager"],
    // "&" joins two fields; it never supplies the rank.
    ["Sales Specialist - Field Sales & Lead Generation (Thailand)", null],
  ];
  for (const [title, want] of named) it(`${title} → ${want}`, () => expect(findRoleConfig(title)?.title ?? null).toBe(want));
});
