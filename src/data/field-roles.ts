// The role names /explore prints under each field: one list, read by the
// React page (src/pages/Explore.tsx, which re-exports it) and by the bake
// (scripts/prerender-seo.mjs, which serves the names to crawlers: SEO audit
// 2026-11-18, CONTENT-1). Pure data with no imports, so the bake can bundle it.

/** THE ROLE VOCABULARY, AND WHAT IT IS AND IS NOT.
 *
 *  IT IS OURS, NOT A MEASUREMENT. These are the role names a reader recognises,
 *  chosen per field; nothing here is a claim about the board. Every row's
 *  NUMBER is a live count from the serving API for exactly the query the row's
 *  link carries, and a row whose probe returns nothing DOES NOT RENDER. So a
 *  role we guessed wrong costs a missing row, never a wrong number — which is
 *  the only way a curated list is allowed on this page.
 *
 *  WHY A VOCABULARY AT ALL, when 20260908130000 already ported
 *  normalizeCloseTitle into SQL as normalize_close_title(text): that function
 *  is exactly the key a role vocabulary needs — it collapses requisition-number
 *  and seniority variants onto one group — but it lives on the CLOSURE log,
 *  which has no anon read path, and mining it into a ranked list of titles is a
 *  migration this workflow does not own. scripts/role-vocab-gaps.ts already
 *  ranks normalised board titles by posting count and is the tool that should
 *  replace this constant the day a cached role table exists. Until then the
 *  honest arrangement is a named list priced by real probes, with the list's
 *  authorship stated on screen.
 *
 *  The spellings lean on supabase/functions/job-board/search-alias.ts: it
 *  expands "rn" to "registered nurse" and "sdr" to "sales development
 *  representative", so the FULL spellings here are the ones that match the most
 *  postings and the shorthand a reader types still reaches them. */
export const FIELD_ROLES: Record<string, readonly string[]> = {
  engineering: ["software engineer", "mechanical engineer", "electrical engineer", "project engineer", "devops engineer", "quality engineer", "systems engineer", "maintenance technician"],
  data_ai: ["data analyst", "data engineer", "data scientist", "machine learning engineer", "business intelligence analyst", "database administrator", "analytics manager"],
  design: ["graphic designer", "product designer", "ux designer", "interior designer", "ui designer", "design manager"],
  product: ["product manager", "product owner", "program manager", "technical program manager", "product analyst", "business analyst"],
  marketing: ["marketing manager", "digital marketing specialist", "content writer", "social media manager", "brand manager", "communications specialist", "marketing coordinator"],
  sales: ["account executive", "sales representative", "sales manager", "account manager", "business development representative", "inside sales representative", "sales engineer"],
  customer: ["customer service representative", "customer success manager", "technical support specialist", "call center representative", "client services manager", "support engineer"],
  finance: ["accountant", "financial analyst", "controller", "accounts payable specialist", "auditor", "bookkeeper", "payroll specialist", "tax accountant"],
  legal: ["paralegal", "attorney", "compliance officer", "legal counsel", "contracts manager", "legal assistant"],
  people_hr: ["recruiter", "human resources generalist", "talent acquisition specialist", "human resources manager", "hr business partner", "benefits specialist"],
  operations: ["operations manager", "warehouse associate", "logistics coordinator", "supply chain analyst", "production supervisor", "truck driver", "forklift operator", "inventory specialist"],
  healthcare: ["registered nurse", "medical assistant", "certified nursing assistant", "physical therapist", "pharmacist", "nurse practitioner", "licensed practical nurse", "medical technologist"],
  science: ["research scientist", "laboratory technician", "clinical research associate", "chemist", "research associate", "quality control analyst"],
  education: ["teacher", "instructional designer", "school counselor", "professor", "teaching assistant", "tutor", "principal"],
  hospitality_retail: ["retail sales associate", "store manager", "server", "cook", "bartender", "housekeeper", "front desk agent", "shift supervisor"],
  security: ["security officer", "information security analyst", "security engineer", "cybersecurity analyst", "security guard", "trust and safety analyst"],
  admin: ["administrative assistant", "executive assistant", "office manager", "receptionist", "data entry clerk", "scheduler"],
};
