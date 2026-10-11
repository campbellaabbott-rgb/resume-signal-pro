/**
 * THE FREE REPORT'S FIXED CHOICES, HELD TO THE VALUES THE PAGE CAN DRAW
 * (register S11-029).
 *
 * Two model fields are free strings in the schema but are looked up in fixed
 * maps by the page: keywords[].impact (critical | high | medium) and
 * sectionCheck.sectionQuality.* (strong | adequate | thin | missing). The
 * language hint told the model to translate "every string value", so a
 * Spanish résumé came back with impact "alta" and quality "sólida", the
 * lookup returned undefined, the card read `.badge` off it, and the whole
 * report crashed behind the page's one error boundary. The crash was then
 * cached for seven days. Four arrays (matchingSkills, missingSkills,
 * missingSkillsDetailed, skillGapActions) crashed the same way as null,
 * because the page's defaults apply only to undefined.
 *
 * Both scanner forks call normalizeScanReport on every report they serve or
 * cache. Plain TypeScript with no imports, so the Node suite runs it.
 */
export const KEYWORD_IMPACTS = ["critical", "high", "medium"] as const;
export type KeywordImpact = typeof KEYWORD_IMPACTS[number];
export const SECTION_QUALITIES = ["strong", "adequate", "thin", "missing"] as const;
export type SectionQuality = typeof SECTION_QUALITIES[number];

const IMPACT_SYNONYMS: Record<string, KeywordImpact> = {
  "must-have": "critical",
  "must have": "critical",
  essential: "critical",
  required: "critical",
};

/** A keyword's impact as one of the three the page draws; anything else is medium. */
export function keywordImpact(v: unknown): KeywordImpact {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if ((KEYWORD_IMPACTS as readonly string[]).includes(s)) return s as KeywordImpact;
  return IMPACT_SYNONYMS[s] ?? "medium";
}

/** The section-quality map with only the four values the page draws; any other value is dropped. */
export function sectionQualities(v: unknown): Partial<Record<string, SectionQuality>> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const out: Partial<Record<string, SectionQuality>> = {};
  for (const [section, value] of Object.entries(v as Record<string, unknown>)) {
    const q = typeof value === "string" ? value.trim().toLowerCase() : "";
    if ((SECTION_QUALITIES as readonly string[]).includes(q)) out[section] = q as SectionQuality;
  }
  return out;
}

/** The arrays the page maps over without a guard. */
export const REPORT_LIST_FIELDS = ["matchingSkills", "missingSkills", "missingSkillsDetailed", "skillGapActions"] as const;

/** Hold a served report's fixed choices and lists to what the page can draw. Mutates and returns it. */
export function normalizeScanReport<T extends Record<string, unknown>>(report: T): T {
  const r = report as Record<string, unknown>;
  if (Array.isArray(r.keywords)) {
    r.keywords = r.keywords
      .filter((k) => !!k && typeof k === "object")
      .map((k) => ({ ...(k as Record<string, unknown>), impact: keywordImpact((k as Record<string, unknown>).impact) }));
  }
  const sc = r.sectionCheck;
  if (sc && typeof sc === "object" && !Array.isArray(sc) && "sectionQuality" in (sc as Record<string, unknown>)) {
    const q = sectionQualities((sc as Record<string, unknown>).sectionQuality);
    r.sectionCheck = { ...(sc as Record<string, unknown>), sectionQuality: q ?? {} };
  }
  for (const field of REPORT_LIST_FIELDS) {
    if (field in r && !Array.isArray(r[field])) r[field] = [];
  }
  return report;
}

/** What the language hint tells the model about the fixed choices, so it stops translating them. */
export const FIXED_CHOICES_STAY_ENGLISH =
  "Fixed choices stay in English exactly as listed, never translated: keyword impact (critical | high | medium), sectionQuality (strong | adequate | thin | missing), red-flag severity (critical | moderate | minor) and every other value the format gives as a list.";
