import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { resumeRoleTerms } from "../../supabase/functions/_shared/fit-score";

/**
 * THE RÉSUMÉ COULD SCORE A POSTING BUT NEVER FIND ONE.
 *
 * Reported by a reader on 2026-09-01: "I tried this drop resume feature and it
 * didn't match me to applicable jobs." The scorer was innocent. Dropping a
 * résumé set fitRanking, and fitRanking only re-sorts the postings the board
 * has ALREADY LOADED — on the default browse, the newest 60 of 814,859, chosen
 * by recency and connected to nobody's career. So the gesture reordered sixty
 * irrelevant rows and captioned them as a fit ranking. Nothing was retrieved,
 * and the toast said "ranking every opening around you" in nine languages.
 *
 * Measured live before the fix, mean fit over the window that got scored:
 *
 *                  loaded window    résumé-derived search
 *   senior SWE           4.5               17.1
 *   ICU nurse            2.9               12.5
 *   sales AE             3.8               11.6
 *   accountant           1.4               15.3
 *
 * Rows scoring zero fell from 7-14 of 20 to 0-1. The fix reads role titles out
 * of the résumé and puts one in the ordinary search box, so retrieval happens
 * on the same path a typed query uses.
 *
 * WHAT THIS FILE PINS. Two halves, and the second is the one that actually
 * broke: the extractor must name the right occupation, AND the board must
 * SEARCH for it. An extractor that works while the client keeps ranking its own
 * window is exactly the bug that was reported, passing its own unit tests.
 */
const ROOT = resolve(__dirname, "../..");
const JOBS = readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8");
const LOCALES = resolve(ROOT, "src/i18n/locales");

const R = {
  swe: `Jane Doe — Senior Software Engineer
Seattle, WA
EXPERIENCE
Senior Software Engineer, Stripe (2021-2026). Built payment APIs in TypeScript and Go.
Led a team of 5. Designed distributed systems handling 40k requests/second.
Software Engineer, Amazon (2018-2021). AWS Lambda tooling, Python, Kubernetes.
SKILLS: TypeScript, Go, Python, React, PostgreSQL, Kubernetes, AWS, API design`,
  nurse: `Maria Lopez, RN, BSN
Registered Nurse — Critical Care
EXPERIENCE
Registered Nurse, ICU, Mercy Hospital 2019-2026. Ventilator management, titrated drips.
ACLS, BLS, PALS certified. Epic charting. Patient assessment and wound care.`,
  electrician: `Dave Nunez
Electrician — Commercial and Industrial
EXPERIENCE
Journeyman electrician, IBEW Local 46, 2015-2026. Conduit bending, panel work,
three-phase troubleshooting, code compliance inspections and permit coordination.`,
  accountant: `Priya Shah, CPA
Senior Accountant
EXPERIENCE
Senior Accountant, Deloitte 2020-2026. Month-end close, GAAP reconciliations,
audit support, QuickBooks and NetSuite. Prepared financial statements.
Staff Accountant, RSM 2017-2020. Accounts payable, journal entries.`,
  generic: `Sam Ortiz
U.S. Army veteran
SUMMARY
Fifteen years leading teams and budgets across three sites. Managed logistics for a
200-person unit, oversaw vendor contracts, and directed daily operations end to end.`,
};

