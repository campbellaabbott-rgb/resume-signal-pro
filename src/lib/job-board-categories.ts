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
