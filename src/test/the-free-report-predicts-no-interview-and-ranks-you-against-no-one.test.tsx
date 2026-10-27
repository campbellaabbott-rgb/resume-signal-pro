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
import { existsSync } from "node:fs";
import { MOUNT_TEST_BUDGET } from "./helpers/mount-budget";
import { codeOf } from "./helpers/strip-comments";
import { bothReadings } from "./helpers/visible-text";

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
// The mail capture's payload is what send-scan-report prints: the verdict line
// and the percentile and pass-rate cells come from these numbers (review
// round 2026-10-26), so the payload is read here.
const mailPayloads: Array<Record<string, unknown>> = [];
vi.mock("@/components/EmailReportCapture", () => ({
  EmailReportCapture: (p: { payload: Record<string, unknown> }) => { mailPayloads.push(p.payload); return null; },
}));
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

/**
 * THE REST OF THE PREDICTIONS (review round of 2026-10-26). The fixture above
 * carried none of the scan's ranking and pass-rate fields, so the report's
 * other predictions were never rendered here: the verdict sentence ("will
 * pass roughly 85% of ATS filters"), the "Est. ATS pass rate" card with
 * "Likely to pass" / "High rejection risk", the peer percentile with "Top
 * tier", the "How You Compare" block (whose "below" branch every reader got,
 * because the scan names its comparison above_average / below_average /
 * average and the report tested above / at / below), its callback multipliers
 * and recruiter line, the placement among real scans and the share card's
 * "Better than N% of peers". The scan still sends every field (the data
 * contract); the report renders none, and the mail payload carries neither
 * number, so send-scan-report prints no verdict, percentile or pass rate.
 */
const RANKING = {
  ...PREDICTING,
  atsScoreEstimate: 88,
  reportVerdict: "Jane, this resume will pass roughly 85% of ATS filters for Data Engineer — the fundamentals are in place.",
  peerPercentile: 91,
  applicationPassRate: 85,
  industryBenchmark: { industryAvg: 65, comparison: "above_average", percentile: "" },
  realBenchmark: { n: 1234, median: 61, p25: 50, p75: 72, industry: "data_engineering" },
  scanSituation: "exploring",
} as const;

describe("a report with every ranking field the scan sends", () => {
  it("prints no pass rate, no percentile, no rank against other résumés and no callback odds", () => {
    mailPayloads.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<MemoryRouter><FreeKeywordResults {...(RANKING as any)} onReset={() => {}} /></MemoryRouter>);
    const text = document.body.textContent ?? "";
    // Both readings: text nodes joined by spaces (so "score" and a following
    // capitalised word never glue into one word a \b cannot split), and the
    // glued textContent (so a phrase split across nodes is still seen).
    for (const reading of bothReadings()) for (const said of [
      /will pass roughly/i, /of ATS filters/i, /pass rate/i, /Likely to pass/, /High rejection risk/, /\bAt risk\b/,
      /percentile/i, /Top tier/, /Bottom tier/, /Bottom 40%/, /Top 25%/, /Top quartile/i, /Bottom quartile/i,
      /Better than \d+%/, /that get interviews/i, /How You Compare/i, /industry average/i, /scores below most/i,
      /outperforms most/i, /called back/i, /interview callbacks/i, /will likely pass/i, /your chances/i,
      /The Verdict/, /Likely to clear/i, /Strong candidate for clearing/i, /filtered/i,
    ]) expect(reading, `the report still says ${said}`).not.toMatch(said);
    // The report still opens with its summary and the PDF.
    expect(text).toMatch(/Download PDF summary/);
    expect(text).toMatch(/88\/100/);
  });

  it("the mail payload carries no pass rate and no percentile, so the mail prints neither", () => {
    mailPayloads.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    render(<MemoryRouter><FreeKeywordResults {...(RANKING as any)} onReset={() => {}} /></MemoryRouter>);
    expect(mailPayloads.length).toBeGreaterThan(0);
    for (const p of mailPayloads) {
      expect(p.peerPercentile).toBeNull();
      expect(p.applicationPassRate).toBeNull();
    }
  });

  it("no language keeps the peer sentences", () => {
    const files = readdirSync(resolve(ROOT, "src/i18n/locales")).filter((f) => f.endsWith(".json"));
    for (const f of files) {
      const fr = JSON.parse(read(`src/i18n/locales/${f}`)).freeResults ?? {};
      expect(fr.peerBenchmark, `${f} freeResults.peerBenchmark`).toBeUndefined();
      expect(fr.howYouCompare, `${f} freeResults.howYouCompare`).toBeUndefined();
      for (const k of ["placementTopQuartile", "placementAboveMedian", "placementBelowMedian", "placementBottomQuartile", "verdictLabel", "howYouCompare"]) {
        expect(fr.enterprise?.[k], `${f} freeResults.enterprise.${k}`).toBeUndefined();
      }
      expect(fr.enterprise?.summaryLabel, `${f} freeResults.enterprise.summaryLabel`).toBeTruthy();
      expect(fr.enterprise?.summaryLine, `${f} freeResults.enterprise.summaryLine`).toMatch(/\{\{score\}\}/);
    }
  });
});

