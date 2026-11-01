import type { TFunction } from "i18next";

/**
 * A FIX STEP IN THE READER'S LANGUAGE (register S13-122).
 *
 * The scanner wrote its own fix steps in English ("Rewrite your 2 weakest
 * bullets...", 'Work "SQL" into your summary...') whatever the page's
 * language, and the simulator and the Fix Plan printed them as sent. Its
 * steps now carry a code and params (score-projection.ts, ProjectionFixCode)
 * and the page says them from freeResults.fixLabels.*. A quick win has no
 * code: it is the model's own sentence, already written in the résumé's
 * language, and stays as sent; so does a step from an older response, or
 * one whose params do not fit its code.
 */
export const FIX_CODES = ["bulletsWeak", "bulletsUnquantified", "keywords"] as const;
export type FixCode = (typeof FIX_CODES)[number];

export interface FixLike { label: string; code?: unknown; params?: unknown }

export function isFixCode(v: unknown): v is FixCode {
  return typeof v === "string" && (FIX_CODES as readonly string[]).includes(v);
}

export function fixLabel(t: TFunction, fix: FixLike): string {
  if (!isFixCode(fix.code)) return fix.label;
  const params = fix.params && typeof fix.params === "object" ? (fix.params as { count?: unknown; keywords?: unknown }) : {};
  if (fix.code === "keywords") {
    const keywords = Array.isArray(params.keywords)
      ? params.keywords.filter((k): k is string => typeof k === "string" && k.trim() !== "")
      : [];
    return keywords.length ? String(t("freeResults.fixLabels.keywords", { keywords: keywords.map((k) => `"${k}"`).join(", ") })) : fix.label;
  }
  const count = typeof params.count === "number" && Number.isInteger(params.count) && params.count > 0 ? params.count : null;
  return count ? String(t(`freeResults.fixLabels.${fix.code}`, { count })) : fix.label;
}
