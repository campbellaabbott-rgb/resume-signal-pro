/**
 * ONE SCORE IS GRADED ON ONE SET OF BANDS IN EVERY CARD (register S13-019).
 *
 * The free report coloured and worded the same ATS score on four band
 * systems: ScoreHero 70/50 for colour and 85/70/50 for the label, the AI-ATS
 * card 80/60, the section banner 75/60 and the share image 75/55. A 72 was a
 * green "Good" in the hero and amber in the card and the banner; a 55 was
 * amber in the hero and red in the card. Every surface now reads
 * src/lib/score-bands.ts, cut at the scanner's own rubric (85/70/50).
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { scoreBand, scoreTone, SCORE_BAND_FLOORS } from "@/lib/score-bands";
import en from "@/i18n/locales/en.json";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const q = () => chain;
  Object.assign(chain, {
    select: q, eq: q, in: q, order: q, limit: q, gte: q, lte: q, insert: q, upsert: q, update: q,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: null }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  });
  return {
    supabase: {
      from: () => chain,
      rpc: vi.fn(async () => ({ data: null, error: null })),
      functions: { invoke: vi.fn(async () => ({ data: null, error: null })) },
      auth: {
        getSession: async () => ({ data: { session: null } }),
        getUser: async () => ({ data: { user: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
    },
  };
});
Element.prototype.scrollIntoView = vi.fn();
if (!(globalThis as { IntersectionObserver?: unknown }).IntersectionObserver) {
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = class {
    observe() {} unobserve() {} disconnect() {} takeRecords() { return []; }
  };
}

import { ScoreHero } from "@/components/scorecard/ScoreHero";
import { MetricCardsGrid } from "@/components/scorecard/MetricCardsGrid";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";

const ROOT = resolve(__dirname, "../..");
const SCORES = [12, 49, 50, 55, 60, 69, 70, 72, 75, 80, 84, 85, 97];

const hero = (score: number) => render(
  <TooltipProvider>
    <ScoreHero industry="technology" atsScoreEstimate={score} experienceLevel={{ level: "mid", yearsEstimate: "5 years" }}
      formatGrade="B" redFlagsCount={0} keywordsCount={2} quickWinsCount={1} />
  </TooltipProvider>,
);

const grid = (score: number) => render(
  <TooltipProvider>
    <MetricCardsGrid
      atsScoreEstimate={score}
      formatGrade="B"
      quantificationScore={{ score: 50, verdict: "average" }}
      bulletImpactScore={{ score: 50, verdict: "balanced" }}
      sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true, missingSections: [] }}
      contactInfo={{ hasEmail: true, hasPhone: true, hasLinkedIn: true, missingItems: [] }}
      topStrength={null}
      redFlags={[]}
    />
  </TooltipProvider>,
);

describe("the band function", () => {
  it("cuts at the scanner's rubric, 85/70/50", () => {
    expect(SCORE_BAND_FLOORS).toEqual({ excellent: 85, good: 70, fair: 50 });
    const rubric = readFileSync(resolve(ROOT, "supabase/functions/free-keyword-scan/index.ts"), "utf8");
    expect(rubric).toMatch(/- 85-100:/);
    expect(rubric).toMatch(/- 70-84:/);
    expect(rubric).toMatch(/- 50-69:/);
    expect([49, 50, 69, 70, 84, 85].map(scoreBand)).toEqual(["weak", "fair", "fair", "good", "good", "excellent"]);
    expect([49, 50, 70, 85].map(scoreTone)).toEqual(["destructive", "warning", "success", "success"]);
    expect(scoreBand(Number.NaN)).toBe("weak");
  });
});

describe("every card grades a score in the same band", () => {
  for (const score of SCORES) {
    it(`a score of ${score}`, () => {
      const tone = scoreTone(score);
      const h = hero(score);
      const gauge = h.container.querySelector("[data-score-tone]");
      expect(gauge?.getAttribute("data-score-tone"), "the hero's gauge").toBe(tone);
      expect(gauge?.getAttribute("data-score-band")).toBe(scoreBand(score));
      h.unmount();

      const g = grid(score);
      const atsCard = g.container.querySelector("[data-metric='atsScore']");
      expect(atsCard?.getAttribute("data-status"), "the AI-ATS card").toBe(tone);
      g.unmount();
    });
  }
});

describe("the section banner shows exactly for the scores the hero does not colour green", () => {
  const report = (score: number) => render(
    <MemoryRouter>
      <FreeKeywordResults
        industry="technology"
        atsScoreEstimate={score}
        formatGrade="B"
        formatIssue="Clean single-column layout"
        resumeLength={"good" as never}
        redFlags={[]}
        keywords={[]}
        sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
        onGetFullAnalysis={vi.fn()}
      />
    </MemoryRouter>,
  );
  for (const score of [45, 55, 69, 72, 80]) {
    it(`a score of ${score}`, () => {
      const r = report(score);
      const banner = r.container.querySelector("[data-ats-banner]");
      const headingShown = (r.container.textContent ?? "").includes(en.freeResults.atsBanner.heading);
      if (scoreTone(score) === "success") {
        expect(headingShown, "a green score drew the banner").toBe(false);
      } else {
        expect(headingShown).toBe(true);
        expect(banner?.getAttribute("data-score-tone")).toBe(scoreTone(score));
      }
      r.unmount();
    });
  }
});

describe("no grading surface keeps a threshold of its own", () => {
  const files = [
    "src/components/scorecard/ScoreHero.tsx",
    "src/components/scorecard/MetricCardsGrid.tsx",
    "src/components/ReportInsightCards.tsx",
    "src/components/ShareableScoreCard.tsx",
  ];
  for (const f of files) {
    it(f, () => {
      const src = readFileSync(resolve(ROOT, f), "utf8");
      expect(src).toMatch(/from "@\/lib\/score-bands"/);
      expect(src, "a literal ATS-score threshold").not.toMatch(/\b(?:atsScoreEstimate|atsScore|animatedScore)\s*(?:>=|<)\s*\d{2}\b/);
      expect(src, "a literal band threshold").not.toMatch(/(?<![.\w])score\s*>=\s*(?:85|80|75|70|60|55|50)\b/);
    });
  }
  it("the report's banner reads the band", () => {
    const src = readFileSync(resolve(ROOT, "src/components/FreeKeywordResults.tsx"), "utf8");
    expect(src).not.toMatch(/atsScoreEstimate\s*<\s*(?:75|60)\b/);
  });
});
