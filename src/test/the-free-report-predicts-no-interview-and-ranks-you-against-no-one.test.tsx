/**
 * THE FREE REPORT PREDICTS NO INTERVIEW AND RANKS YOU AGAINST NO ONE
 * (homepage and pricing spec of 2026-10-17, gate H0 "Free report stops
 * predicting"; switch-over README, step 12).
 *
 * The free report printed three predictions it cannot make from one résumé
 * and one posting: an "Interview Callback Likelihood" band with a percentage,
 * an apply verdict from "Strong Match — Apply Now!" to "Poor Fit — Consider
 * Other Roles", and a rank against other applicants from "Top Candidate" to
 * "Unlikely to Advance" (the spec's 21 references: interviewLikelihood,
 * competitivePosition, strongApply and doNotApply). Its job-match header
 * called the match "Free & Unlimited" with "no limits!" (free scans are
 * capped per day), and its first paid button said "See What's Costing You
 * Interviews". All of it is gone: the scan still sends the fields (the data
 * contract in report-contract.test.tsx), and the report renders none of them.
 * The rest of the job match (score, grade, fit, skills) stays.
 *
 * Its server part is a build stamp only: free-keyword-scan carries H0's own
 * build, later than every wave-4 and R1 stamp, so section 99 can tell the
 * switch-over's bundle from the one before it. The rate-limit dialog already
 * offers no Scan Pack (the product line, 2026-10-12); held here as part of H0.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { codeOf } from "./helpers/strip-comments";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: async () => ({ data: null, error: null }) },
    rpc: async () => ({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    auth: { getSession: async () => ({ data: { session: null }, error: null }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
// Every buy control is open, so the report renders all it can: the seller is
// named, and on the switch-over tree hp/scanner's report also reads the
// per-product gates (G2 and G2b), which are open here too.
vi.mock("@/lib/purchases-open", () => ({ purchasesOpen: () => true, fullAnalysisOnSale: () => true, proOnSale: () => true }));
vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("no network in this test"); }));
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
}

import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { RateLimitUpsell } from "@/components/RateLimitUpsell";

vi.setConfig(MOUNT_TEST_BUDGET);
afterEach(cleanup);

const ROOT = resolve(__dirname, "../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const PREDICTING = {
  candidateName: "Jane Doe",
  currentRole: "Data Engineer",
  industry: "data_engineering",
  atsScoreEstimate: 62,
  formatGrade: "B",
  formatIssue: "Minor spacing",
  redFlags: [],
  keywords: [{ keyword: "airflow", reason: "Standard for the role", frequencyWeight: 3, suggestedSection: "skills" }],
  quickWins: [],
  hasJobDescription: true,
  jobMatchScore: 81,
  jobMatchGrade: "B",
  matchingSkills: ["airflow"],
  missingSkills: ["dbt"],
  applicationRecommendation: { recommendation: "strong_apply", reasoning: "Most requirements met.", confidence: "high" },
  competitiveAssessment: { likelyPosition: "top_candidate", strengthVsField: "Pipeline ownership", weaknessVsField: "No dbt" },
  interviewLikelihood: { band: "strong", composite: 82, topFactor: "keyword coverage" },
} as const;

describe("the rendered report", () => {
  it("prints no interview odds, no apply verdict and no rank against other applicants", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<MemoryRouter><FreeKeywordResults {...(PREDICTING as any)} onReset={() => {}} /></MemoryRouter>);
    const text = document.body.textContent ?? "";
    for (const said of [
      // The labels as the report printed them (case kept: "top candidates"
      // in the separate industry benchmark is not the rank label).
      /Interview Callback Likelihood/, /Biggest factor/,
      /Strong Match/, /Apply Now/, /Poor Fit/, /Consider Other Roles/, /Stretch Role/, /Apply After Quick Fixes/,
      /Top Candidate(?!s)/, /Unlikely to Advance/, /Middle of Pack/, /How You Compare to Other Applicants/,
      /Free & Unlimited/, /no limits/i, /Costing You Interviews/,
    ]) expect(text, `the report still says ${said}`).not.toMatch(said);
    // The rest of the job match stays.
    expect(text).toMatch(/Job Match Analysis/);
    expect(text).toMatch(/Match Score/);
  });
});

describe("the source", () => {
  const code = codeOf(read("src/components/FreeKeywordResults.tsx"));

  it("renders none of the 21 references; the scan's fields stay only in the props it receives", () => {
    expect(code).not.toMatch(/competitivePosition|strongApply|doNotApply/);
    expect(code).not.toMatch(/freeResults\.(?:enterprise\.interviewLikelihood|jobMatch\.badge|jobMatch\.subtitle|cta\.fixIssues|appRecommendation)/);
    // Once, in the props interface (report-contract.test.tsx pins the data contract).
    expect(code.match(/\binterviewLikelihood\b/g) ?? []).toHaveLength(1);
    expect(code).not.toMatch(/\{(?:applicationRecommendation|competitiveAssessment|interviewLikelihood) &&/);
  });

  it("no language keeps their sentences", () => {
    const files = readdirSync(resolve(ROOT, "src/i18n/locales")).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(9);
    for (const f of files) {
      const fr = JSON.parse(read(`src/i18n/locales/${f}`)).freeResults ?? {};
      expect(fr.appRecommendation, `${f} freeResults.appRecommendation`).toBeUndefined();
      expect(fr.competitivePosition, `${f} freeResults.competitivePosition`).toBeUndefined();
      expect(fr.enterprise?.interviewLikelihood, `${f} freeResults.enterprise.interviewLikelihood`).toBeUndefined();
      expect(fr.jobMatch?.badge, `${f} freeResults.jobMatch.badge`).toBeUndefined();
      expect(fr.jobMatch?.subtitle, `${f} freeResults.jobMatch.subtitle`).toBeUndefined();
      expect(fr.cta?.fixIssues, `${f} freeResults.cta.fixIssues`).toBeUndefined();
      expect(fr.jobMatch?.title, `${f} keeps the job match's title`).toBeTruthy();
    }
  });
});

describe("the rest of H0", () => {
  it("free-keyword-scan carries H0's own build, later than every wave-4 and R1 stamp", () => {
    const stamp = read("supabase/functions/free-keyword-scan/index.ts").match(/^const FN_BUILD = "free-keyword-scan\.(\d{4}-\d\d-\d\d)\.(\d+)";$/m);
    expect(stamp, "a literal FN_BUILD").not.toBeNull();
    expect(`${stamp![1]}.${stamp![2]}`).toBe("2026-10-25.2");
    expect(stamp![1] > "2026-10-14").toBe(true);
    const ledger = JSON.parse(read("docs/deploy-ledger.json"));
    expect(ledger.reservations["home-pricing"]?.fnBuildDate, "the home-pricing reservation's day").toMatch(/^2026-10-25\b/);
  });

  it("the rate-limit dialog offers no Scan Pack", () => {
    render(<MemoryRouter><RateLimitUpsell onClose={() => {}} /></MemoryRouter>);
    expect(document.body.textContent ?? "").not.toMatch(/scan pack/i);
    expect(codeOf(read("src/components/RateLimitUpsell.tsx"))).not.toMatch(/scan-pack|scanPack|ScanPack/);
  });
});
