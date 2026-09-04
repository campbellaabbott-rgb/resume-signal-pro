// "FOR YOU" RANKED A PAGE THAT CANNOT BE SCORED.
//
// Live, 2026-09-04: a visitor with a scanned résumé, "For you" active, sort
// "Newest first", no query — and the board's own ordering note reading that
// nothing on the page could be scored. The mode named after personalisation
// was the one guaranteed to show nothing personal.
//
// RANKING IS NOT RETRIEVAL, the lesson already recorded for the résumé drop
// and for fit-batch. Fit ranking re-orders whatever is on screen, and the
// default screen is the newest rows — which are exactly the rows the
// description sweep has not reached (measured: newest 20 at ~5% scoreable, a
// role query at 85-95%). The drop already did the right thing: read the
// occupation out of the résumé, search for it, then score. The button did not,
// because that step lived inline in the drop handler.
//
// Two halves, both pinned here: ONE retrieval step shared by both entry
// points, and — when there is genuinely no term to search — a browse made of
// rows that can be scored at all, plus an ordering note that says what is
// true rather than reading like a broken product.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { boardFilterBody, type BoardFilterState } from "../pages/Jobs";

const ROOT = resolve(__dirname, "../..");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
const JOBS = strip(readFileSync(resolve(ROOT, "src/pages/Jobs.tsx"), "utf8"));

const ALL_ON: BoardFilterState = {
  q: "nurse", location: "London", remoteOnly: false, workMode: "remote",
  category: "healthcare", inclUncat: true, agentOnly: true, country: "GB",
  experience: "senior", companyTokens: ["workday~cvshealth"], salaryFloor: 60_000,
  salaryCeiling: 120_000, payBasis: "salaried", statedPayOnly: true,
  includeUnstatedPay: true, maxYears: 5, department: "nursing",
  vendor: "greenhouse,lever", employmentType: "full_time", hideAgencies: true,
  freshness: "7",
};

describe("for you ranked a page that cannot be scored", () => {
  it("there is exactly ONE retrieval step, and both entry points use it", () => {
    expect(JOBS).toMatch(/const retrieveForResume = async \(text: string\): Promise<string> => \{/);
    // The résumé drop and the "For you" button, each calling the one copy.
    expect(JOBS, "the drop").toMatch(/const searched = await retrieveForResume\(text\);/);
    expect(JOBS, "the For you button").toMatch(/const searched = await retrieveForResume\(resume\);/);
    // A second inline copy is the defect. The occupation lookup exists once.
    expect((JOBS.match(/action: "fit-terms"/g) ?? []).length, "a second copy of the retrieval step").toBe(1);
    // And it asks the scorer's own isolate, not the ingest function.
    expect(JOBS).toMatch(/invoke\("job-fit", \{\s*body: \{ action: "fit-terms", resumeText: text \}/);
  });

  it("retrieval never overwrites an intent the reader already stated", () => {
    // A typed query or an employer lander is a narrower ask than "my résumé";
    // fit ranking still applies on top of whichever they chose.
    expect(JOBS).toMatch(/if \(terms\.length > 0 && !q\.trim\(\) && !company && !landerCompany\) \{/);
    // The gap opens before setQ, or the fit effect scores the stale page first.
    expect(JOBS).toMatch(/fitAwaitingPage\.current = true;\s*\n?\s*setQ\(terms\[0\]\);/);
  });

  it("a browse with nothing to search asks for rows that CAN be scored", () => {
    expect(JOBS).toMatch(/const fitBrowseNeedsDescriptions = fitRanking && !q\.trim\(\) && !company && !landerCompany;/);
    expect(JOBS).toMatch(/hasDescription: fitBrowseNeedsDescriptions \|\| undefined,/);
    // Only on the no-query browse: hasDescription is bound by no search RPC, so
    // sending it on a query routes through buildQuery and throws away the
    // relevance ranking — a real loss, on the pages that score 85-95% anyway.
    expect(JOBS, "sending it unconditionally is the regression")
      .not.toMatch(/hasDescription: true,/);
    // A changed request must actually re-fetch.
    expect(JOBS).toMatch(/\[filterState, q, sortMode, searchNewestFirst, fitBrowseNeedsDescriptions\],/);
    // And the fit effect must wait for that page rather than spending a scoring
    // call on the recency page still on screen.
    expect(JOBS).toMatch(/if \(!searched && !q\.trim\(\) && !company && !landerCompany\) fitAwaitingPage\.current = true;/);
  });

  it("hasDescription is a requirement of the mode, not a filter the reader set", () => {
    // activeBoardFilterKeys derives the chip row and the "is this board
    // filtered" answer from boardFilterBody. A mode requirement leaking in
    // would put a chip on screen nobody set and nobody can clear.
    expect(boardFilterBody(ALL_ON)).not.toHaveProperty("hasDescription");
    const body = JOBS.slice(JOBS.indexOf("export function boardFilterBody"), JOBS.indexOf("export function activeBoardFilterKeys"));
    expect(body).not.toContain("hasDescription");
  });

  it("the ordering note says what is true, and the old wording is gone from every locale", () => {
    expect(JOBS).toMatch(/t\("jobsPage\.orderFitNoDescriptions"/);
    const dir = resolve(ROOT, "src/i18n/locales");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    for (const f of files) {
      const j = JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { jobsPage?: Record<string, unknown> };
      expect(typeof j.jobsPage?.orderFitNoDescriptions, `${f}: the honest wording`).toBe("string");
      // DELETED, not edited. A locale value overrides the inline default, so an
      // edit in this file alone would leave nine translated copies of "no
      // posting on this page could be scored yet" still rendering — the exact
      // way the agentPitchScope figures survived their own correction.
      expect(j.jobsPage?.orderFitNone, `${f}: the old wording must be deleted, not edited`).toBeUndefined();
      // The reader is told what to do next, in their own language.
      expect(typeof j.jobsPage?.fitSearchedRole, `${f}: jobsPage.fitSearchedRole`).toBe("string");
      expect(String(j.jobsPage?.fitSearchedRole), `${f}: the role is interpolated`).toContain("{{role}}");
    }
  });

  it("the search box changing under the reader's hands is explained", () => {
    // The button silently rewrites the query. Saying so is the difference
    // between a feature and the page doing something unasked.
    expect(JOBS).toMatch(/if \(searched\) \{\s*toast\(\{ title: t\("jobsPage\.fitSearchedRole"/);
  });
});
