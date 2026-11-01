/**
 * THE FULL ANALYSIS REPORT NAMES ITS FIXED CHOICES IN THE READER'S LANGUAGE
 * (S13-052).
 *
 * The analysis keeps its fixed choices in English (the schema's enums; the
 * report picks colours by them), and since S13-003 everything else in it is
 * written in the buyer's language. AnalysisResults printed those English
 * values raw: a Spanish report read "data_engineering", "senior level",
 * "scaleup", "moderate", "carousel" and "engagement" among Spanish sentences.
 *
 * Held here:
 *   - src/lib/analysis-enums.ts lists exactly the values the schema allows
 *     (analysis-parts.ts), so a value added there without a label fails;
 *   - every locale labels every one of them, and no locale but English and
 *     British English reuses English's labels for a whole group;
 *   - the report, rendered in Spanish, shows the Spanish labels and none of
 *     the slugs; a value that is not one of ours is shown as written.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import { AnalysisResults, type AnalysisData } from "@/components/AnalysisResults";
import { ANALYSIS_ENUMS, analysisEnumLabel } from "@/lib/analysis-enums";
import { getAnalysisTools } from "../../supabase/functions/analyze-resume/analysis-parts";

const LOCALES = ["en", "en-GB", "de", "es", "fr", "hi", "nl", "pt", "tl"] as const;
const locale = (l: string) => JSON.parse(readFileSync(resolve(__dirname, "../i18n/locales", `${l}.json`), "utf8"));
type Labels = Record<string, Record<string, string>>;
const labelsOf = (l: string): Labels => locale(l).analysisResults?.enum ?? {};

type Schema = { type?: string; enum?: string[]; properties?: Record<string, Schema>; items?: Schema };
const schema = getAnalysisTools(true, true)[0].function.parameters as unknown as Schema;
const at = (path: string): Schema => path.split(".").reduce<Schema>((s, k) => (k === "[]" ? s.items! : s.properties![k]), schema);

describe("the values the report labels are the values the schema allows", () => {
  const SCHEMA_ENUMS: Record<string, string[]> = {
    industry: at("industry").enum!,
    experienceLevel: at("experienceLevel").enum!,
    jargonLevel: at("readabilityMetrics.jargonLevel").enum!,
    severity: at("atsParsingIssues.severity").enum!,
    postFormat: at("linkedInAnalysis.contentStrategy.postIdeas.[].format").enum!,
    tone: at("jobDescriptionAlignment.toneAnalysis.jdTone").enum!,
    companyType: at("jobDescriptionAlignment.companyInsights.companyType").enum!,
    linkedInSection: Object.keys(at("linkedInAnalysis.profileScore.breakdown").properties!),
  };

  it("each group, value for value", () => {
    expect(at("jobDescriptionAlignment.toneAnalysis.resumeTone").enum).toEqual(SCHEMA_ENUMS.tone);
    expect(Object.keys(ANALYSIS_ENUMS).sort()).toEqual(Object.keys(SCHEMA_ENUMS).sort());
    for (const [group, values] of Object.entries(SCHEMA_ENUMS)) {
      expect([...ANALYSIS_ENUMS[group as keyof typeof ANALYSIS_ENUMS]], group).toEqual(values);
    }
  });
});

describe("every locale labels every value", () => {
  const english = labelsOf("en");
  for (const l of LOCALES) {
    it(l, () => {
      const labels = labelsOf(l);
      for (const [group, values] of Object.entries(ANALYSIS_ENUMS)) {
        for (const v of values) {
          const label = labels[group]?.[v];
          expect(typeof label === "string" && label.trim().length > 0, `${l} analysisResults.enum.${group}.${v}`).toBe(true);
        }
        if (l !== "en" && l !== "en-GB") {
          expect(values.some((v) => labels[group][v] !== english[group][v]), `${l} labels ${group} in English`).toBe(true);
        }
      }
    });
  }
});

const REPORT: AnalysisData = {
  industry: "data_engineering",
  experienceLevel: "senior",
  readabilityMetrics: { grade: "B", bulletPointClarity: "Clara", jargonLevel: "moderate", suggestions: ["Una sugerencia"] },
  atsParsingIssues: { detectedIssues: ["Tabla en la cabecera"], severity: "medium", criticalFixes: ["Quita la tabla"] },
  jobDescriptionAlignment: {
    matchScore: 70,
    extractedKeywords: ["SQL"],
    missingKeywords: ["dbt"],
    suggestedEdits: [],
    roleMatchAnalysis: "Buena coincidencia.",
    gapAnalysis: "Falta dbt.",
    toneAnalysis: { jdTone: "startup", resumeTone: "corporate", toneMatch: false, toneGuidance: "Más directo.", phraseSwaps: [] },
    companyInsights: { companyName: "Globex", companyType: "scaleup", cultureSignals: [], valueKeywords: [], languageToUse: [], redFlagsForThisCompany: [] },
  },
  linkedInAnalysis: {
    profileScore: { overall: 60, breakdown: { headline: 12, about: 10, experience: 14, skills: 12, engagement: 12 } },
    contentStrategy: { postIdeas: [{ topic: "Migración a dbt", hook: "Así lo hicimos", format: "carousel" }], postingFrequency: "Semanal", bestTimes: "Martes", engagementTips: [], hashtagStrategy: [] },
  },
  industryInsights: { whatRecruitersLookFor: "Pipelines fiables.", competitiveAdvantage: "Escala.", commonMistakes: "Sin métricas." },
};

describe("the report, rendered in Spanish", () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("en");
  });

  it("shows the Spanish label for every fixed choice and none of the slugs", async () => {
    i18n.addResourceBundle("es", "translation", locale("es"), true, true);
    await i18n.changeLanguage("es");
    const es = labelsOf("es");
    const { container } = render(<AnalysisResults data={REPORT} />);
    const text = container.textContent ?? "";
    for (const [group, value] of [
      ["industry", "data_engineering"], ["experienceLevel", "senior"], ["jargonLevel", "moderate"], ["severity", "medium"],
      ["tone", "startup"], ["tone", "corporate"], ["companyType", "scaleup"], ["postFormat", "carousel"],
      ["linkedInSection", "about"], ["linkedInSection", "engagement"],
    ] as const) {
      expect(text, `${group}.${value}`).toContain(es[group][value]);
    }
    for (const slug of ["data_engineering", "scaleup", "moderate", "carousel", "engagement", "corporate"]) {
      expect(text, `the slug "${slug}" is printed raw`).not.toContain(slug);
    }
  });

  it("a value that is not one of ours is shown as written, underscores as spaces", () => {
    const t = (key: string) => `[${key}]`;
    expect(analysisEnumLabel(t, "industry", "Software")).toBe("Software");
    expect(analysisEnumLabel(t, "industry", "space_mining")).toBe("space mining");
    expect(analysisEnumLabel(t, "industry", "Data_Engineering")).toBe("[analysisResults.enum.industry.data_engineering]");
    expect(analysisEnumLabel(t, "severity", undefined)).toBe("");
  });
});
