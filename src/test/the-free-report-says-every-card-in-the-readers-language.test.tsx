/**
 * THE FREE REPORT SAYS EVERY CARD IN THE READER'S LANGUAGE (S14X-057).
 *
 * The page was translated around its cards, and the cards were not: a German
 * reader's report said "Must have", "High impact", "Credibility Flags",
 * "Content Insights", "lines flagged", "Older roles need more numbers",
 * "Moderate", the parse check's English labels, "(high confidence)" and
 * "Market Intelligence" in English. Each card now reads the keys every
 * locale already had (enhancedAnalysis.*, shareableCard.*,
 * freeResults.metricTooltips.*) or the lane's own freeScanPage shard.
 *
 * Each card is rendered in German (Spanish for the confidence word) with
 * the props that bring its words on screen, and none of the English it
 * used to print may appear.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

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

import i18n from "@/i18n";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MetricCardsGrid } from "@/components/scorecard/MetricCardsGrid";
import { KeywordsSection } from "@/components/scorecard/RedFlagsKeywords";
import { ResumeXRay } from "@/components/ResumeXRay";
import { EnhancedAnalysisDisplay } from "@/components/EnhancedAnalysisDisplay";
import { ATSParseSimulator } from "@/components/ATSParseSimulator";
import { FreeKeywordResults } from "@/components/FreeKeywordResults";
import { scanIndustryLabel } from "@/config/scan-industries";

const ROOT = resolve(__dirname, "../..");
const json = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));
async function speak(lng: string) {
  i18n.addResourceBundle(lng, "translation", json(`src/i18n/locales/${lng}.json`), true, true);
  const shard = `src/i18n/shards/free-scan-page/${lng}.json`;
  if (existsSync(resolve(ROOT, shard))) i18n.addResourceBundle(lng, "translation", json(shard), true, true);
  await i18n.changeLanguage(lng);
}
afterEach(async () => { cleanup(); await i18n.changeLanguage("en"); });

const noEnglish = (text: string, english: string[]) => {
  for (const s of english) expect(text, `"${s}" is still English`).not.toContain(s);
  expect(text).not.toContain("freeScanPage.");
};

describe("in German", () => {
  it("the metric tiles", async () => {
    await speak("de");
    const { container } = render(
      <TooltipProvider>
        <MetricCardsGrid
          atsScoreEstimate={72} formatGrade="B"
          quantificationScore={{ score: 40, verdict: "weak" }}
          actionVerbGrade={{ grade: "C" }}
          resumeLength={{ currentPages: 3, recommendedPages: 1, verdict: "too_long" }}
          wordCount={{ current: 300, idealMin: 400, idealMax: 850, verdict: "too_few" }}
          sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true, missingSections: [] }}
          contactInfo={{ hasEmail: true, hasPhone: true, hasLinkedIn: true, missingItems: [] }}
          readabilityScore={{ score: 60, verdict: "readable" }}
          bulletImpactScore={{ score: 30, verdict: "responsibility_heavy" }}
          keywordDensity={{ level: "moderate" }}
          topStrength={null} redFlags={[]}
        />
      </TooltipProvider>,
    );
    const text = container.textContent ?? "";
    noEnglish(text, [
      "Minor formatting tweaks", "Add more $, %, #", "Use stronger words", "Recruiters may skip", "Looks thin",
      "All key sections present", "Easy for recruiters", "Focus on outcomes", "Add more industry terms", "Moderate",
      "Some sections are hard to scan",
    ]);
    expect(text).toContain(i18n.t("freeScanPage.metric.lengthLong"));
  });

  it("the keyword badges", async () => {
    await speak("de");
    const { container } = render(
      <KeywordsSection industry="technology" keywords={[
        { keyword: "Kubernetes", reason: "In der Anzeige gefordert", category: "tool", impact: "critical" },
        { keyword: "Terraform", reason: "Häufig gefordert", category: "tool", impact: "high" },
      ]} />,
    );
    noEnglish(container.textContent ?? "", ["Must have", "must-have", "High impact", "high impact", "technology"]);
  });

  it("the X-ray legend and counter", async () => {
    await speak("de");
    const lines = ["Jane Doe", "Data Engineer, Acme Corp", "- Helped with reports", "- Built pipelines that moved two billion rows a day"];
    const { container } = render(<TooltipProvider><ResumeXRay resumeText={lines.join("\n")} weakBullets={[{ text: "Helped with reports", reason: "Weak verb" }]} /></TooltipProvider>);
    noEnglish(container.textContent ?? "", ["flagged", "Your actual resume, annotated", "power word", "Red underline"]);
  });

  it("the dual score, credibility and content cards", async () => {
    await speak("de");
    const { container } = render(
      <TooltipProvider>
        <EnhancedAnalysisDisplay
          atsScore={72}
          dualScore={{ atsCompatibility: 72, recruiterImpact: 58, atsNote: "Acceptable", recruiterNote: "Needs work" }}
          credibilityIssues={[{ type: "gap", severity: "high", description: "Lücke 2019-2020", location: "Erfahrung" }]}
          contentLocations={{ quota: { exists: true, locations: ["Rolle 1"], suggestion: "Gut" }, metrics: { exists: true, locations: ["Rolle 2"], suggestion: "Gut" } }}
        />
      </TooltipProvider>,
    );
    noEnglish(container.textContent ?? "", [
      "ATS Compatibility", "Recruiter Impact", "Credibility Flags", "High Priority", "Content Insights",
      "Located in:", "Found:", "Quota/Revenue Data Found", "Quantified Metrics Found",
    ]);
  });

  it("the parse check's labels", async () => {
    const TEXT = ["Jane Doe", "jane@example.com | +49 30 1234567", "Erfahrung", "Data Engineer, Acme, 2020 - heute", "- Pipelines gebaut", "Ausbildung", "B.Sc. Informatik, 2016"].join("\n");
    await speak("en");
    const english = [...render(<ATSParseSimulator resumeText={TEXT} />).container.querySelectorAll("p.font-semibold")].map((p) => p.textContent ?? "").filter((s) => s.length > 3);
    cleanup();
    expect(english.length).toBeGreaterThan(2);
    await speak("de");
    const { container } = render(<ATSParseSimulator resumeText={TEXT} translated />);
    noEnglish(container.textContent ?? "", english);
  });

  it("names skilled trades in German", async () => {
    await speak("de");
    expect(scanIndustryLabel("skilled_trades", (k: string) => i18n.t(k))).toBe("Handwerk");
  });

  it("the report's market card and section audit", async () => {
    await speak("de");
    const { container } = render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="technology" atsScoreEstimate={66} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
          redFlags={[]} keywords={[]} resumeText={"Jordan Probe\nData Engineer\n- Built pipelines that moved two billion rows a day\n".repeat(3)}
          sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
          marketIntelligence={{ country: "DE", countryName: "Deutschland", countrySource: "detected", hotSkills: ["Kubernetes"], risingKeywords: ["dbt"], cvNorms: ["Foto optional"], salaryContext: null, marketSummary: "Stabil." }}
          sectionWordCounts={{ summary: { current: 0, idealMin: 30, idealMax: 80, verdict: "too_few" }, experience: { current: 900, idealMin: 200, idealMax: 600, verdict: "too_many" } }}
          onGetFullAnalysis={vi.fn()}
        />
      </MemoryRouter>,
    );
    noEnglish(container.textContent ?? "", ["Market Intelligence", "CV norms", "Section Length Audit", "Too long", "Triggered by:"]);
  });
});

describe("in Spanish", () => {
  it("the career-situation badge says the confidence in Spanish, never the enum", async () => {
    await speak("es");
    const { container } = render(
      <MemoryRouter>
        <FreeKeywordResults
          industry="technology" atsScoreEstimate={66} formatGrade="B" formatIssue="ok" resumeLength={"good" as never}
          redFlags={[]} keywords={[]} resumeText={"Jordan Probe\nData Engineer\n- Built pipelines\n".repeat(3)}
          sectionCheck={{ hasContact: true, hasSummary: true, hasExperience: true, hasEducation: true, hasSkills: true } as never}
          careerSituation={{ situation: "career_changer", confidence: "high", situationSummary: "Cambio de sector." } as never}
          onGetFullAnalysis={vi.fn()}
        />
      </MemoryRouter>,
    );
    const label = i18n.t("freeResults.careerSituationLabel.careerChanger");
    const heading = [...container.querySelectorAll("h4")].find((h) => h.textContent === label);
    expect(heading, "the career-situation card").toBeTruthy();
    const badge = heading!.parentElement!.querySelector("span")!.textContent ?? "";
    expect(badge).not.toMatch(/\bhigh\b/);
    expect(badge).toContain(i18n.t("freeScanPage.confidence.high"));
  });
});
