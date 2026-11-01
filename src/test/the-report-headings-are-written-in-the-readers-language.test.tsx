/**
 * THE REPORT'S HEADINGS ARE WRITTEN IN THE READER'S LANGUAGE (register
 * S13-122).
 *
 * The free report was translated around a set of English headings typed into
 * the components: "We read this as:" and "Corrections retrain our detection"
 * (the confirmation strip, whose second line also claimed more than happens:
 * a correction is logged for review, nothing retrains), "Is this right?"
 * (the industry indicator), "Recruiter Red Flags", "Job Match Analysis" (whose
 * keys existed and were never read), "Best Uses for This Resume" (likewise),
 * "Primary Scores", and the vendor card and findings index (their own file,
 * a-layout-the-scan-never-saw-is-not-certified-to-any-ats). Each is rendered
 * here in German, and each component's source is held to carry none of them
 * as text.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";

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

import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { IndustryConfidenceIndicator } from "@/components/IndustryConfidenceIndicator";
import { RedFlagsSection } from "@/components/scorecard/RedFlagsKeywords";
import { JobKeywordMatcher } from "@/components/JobKeywordMatcher";
import { EnhancedAnalysisDisplay } from "@/components/EnhancedAnalysisDisplay";

const ROOT = resolve(__dirname, "../..");
const LOCALES = resolve(ROOT, "src/i18n/locales");
const de = JSON.parse(readFileSync(resolve(LOCALES, "de.json"), "utf8"));

beforeAll(async () => {
  i18n.addResourceBundle("de", "translation", de, true, true);
  await i18n.changeLanguage("de");
});
afterEach(() => cleanup());
afterAll(async () => { await i18n.changeLanguage("en"); });

const english = (text: string, list: string[]) => list.filter((s) => text.includes(s));

describe("rendered in German", () => {
  it("the confirmation strip", () => {
    const { container } = render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="healthcare" atsScoreEstimate={66} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
          redFlags={[]} keywords={[]} resumeText={"Jordan Probe\nNurse\n- Cared for 20 patients a shift\n".repeat(3)}
          sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
          industryNeedsConfirmation industryTransition={{ historical: "healthcare", recent: "education" } as never}
          experienceLevel={{ level: "mid", yearsEstimate: "6 years" } as never}
          onGetFullAnalysis={vi.fn()}
        />
      </MemoryRouter>,
    );
    const text = container.textContent ?? "";
    expect(english(text, ["We read this as:", "Corrections retrain our detection", "Quick check:", "we weren't fully sure"])).toEqual([]);
    expect(text).toContain(de.freeResults.readAs.label);
    const level = container.querySelector<HTMLSelectElement>("select[data-level-select]");
    expect([...(level?.options ?? [])].map((o) => o.textContent)).toEqual(
      ["entry", "mid", "senior", "executive"].map((k) => de.freeResults.readAs.levels[k]),
    );
    expect(container.querySelector("select[data-industry-select]")?.getAttribute("aria-label")).toBe(de.freeResults.readAs.industryAria);
  });

  it("the industry indicator", () => {
    const { container } = render(
      <TooltipProvider>
        <IndustryConfidenceIndicator industry="healthcare"
          industryDetection={{ detected: "healthcare", confidence: "low", signals: ["RN", "patients", "ward"] }} />
      </TooltipProvider>,
    );
    const text = container.textContent ?? "";
    expect(english(text, ["Is this right?"])).toEqual([]);
    expect(text).toContain(de.industryConfidence.isThisRight);
  });

  it("the red flags", () => {
    const { container } = render(<RedFlagsSection redFlags={[{ issue: "Lücke 2021", impact: "x", severity: "critical" }, { issue: "y", impact: "z", severity: "minor" }]} />);
    const text = container.textContent ?? "";
    expect(english(text, ["Recruiter Red Flags", "1 critical", "1 minor", "Critical", "Minor"])).toEqual([]);
    expect(text).toContain(de.redFlags.title);
  });

  it("the job match", () => {
    const { container } = render(
      <JobKeywordMatcher jobTitle="Pflegekraft" jobCompany="Charité" matchScore={55} matchingSkills={["Triage"]}
        missingSkillsDetailed={[{ skill: "BLS", category: "certification", importance: "critical", isImplicit: true, fixSuggestion: "Add BLS" } as never]} />,
    );
    const text = container.textContent ?? "";
    expect(english(text, ["Job Match Analysis", "Matching against", "Critical Gaps", "Skills You Already Have", "Gaps by Category", "Actions to Improve Your Match", "Implied by related experience"])).toEqual([]);
    expect(text).toContain(de.jobKeywordMatcher.title);
  });

  it("the best uses", () => {
    const { container } = render(
      <TooltipProvider>
        <EnhancedAnalysisDisplay usageRecommendations={[{ channel: "LinkedIn", suitability: "excellent", note: "n" }, { channel: "Mail", suitability: "not_recommended", note: "n" }]} />
      </TooltipProvider>,
    );
    const text = container.textContent ?? "";
    expect(english(text, ["Best Uses for This Resume", "where this resume version works best", "Excellent", "Not Recommended"])).toEqual([]);
    expect(text).toContain(de.enhancedAnalysis.bestUses);
  });
});

describe("in the source", () => {
  const SITES: Array<[string, string[]]> = [
    ["src/components/FreeKeywordResults.tsx", ["We read this as:", "Corrections retrain our detection"]],
    ["src/components/IndustryConfidenceIndicator.tsx", ["Is this right?"]],
    ["src/components/ReportInsightCards.tsx", ["How the big ATS platforms read this resume", "Findings at a glance"]],
    ["src/components/scorecard/MetricCardsGrid.tsx", ["Primary Scores"]],
    ["src/components/scorecard/RedFlagsKeywords.tsx", ["Recruiter Red Flags"]],
    ["src/components/JobKeywordMatcher.tsx", ["Job Match Analysis"]],
    ["src/components/EnhancedAnalysisDisplay.tsx", ["Best Uses for This Resume"]],
  ];
  for (const [file, headings] of SITES) {
    it(`${file} types none of its headings as text`, () => {
      const code = readFileSync(resolve(ROOT, file), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
      for (const h of headings) expect(code.includes(h), `${file} still types "${h}"`).toBe(false);
    });
  }

  it("no locale says corrections retrain anything", () => {
    for (const l of ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"]) {
      const d = JSON.parse(readFileSync(resolve(LOCALES, `${l}.json`), "utf8"));
      expect(typeof d.freeResults.readAs.note, l).toBe("string");
      expect(d.freeResults.readAs.note, l).not.toMatch(/retrain/i);
    }
  });
});
