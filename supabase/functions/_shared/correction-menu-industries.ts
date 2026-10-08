/**
 * EVERY VALUE THE INDUSTRY CORRECTION MENU CAN SEND (the corrected label in
 * industry_corrections), mirrored for the edge runtime, which cannot import
 * from src/. The menu is src/components/IndustryConfidenceIndicator.tsx
 * getAvailableIndustries(): the keys of src/config/industry-keywords.ts --
 * camelCase among them, stored verbatim by log_industry_correction -- plus its
 * own additions. src/test/a-strangers-correction-label-never-reaches-the-
 * owners-digest-as-markup.test.ts holds this equal to what the menu offers.
 *
 * industry-corrections-digest printed only labels from the DETECTOR's list,
 * which missed 37 of these (humanResources, dataScience, sre, ...), so real
 * corrections were dropped as "a label outside the known industry list".
 */
export const CORRECTION_MENU_INDUSTRIES: readonly string[] = [
  "technology", "finance", "healthcare", "marketing", "sales", "sales_operations", "channel_sales",
  "sales_engineering", "inside_sales", "strategic_accounts", "humanResources", "consulting",
  "education", "operations", "product_management", "design", "legal", "dataScience",
  "projectManagement", "customerService", "retail", "hospitality", "manufacturing", "nonprofit",
  "logistics", "government", "realEstate", "investmentBanking", "clinicalResearch",
  "eventManagement", "cybersecurity", "supplyChainAnalytics", "sportsManagement", "uxResearch",
  "productAnalytics", "technicalWriting", "dataEngineering", "devRel", "contentStrategy",
  "customerSuccess", "revenueOperations", "growthMarketing", "solutionsArchitecture",
  "securityEngineering", "mlEngineering", "businessIntelligence", "platformEngineering",
  "quantitativeFinance", "productDesign", "sre", "technicalProgramManagement", "cloudSecurity",
  "dataPrivacy", "data_engineering", "data_science", "machine_learning",
  // getAvailableIndustries' own additions
  "business_development", "real_estate", "general",
];