describe("ranking is not finding", () => {
  it("names the occupation a prose résumé claims", () => {
    expect(resumeRoleTerms(R.swe)[0]).toBe("software engineer");
    expect(resumeRoleTerms(R.nurse)[0]).toBe("registered nurse");
  });

  it("handles the one-word occupations, which are whole careers", () => {
    // "electrician", "paralegal", "welder" are complete job titles. Requiring
    // two words to avoid the "manager"/"analyst" noise problem would have quietly
    // excluded every trade on the board.
    expect(resumeRoleTerms(R.electrician)).toContain("electrician");
  });

  it("strips a rank that only shrinks the search", () => {
    // Seniority reaches the score through the description terms the fit scorer
    // already reads, so putting it in the QUERY only removes candidates:
    // measured live, "journeyman electrician" retrieves 139 against 1,181 for
    // "electrician", and "staff accountant" 453 against 10,000+.
    expect(resumeRoleTerms(R.electrician)).not.toContain("journeyman electrician");
    expect(resumeRoleTerms(R.accountant)[0]).toBe("accountant");
  });

  it("refuses the bare words that are a rank or a status, not a job", () => {
    // "veteran" is in the title vocabulary, is not an occupation, and sits in
    // the header of every résumé that mentions service. Searching the board for
    // it would hand the reader an unrelated career labelled as their match.
    const terms = resumeRoleTerms(R.generic);
    expect(terms).not.toContain("veteran");
    expect(terms).not.toContain("manager");
    expect(terms).not.toContain("director");
  });

  it("prefers the precise title over the word inside it", () => {
    // "engineer" is in the same vocabulary as "software engineer" and matches
    // the same résumé. Returning the shorter one turns a good query into a
    // vague one, so anything contained in a longer match is dropped.
    const terms = resumeRoleTerms(R.swe);
    expect(terms).not.toContain("engineer");
    expect(terms.some((t) => t.includes("software engineer"))).toBe(true);
  });

  it("says nothing rather than guessing", () => {
    // An empty list means "keep browsing normally". It must never be read as
    // "no jobs match you", and a document with no occupation in it must not
    // produce a query that silently narrows the whole board.
    expect(resumeRoleTerms("")).toEqual([]);
    expect(resumeRoleTerms("too short")).toEqual([]);
    expect(
      resumeRoleTerms("Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud."),
    ).toEqual([]);
  });

  it("THE BUG: dropping a résumé must retrieve, not just re-sort the window", () => {
    // 2026-09-04: retrieval was EXTRACTED into `retrieveForResume` so the drop
    // and the "For you" tab share one copy — For-you used to rank whatever
    // recency put on screen, which on the newest-first default browse is the
    // least scoreable page on the board. Slicing from the shared helper keeps
    // this guard pointed at the real code, and the caller assertions below
    // pin that BOTH entry points still go through it.
    // The whole defect in one assertion. fitRanking re-orders what is loaded;
    // without a query derived from the résumé the board never goes and gets the
    // jobs the résumé is actually about.
    const i = JOBS.indexOf("const retrieveForResume");
    const j = JOBS.indexOf("const resolveFitResume", i);
    const handler = i >= 0 && j > i ? JOBS.slice(i, j) : "";
    expect(handler, "retrieveForResume could not be located").not.toBe("");
    expect(JOBS, "the drop must go through the shared retrieval").toMatch(/const searched = await retrieveForResume\(text\);/);
    // COUNTED, NOT NAMED. This guard used to pin one entry point by name, so
    // when a second and third appeared — the "For you" tab and the auto-enable
    // effect that fires for anyone arriving with a résumé already saved — they
    // were never covered, and the auto-enable door shipped ranking a page it
    // could not score. Every site that switches ranking on must retrieve
    // first, so the two counts are asserted equal: a new door fails this the
    // day it is added rather than the day a visitor photographs it.
    const CODE = JOBS.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
    const enables = (CODE.match(/setFitRanking\(true\)/g) ?? []).length;
    const retrievals = (CODE.match(/await retrieveForResume\(/g) ?? []).length;
    expect(enables, "the drop, the For-you tab and the auto-enable effect").toBe(3);
    expect(retrievals, "every site that switches ranking on must retrieve first").toBe(enables);
    expect(JOBS, "the drop must go through the shared retrieval").toMatch(/const searched = await retrieveForResume\(text\);/);
    expect(JOBS, "the auto-enable effect must go through it too").toMatch(/const searched = await retrieveForResume\(resume\);/);
    expect(handler, "the résumé is never turned into search terms").toMatch(/action: "fit-terms"/);
    expect(handler, "the derived role is never put in the search box — this IS the bug").toMatch(/setQ\(/);
  });

  it("does not overwrite an intent the reader already stated", () => {
    // A typed query or an employer lander is a narrower ask than "my résumé".
    // Clobbering it would fix this bug by introducing a ruder one.
    const i = JOBS.indexOf("const retrieveForResume");
    const handler = JOBS.slice(i, JOBS.indexOf("const resolveFitResume", i));
    expect(handler).toMatch(/!q\.trim\(\)/);
    expect(handler).toMatch(/!company/);
  });

  it("tells the reader where the query came from", () => {
    // A search nobody typed, presented as if they had, is the dishonest version
    // of this fix. The term is shown and the ordinary filter chip clears it.
    expect(JOBS).toMatch(/fitTerms\[0\] === q/);
    expect(JOBS).toMatch(/jobsPage\.fitTermsSearched/);
  });

  it("the claim it used to make is deleted from every locale, not just English", () => {
    // "ranking every opening around you" was false in nine languages: it ranked
    // the loaded window. A locale value overrides the inline default, so editing
    // the English string would have left eight translated copies of the lie
    // rendering. The key is removed outright and replaced.
    for (const f of readdirSync(LOCALES).filter((n) => n.endsWith(".json"))) {
      const j = JSON.parse(readFileSync(resolve(LOCALES, f), "utf8"));
      expect(j.jobsPage?.dropParsed, `${f} still carries the retired dropParsed claim`).toBeUndefined();
      expect(typeof j.jobsPage?.dropParsedSearched, `${f} is missing dropParsedSearched`).toBe("string");
      expect(typeof j.jobsPage?.dropParsedNoRole, `${f} is missing dropParsedNoRole`).toBe("string");
      // The role is interpolated, never concatenated — the word order differs by
      // language and a hardcoded position reads as machine translation.
      expect(j.jobsPage.dropParsedSearched, `${f} drops the {{role}} placeholder`).toContain("{{role}}");
    }
  });
});
