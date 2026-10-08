/**
 * THE ADDRESS THAT REOPENS A PURCHASE (sweep S8-015, S8-016).
 *
 * The purchase email's only link was the homepage, while the success page's
 * recovery form asks for "the link or session ID from your confirmation
 * email". For six of the nine generated products the email carried no
 * content either, so a buyer who closed the tab had nothing to get back with;
 * a Freelance Boost buyer was sent no email at all. Every caller of
 * send-product-email now passes the Checkout session id (or the pro_ grant
 * id), and the email links to the page that redeems it and prints the id.
 *
 * The product id in the link is the checkout's catalogue key (what the
 * success URL's ?product= carries), not the snake_case product type: a test
 * holds this table equal to create-product-checkout's PRODUCTS. NO IMPORTS:
 * vitest runs this file.
 */
export const SITE = "https://resumebooster.work";

/** create-product-checkout's catalogue key for each product type it sells. */
export const PRODUCT_ID_BY_TYPE: Readonly<Record<string, string>> = {
  basic_keyword_fix: "basicKeywordFix",
  cover_letter: "coverLetter",
  premium_package: "premiumPackage",
  ats_defense: "atsDefense",
  career_snapshot: "careerSnapshot",
  graduate_gameplan: "graduateGamePlan",
  interview_coach: "interviewCoach",
  career_path_simulator: "careerPathSimulator",
  scan_pack: "scanPack",
  apply_assistant: "applyAssistant",
  freelance_boost: "freelanceBoost",
  freelance_transition_pro: "freelanceTransitionPro",
};

/** A purchase id the redeeming pages accept: a live or test Checkout session, or a Pro grant. */
export function purchaseIdOf(v: unknown): string | null {
  return typeof v === "string" && /^(cs_live_|cs_test_|pro_)[A-Za-z0-9_-]{6,250}$/.test(v) ? v : null;
}

/** The page that reopens this purchase, or null when the id or the product is not one we can link. */
export function purchaseLinkFor(sessionId: unknown, productType: unknown): string | null {
  const id = purchaseIdOf(sessionId);
  const product = typeof productType === "string" ? PRODUCT_ID_BY_TYPE[productType] : undefined;
  if (!id || !product) return null;
  const q = encodeURIComponent(id);
  return product.startsWith("freelance")
    ? `${SITE}/freelance-boost?session_id=${q}`
    : `${SITE}/product-success?session_id=${q}&product=${product}`;
}
