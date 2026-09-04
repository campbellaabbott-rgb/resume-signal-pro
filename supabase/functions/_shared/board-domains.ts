// THE FILTER DOMAINS BOTH SURFACES HAVE TO AGREE ON, IN THE ONLY PLACE BOTH
// SURFACES CAN READ.
//
// public-api validates its query parameters against the same closed domains the
// board's own filters use, so that a value the board accepts is never rejected
// by /v1 and vice versa. It used to import them straight out of
// ../job-board/*.ts — which typechecks locally and then fails to DEPLOY: a
// function bundle carries its own directory and ../_shared, and nothing else,
// so the import resolved to a file that was not in the bundle and public-api
// stopped compiling.
//
// The lists live here, and job-board re-exports them. There is still exactly
// one definition of each; it just sits somewhere both bundles contain.
// Vendor/kind coverage is still enforced against sources.ts inside
// job-board/filters.ts, where the JobSourceKind type lives.

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;

export const EXPERIENCE_BANDS = ["entry", "mid", "senior", "expert"] as const;

export const BOARD_VENDORS = [
  "greenhouse",
  "lever",
  "ashby",
  "smartrecruiters",
  "workable",
  "bamboohr",
  "recruitee",
  "teamtailor",
  "personio",
  "breezy",
  "rippling",
  "workday",
  "pinpoint",
  "oracle",
  "icims",
  "usajobs",
  "paylocity",
  "ukg",
  "adp",
  "jazzhr",
] as const;

export const JOB_CATEGORIES = [
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
  "other",
] as const;
