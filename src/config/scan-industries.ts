/**
 * THE INDUSTRIES THE FREE SCANNER KNOWS (register S13-018).
 *
 * A mirror of VALID_INDUSTRIES in supabase/functions/free-keyword-scan/
 * index.ts, the ids the scanner answers with and accepts back. The report's
 * "We read this as: Industry" select offers exactly these, so a résumé the
 * scanner read as janitorial shows as janitorial and a correction is sent as
 * an id the scanner keeps. src/test/the-report-offers-the-industries-the-
 * scanner-knows.test.tsx fails when the two lists part.
 *
 * Labels are English for now; the ids are what the page sends.
 */

export const SCAN_INDUSTRY_IDS = [
  "technology", "healthcare", "finance", "legal", "sales",
  "marketing", "education", "engineering", "creative", "hr",
  "consulting", "retail", "hospitality", "manufacturing",
  "government", "product_management",
  "data_engineering", "data_science", "machine_learning",
  "cybersecurity", "logistics", "real_estate", "insurance", "nonprofit",
  "biotech", "aviation", "energy", "skilled_trades", "customer_success",
  "pharmacy", "dental", "veterinary", "fitness", "media",
  "telecom", "agriculture", "sports_management", "entertainment", "academia",
  "construction_management", "architecture", "social_work", "childcare",
  "beauty", "culinary", "law_enforcement", "environmental", "gaming",
  "ecommerce", "translation", "event_planning",
  "administrative", "library", "clergy", "mining", "maritime",
  "landscaping", "janitorial",
  "general",
] as const;

export type ScanIndustryId = (typeof SCAN_INDUSTRY_IDS)[number];

const LABELS: Partial<Record<string, string>> = {
  hr: "HR",
  ecommerce: "E-commerce",
  telecom: "Telecommunications",
  biotech: "Biotech",
  general: "General / Other",
};

/** An English label for any industry id, listed or not. */
export function scanIndustryLabel(id: string): string {
  const known = LABELS[id];
  if (known) return known;
  return id
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/**
 * The select's options: the scanner's ids by label, General last. An id the
 * scanner did not list (an older report, or the streamed fallback's wider
 * list) is added as itself, so the select never shows a different industry
 * from the one the report was scored for.
 */
export function scanIndustryOptions(current?: string | null): Array<{ value: string; label: string }> {
  const ids: string[] = [...SCAN_INDUSTRY_IDS];
  if (typeof current === "string" && current.trim() && !ids.includes(current)) ids.push(current);
  return ids
    .map((value) => ({ value, label: scanIndustryLabel(value) }))
    .sort((a, b) => (a.value === "general" ? 1 : b.value === "general" ? -1 : a.label.localeCompare(b.label)));
}
