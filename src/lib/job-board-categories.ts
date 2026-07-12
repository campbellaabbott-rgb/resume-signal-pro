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
export const INDUSTRY_TO_CATEGORY: Record<string, BoardCategorySlug> = {
  technology: "engineering",
  software_engineering: "engineering",
  machine_learning: "data_ai",
  data_science: "data_ai",
  data_engineering: "data_ai",
  design: "design",
  product_management: "product",
  marketing: "marketing",
  sales: "sales",
  customer_service: "customer",
  finance: "finance",
  accounting: "finance",
  legal: "legal",
  human_resources: "people_hr",
  healthcare: "healthcare",
  nursing: "healthcare",
  education: "education",
  hospitality: "hospitality_retail",
  retail: "hospitality_retail",
  cybersecurity: "security",
  logistics: "operations",
  supply_chain: "operations",
  manufacturing: "operations",
};
