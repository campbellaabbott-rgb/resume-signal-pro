/**
 * WHERE A PURCHASE EMAIL SENDS ITS BUYER: BACK TO WHAT THEY BOUGHT.
 *
 * Every paid-product mail's button went to the homepage, so a buyer who closed
 * the tab had no way back to the content but a recovery form asking for "the
 * link from your confirmation email" that no email contained (commercial-
 * readiness 2026-10-08, item 3; sweep S8-015, S8-016). The link is now the page
 * Checkout returned the buyer to, carrying the session that proves the
 * purchase:
 *   - the content products and scan credits: /product-success?session_id=..&product=<key>
 *   - the Full Resume Analysis: /success?session_id=..
 *   - Freelance Boost (both tiers): /freelance-boost?session_id=..
 * the same success_url create-product-checkout, create-checkout and
 * create-scan-pack-checkout send to Stripe (tests hold them equal, and hold
 * PRODUCT_ID_BY_TYPE equal to create-product-checkout's catalogue). On those
 * pages a session whose content is already saved shows it again; nothing is
 * charged twice.
 *
 * ONE MODULE (wave 3 integration): the email-ops group built this file and the
 * payments-account group built _shared/purchase-link.ts with the same
 * function name and the arguments the other way round; the merged tree keeps
 * this one, with the catalogue table the other carried.
 *
 * Import-free: the Node tests import it directly.
 */

export const SITE_ORIGIN = "https://resumebooster.work";

/** create-product-checkout's catalogue key for each product type it sells (what the success URL's ?product= carries). */
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

/** Product types other writers use for a page in the table above. */
const OTHER_NAMES: Readonly<Record<string, string>> = { scan_credits: "scanPack" };

const FREELANCE_TYPES = new Set(["freelance_boost", "freelance_transition_pro"]);
const FULL_ANALYSIS_TYPE = "full_analysis";

/**
 * A purchase reference as the success pages and recover-purchase accept it: a
 * Stripe Checkout session, a Pro grant, or an owner re-delivery.
 */
const REFERENCE_RE = /(cs_(?:live|test)_[A-Za-z0-9]{10,200}|pro_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|manual_regen_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;

/**
 * The purchase reference inside whatever a buyer pasted: the bare id, the
 * link from the email (any page, percent-encoded or not), or the line of the
 * email that carries it. null when there is none.
 */
export function purchaseReferenceIn(text: unknown): string | null {
  if (typeof text !== "string" || !text) return null;
  let s = text.slice(0, 4000);
  try { s = decodeURIComponent(s); } catch { /* keep it as pasted */ }
  const m = REFERENCE_RE.exec(s);
  return m ? m[1] : null;
}

/** The page that holds this purchase, for the button in its email. Never the homepage. */
export function purchaseLinkFor(productType: string | null | undefined, sessionId: string | null | undefined): string {
  const type = String(productType ?? "");
  const ref = purchaseReferenceIn(sessionId ?? "");
  const freelance = FREELANCE_TYPES.has(type);
  const key = freelance ? undefined : (PRODUCT_ID_BY_TYPE[type] ?? OTHER_NAMES[type]);
  if (!ref) {
    // No reference to carry: the recovery form on the product's own page.
    if (freelance) return `${SITE_ORIGIN}/freelance-boost`;
    return key ? `${SITE_ORIGIN}/product-success?product=${key}` : `${SITE_ORIGIN}/product-success`;
  }
  const sid = encodeURIComponent(ref);
  if (type === FULL_ANALYSIS_TYPE) return `${SITE_ORIGIN}/success?session_id=${sid}`;
  if (freelance) return `${SITE_ORIGIN}/freelance-boost?session_id=${sid}`;
  return key
    ? `${SITE_ORIGIN}/product-success?session_id=${sid}&product=${key}`
    : `${SITE_ORIGIN}/product-success?session_id=${sid}`;
}
