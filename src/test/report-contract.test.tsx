// Backend↔frontend contract test for the free scan report.
//
// The edge function's responseData and FreeKeywordResultsProps have grown in
// lockstep across many batches — this test pins the contract so a renamed or
// dropped field breaks at test time, not silently in production.
//
// Two layers:
// 1. Compile-time: `fullProps` below populates EVERY report field with a
//    realistic value. If a prop is renamed or its shape changes, tsc fails.
// 2. Runtime: the new self-contained report components render with that data
//    and show their key content.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FreeKeywordResultsProps } from "../components/FreeKeywordResults";
import { ResumeXRay } from "../components/ResumeXRay";
import { CardErrorBoundary } from "../components/CardErrorBoundary";
import { TooltipProvider } from "@/components/ui/tooltip";
import { diffWords } from "../lib/diff-words";

// Every report-data field the backend sends, typed against the props interface.
// (UI callbacks and display flags are omitted — this pins the DATA contract.)
const fullProps: Pick<FreeKeywordResultsProps,
  | "candidateName" | "currentRole" | "industry" | "atsScoreEstimate"
  | "formatGrade" | "formatIssue" | "redFlags" | "keywords" | "powerWords"
  | "weakPhrases" | "quickWins" | "sampleRewrite" | "topSkipReasons"
  | "scoreBreakdown" | "additionalRewrites" | "nextBestAction"
  | "recruiterFirstPassSummary" | "formatGradeDrivers" | "atsParsedPreview"
  | "peerPercentile" | "applicationPassRate" | "titleLevelMismatch"
  | "toneAudit" | "sectionWordCounts" | "subIndustry" | "jdTargetIndustry"
  | "industryBlend" | "interviewLikelihood" | "competitorSilhouette"
  | "fixRoadmap" | "reportVerdict" | "dualIndustryComparison" | "premiumTeaser"
  | "gatedKeywords" | "detectionQualityScore" | "resumeTimeline"
> = {
  candidateName: "Jane Doe",
  currentRole: "Senior Data Engineer",
  industry: "data_engineering",
  atsScoreEstimate: 62,
  formatGrade: "B",
  formatIssue: "Minor spacing inconsistencies",
  redFlags: [{ issue: "No metrics in bullets", impact: "Recruiters skip unquantified impact", severity: "critical" }],
  keywords: [{ keyword: "airflow", reason: "Standard for the role", frequencyWeight: 3, suggestedSection: "skills" }],
  powerWords: [{ word: "Spearheaded", why: "Signals ownership" }],
  weakPhrases: [{ phrase: "responsible for", suggestion: "Led" }],
  quickWins: [{ fix: "Add pipeline throughput numbers", timeEstimate: "10 min", impact: "high", scoreImpact: 6, category: "quantification" }],
  sampleRewrite: { before: "Responsible for data pipelines", after: "Built 12 Airflow pipelines processing 2TB daily", improvement: "Quantified scope" },
  topSkipReasons: ["Generic summary"],
  scoreBreakdown: { keywords: 55, format: 75, quantification: 40 },
  additionalRewrites: [{ before: "Helped with ETL", after: "Owned ETL for 40 sources", improvement: "Ownership verb" }],
  nextBestAction: { action: "Quantify your top 3 bullets", why: "Largest score lift", estimatedImpact: "+6 pts" },
  recruiterFirstPassSummary: "Solid pipeline experience, but impact is invisible without numbers.",
  formatGradeDrivers: [{ driver: "Two-column layout", impact: "critical" }],
  atsParsedPreview: "JANE DOE Senior Data Engineer ...",
  peerPercentile: 42,
  applicationPassRate: 48,
  titleLevelMismatch: { detected: true, claimedLevel: "Director+", bulletLevel: "Individual Contributor", icVerbs: ["assisted"], tip: "Use ownership verbs" },
  toneAudit: { passiveCount: 4, activeCount: 9, firstPersonCount: 1, passiveRatio: 31, verdict: "mixed" },
  sectionWordCounts: { summary: { current: 20, idealMin: 40, idealMax: 120, verdict: "too_few" } },
  subIndustry: { id: "devops", label: "DevOps / Platform", matchedSignals: ["kubernetes", "terraform", "ci/cd"] },
  jdTargetIndustry: "technology",
  industryBlend: { primary: "data_engineering", secondary: "technology", primaryPct: 60, secondaryPct: 40 },
  interviewLikelihood: { band: "moderate", composite: 55, topFactor: "keyword coverage trails peers" },
  competitorSilhouette: {
    archetype: { quantifiedBullets: 8, leadershipSignals: 3, keywordCoveragePct: 70 },
    user: { quantifiedBullets: 3, leadershipSignals: 1, keywordCoveragePct: 45 },
  },
  fixRoadmap: {
    steps: [{ order: 1, step: "Add metrics", minutes: 10, scoreImpact: 6, projectedScoreAfter: 68 }],
    totalMinutes: 10,
    finalProjectedScore: 68,
  },
  reportVerdict: "Jane, this resume will pass roughly 48% of ATS filters.",
  dualIndustryComparison: {
    primary: { industry: "data_engineering", score: 62, keywordCoveragePct: 45, benchmarkMedian: 69 },
    secondary: { industry: "technology", score: 58, keywordCoveragePct: 38, benchmarkMedian: 68 },
  },
  premiumTeaser: { rewritePreview: "Built 12 Airflow pipelines processing 2TB daily …", totalRewritesAvailable: 3 },
  gatedKeywords: [{ keyword: "dbt", category: "tool", gated: true }],
  detectionQualityScore: 72,
  resumeTimeline: {
    totalExperienceMonths: 72, hasSignificantGap: false, hasShortTenures: false,
    gapPeriods: [], averageTenureMonths: 36, rolesDetected: 2, summary: "2 roles, 6 years",
  },
};

describe("report contract", () => {
  it("full report payload type-checks against FreeKeywordResultsProps", () => {
    // The assertion is the compile step itself; this keeps the object referenced.
    expect(Object.keys(fullProps).length).toBeGreaterThan(30);
  });

  it("ResumeXRay renders the resume with annotations", () => {
    render(
      <TooltipProvider>
        <ResumeXRay
          resumeText={"Jane Doe\n- Responsible for data pipelines\n- Spearheaded platform migration"}
          weakBullets={[{ text: "Responsible for data pipelines", reason: "Passive opener with no metrics" }]}
          unquantifiedBullets={[]}
          powerWords={fullProps.powerWords}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText("Resume X-Ray")).toBeInTheDocument();
    expect(screen.getByText(/1 line flagged/)).toBeInTheDocument();
    expect(screen.getByText("Spearheaded")).toBeInTheDocument();
  });

  it("CardErrorBoundary contains a crashing child", () => {
    const Bomb = () => { throw new Error("boom"); };
    render(
      <div>
        <CardErrorBoundary section="test-bomb"><Bomb /></CardErrorBoundary>
        <p>report survives</p>
      </div>,
    );
    expect(screen.getByText("report survives")).toBeInTheDocument();
  });

  it("diffWords marks removals and additions", () => {
    const segs = diffWords("Responsible for data pipelines", "Built 12 data pipelines daily");
    expect(segs.some(s => s.type === "removed" && /Responsible/.test(s.text))).toBe(true);
    expect(segs.some(s => s.type === "added" && /Built/.test(s.text))).toBe(true);
    expect(segs.some(s => s.type === "same" && /data pipelines/.test(s.text))).toBe(true);
  });
});
