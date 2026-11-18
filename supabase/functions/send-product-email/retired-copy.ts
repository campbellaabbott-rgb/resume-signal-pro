/**
 * THE SCAN PRODUCTS' MAIL, SAID FROM WHAT THE ORDER BOUGHT (S14X-224).
 *
 * scan_pack, scan_credits and career_bundle are mailed again from their saved
 * copy ({credits, message}, written where the credits were added) when an
 * account order asks for "Email it again". The fixed copy said "30 scan
 * credits" and "75 full resume analyses" whatever was bought, sent the buyer
 * to "the home page" (the job board since the switch-over), and a scan_credits
 * order fell back to the Keyword Fix mail. This says the saved count, names
 * no number when none was saved, and points at the resume checker.
 *
 * Pure: no imports, so a Node test reads it as shipped.
 */

export const SCAN_CHECKER_URL = "https://resumebooster.work/resume-checker";

export type MailInfo = { emoji: string; tagline: string; howItWorks: string[]; nextSteps: string[] };

const SCAN_TYPES: ReadonlySet<string> = new Set(["scan_pack", "scan_credits", "career_bundle"]);

/** The whole number of credits the saved copy records, or null when it records none. */
export function creditsIn(generatedContent: unknown): number | null {
  if (!generatedContent || typeof generatedContent !== "object") return null;
  const n = Number((generatedContent as { credits?: unknown }).credits);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** The mail copy for a scan product, or null for any other product. */
export function scanProductMailInfo(productType: string, generatedContent: unknown): MailInfo | null {
  if (!SCAN_TYPES.has(productType)) return null;
  const credits = creditsIn(generatedContent);
  const added = credits === null
    ? "Your scan credits have been added to your account"
    : `${credits} scan credit${credits === 1 ? " has" : "s have"} been added to your account`;
  return {
    emoji: productType === "career_bundle" ? "📦" : "⚡",
    tagline: credits === null ? "Scan credits to check every application" : `${credits} scan credit${credits === 1 ? "" : "s"} to check every application`,
    howItWorks: [
      added,
      "Each scan checks your resume against one job description",
      "Credits never expire",
    ],
    nextSteps: [
      `Open the resume checker (${SCAN_CHECKER_URL}) to start scanning`,
      "Each scan uses one credit from your balance",
      "See your remaining credits under My Credits",
    ],
  };
}
