// Job-board category surface shared by the /jobs page, the SEO landers,
// and the report's LiveMatches card. "other" is deliberately absent: it's
// a catch-all bucket, not a landing page anyone searches for.

export const BOARD_CATEGORY_SLUGS = [
  "engineering",
  "data_ai",
  "design",
  "product",
  "marketing",
  "sales",
  "customer",
  "finance",
  "legal",
  "people_hr",
  "operations",
  "healthcare",
  "science",
  "education",
  "hospitality_retail",
  "security",
  "admin",
] as const;

export type BoardCategorySlug = (typeof BOARD_CATEGORY_SLUGS)[number];

export const isBoardCategory = (x: string | undefined): x is BoardCategorySlug =>
  !!x && (BOARD_CATEGORY_SLUGS as readonly string[]).includes(x);

// Scanner industries → board categories, where the mapping is safe.
//
// KEYED BY THE SCANNER'S OWN SLUGS (S13-132). Seven keys named industries the
// scanner never detects (a human-resources, customer-service, nursing … slug
// that INDUSTRY_KEYWORDS does not have), so they could never fire, and the
// real HR, customer-success, administrative and creative industry pages
// rendered without the link to their board field. Every key is now an
// INDUSTRY_KEYWORDS slug (held by seo-react-industry-pages-link-their-field).
export const INDUSTRY_TO_CATEGORY: Record<string, BoardCategorySlug> = {
  technology: "engineering",
  machine_learning: "data_ai",
  data_science: "data_ai",
  data_engineering: "data_ai",
  creative: "design",
  product_management: "product",
  marketing: "marketing",
  sales: "sales",
  customer_success: "customer",
  finance: "finance",
  legal: "legal",
  hr: "people_hr",
  healthcare: "healthcare",
  education: "education",
  hospitality: "hospitality_retail",
  retail: "hospitality_retail",
  cybersecurity: "security",
  logistics: "operations",
  manufacturing: "operations",
  administrative: "admin",
};

/**
 * THE SCAN'S OWN INDUSTRY WORDS → BOARD CATEGORIES, for the free-scan matches
 * card (LiveMatches). The stream fallback scanner (free-keyword-scan-stream,
 * VALID_INDUSTRIES) and the session it leaves behind (rb_scan_industry) carry
 * slugs the industry pages do not ("software_engineering", "human_resources",
 * "nursing"), and S13-132's cleanup of the page map took them away from the
 * card: a fallback scan whose occupation could not be resolved listed the
 * whole board as "current openings in your field" (the round's review,
 * 2026-10-24). The page map stays keyed by INDUSTRY_KEYWORDS slugs; the card
 * reads this one.
 */
export const SCAN_INDUSTRY_TO_CATEGORY: Record<string, BoardCategorySlug> = {
  ...INDUSTRY_TO_CATEGORY,
  software_engineering: "engineering",
  human_resources: "people_hr",
  nursing: "healthcare",
  accounting: "finance",
  customer_service: "customer",
  design: "design",
  supply_chain: "operations",
};
