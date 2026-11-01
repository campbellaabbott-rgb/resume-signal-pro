/**
 * THE FULL ANALYSIS'S FIXED CHOICES, AS THE REPORT NAMES THEM (S13-052).
 *
 * analyze-resume keeps these values in English whatever language the analysis
 * is written in (its schema's enums, analysis-parts.ts; the report picks
 * colours by them), so the page translates them itself: each value's label is
 * analysisResults.enum.<group>.<value> in every locale.
 * src/test/the-full-analysis-report-names-its-fixed-choices-in-the-readers-language.test.tsx
 * holds these lists to the schema's enums and every locale to a label for each.
 */
export const ANALYSIS_ENUMS = {
  industry: [
    "technology", "data_engineering", "data_science", "machine_learning", "healthcare", "finance", "marketing", "sales",
    "engineering", "education", "hr", "consulting", "legal", "retail", "hospitality", "manufacturing", "government",
    "product_management", "creative", "general",
  ],
  experienceLevel: ["entry", "mid", "senior", "executive"],
  jargonLevel: ["low", "moderate", "high"],
  severity: ["low", "medium", "high"],
  postFormat: ["text", "carousel", "poll", "video", "article"],
  tone: ["formal", "casual", "technical", "creative", "corporate", "startup"],
  companyType: ["startup", "scaleup", "enterprise", "agency", "nonprofit", "government", "unknown"],
  // The LinkedIn profile score's sections: the keys of its breakdown.
  linkedInSection: ["headline", "about", "experience", "skills", "engagement"],
} as const;

export type AnalysisEnumGroup = keyof typeof ANALYSIS_ENUMS;

/**
 * A fixed choice in the reader's language. A value that is not one of ours (an
 * analysis stored before the schema fixed the field, or a model that strayed)
 * is shown as written, its underscores read as spaces; never a missing key.
 */
export function analysisEnumLabel(t: (key: string) => string, group: AnalysisEnumGroup, value: unknown): string {
  if (typeof value !== "string") return "";
  const key = value.trim().toLowerCase();
  return (ANALYSIS_ENUMS[group] as readonly string[]).includes(key) ? t(`analysisResults.enum.${group}.${key}`) : value.replace(/_/g, " ");
}

/**
 * The company a posting names, or null when it names none. analyze-resume
 * asks for exactly "Unknown" then (report-language.ts), the one value of
 * companyName the page compares; a blank, or "unknown" in another case, is
 * read the same way, so the generic culture-fit heading is shown, never a
 * heading for a company called "Unknown".
 */
export function namedCompany(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name.toLowerCase() !== "unknown" ? name : null;
}