/**
 * THE SCORES MOST READERS GET (the review of 2026-10-27). The fixtures above
 * scored 62 and 88: the 88 hid the score banner (it shows under 75) and the
 * score header's line for 62 glued onto the heading before it, so neither
 * test saw what most readers read. The score header predicted what an ATS
 * would do from three thresholds the module itself said had no data behind
 * them, the banner placed technology readers among 2,472 other scans (this
 * site's own, over 180 days, never named in the line) under a heading about
 * competing, the two-field line promised that recruiters in both fields
 * would consider the reader, and the recruiter panel's first persona carried
 * a pass badge. These are the scores a nurse (57), a marketer (64) and a
 * technology reader under 75 with the real distribution on hand get; none of
 * them is told what a screen, a recruiter or other applicants will do.
 */
const PANEL = {
  screener: { verdict: "Clear title, but the first bullet is a duty.", wouldPass: false },
  hiringManager: { verdict: "Wants numbers.", biggestDoubt: "Scope" },
  hrScreener: { verdict: "Reads mid-level.", levelRead: "Mid" },
};
const ORDINARY = [
  { ...PREDICTING, candidateName: "Ana Silva", currentRole: "Registered Nurse", industry: "healthcare", atsScoreEstimate: 57, recruiterPanel: PANEL,
    realBenchmark: { n: 29, median: 60, p25: 52, p75: 66, industry: "healthcare" } },
  { ...PREDICTING, candidateName: "Max Weber", currentRole: "Marketing Manager", industry: "marketing", atsScoreEstimate: 64,
    recruiterPanel: { ...PANEL, screener: { ...PANEL.screener, wouldPass: true } },
    industryBlend: { primary: "marketing", primaryPct: 70, secondary: "sales", secondaryPct: 30 } },
  // The production distribution read on 2026-10-27 (get_real_score_distribution,
  // technology): over the scan's own threshold, so every technology report
  // under 75 carried it.
  { ...PREDICTING, candidateName: "Lee Park", currentRole: "Software Engineer", industry: "technology", atsScoreEstimate: 64,
    realBenchmark: { n: 2472, median: 62, p25: 59, p75: 65, industry: "technology" } },
] as const;

describe("the scores most readers get: 57, 64, and a technology 64 with this site's own scan distribution", () => {
  for (const fx of ORDINARY) {
    it(`${fx.industry} at ${fx.atsScoreEstimate}: no outcome, no placement among other scans, no pass badge`, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      render(<MemoryRouter><FreeKeywordResults {...(fx as any)} onReset={() => {}} /></MemoryRouter>);
      for (const reading of bothReadings()) for (const said of [
        /\bAt risk\b/, /Likely to clear/i, /Strong candidate for clearing/i, /filtered/i, /before a (?:human|recruiter)/i,
        /screening hundreds/i, /\bmedian\b/i, /top quarter/i, /scanned here/i, /to compete/i, /being missed/i,
        /will consider you/i, /Survives the pile/i, /of the pile/i,
      ]) expect(reading, `the ${fx.industry} report still says ${said}`).not.toMatch(said);
      // The banner (under 75) says only that the score is no pass mark.
      expect(document.body.textContent ?? "").toMatch(/not a pass mark/);
    });
  }

  it("no language keeps the outcome tiers, their filter phrases or the placement among scans", () => {
    const files = readdirSync(resolve(ROOT, "src/i18n/locales")).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(9);
    for (const f of files) {
      const json = JSON.parse(read(`src/i18n/locales/${f}`));
      expect(json.scoreHero?.outcome, `${f} scoreHero.outcome`).toBeUndefined();
      expect(json.scoreHero?.filterPhrase, `${f} scoreHero.filterPhrase`).toBeUndefined();
      expect(json.scoreHero?.basis, `${f} scoreHero.basis`).toBeTruthy();
      expect(Object.keys(json.freeResults.atsBanner).sort(), `${f} freeResults.atsBanner`).toEqual(["heading", "noPassMark"]);
      expect(json.freeResults.atRiskOrNeedsImprovement, `${f} freeResults.atRiskOrNeedsImprovement`).toBeUndefined();
    }
  });

  it("the source holds no outcome tier and no placement among scans", () => {
    expect(existsSync(resolve(ROOT, "src/lib/score-outcome-message.ts")), "the outcome-tier module").toBe(false);
    const hero = codeOf(read("src/components/scorecard/ScoreHero.tsx"));
    expect(hero).not.toMatch(/scoreHero\.(?:outcome|filterPhrase)\b|getOutcome/);
    const report = codeOf(read("src/components/FreeKeywordResults.tsx"));
    expect(report).not.toMatch(/atsBanner\.(?:belowMedian|belowTopQuarter|topQuarter)|atRiskOrNeedsImprovement|realBenchmark\.p75/);
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
  it("free-keyword-scan carries H0's own build or a later home-pricing one, later than every wave-4 and R1 stamp", () => {
    const stamp = read("supabase/functions/free-keyword-scan/index.ts").match(/^const FN_BUILD = "free-keyword-scan\.(\d{4}-\d\d-\d\d)\.(\d+)";$/m);
    expect(stamp, "a literal FN_BUILD").not.toBeNull();
    // H0 stamped 2026-10-25.2; the report sweep of 2026-10-27 stamped 2026-10-27.1.
    const [day, n] = [stamp![1], Number(stamp![2])];
    expect(day > "2026-10-25" || (day === "2026-10-25" && n >= 2), `${day}.${n} is H0's 2026-10-25.2 or later`).toBe(true);
    expect(`${day}.${n}`).toBe("2026-10-27.1");
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
