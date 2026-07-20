// Adjacent-role discovery: when someone searches a role, the roles NEXT to it
// are often a better fit than they realize — a nurse who's open to "care
// coordinator" or "clinical educator" has a much wider real market. This is a
// CURATED map (every adjacency is a genuine career-adjacent role, not a loose
// keyword), surfaced as optional suggestions the user can click — never a
// silent query rewrite, never padding results. Keyed on a normalized substring
// of the query, so "senior product manager" still matches "product manager".
//
// Bidirectional intent, one-directional storage: we list the most useful
// lateral moves FROM a seed role. Kept deliberately small and high-signal.
const ADJACENCY: Record<string, string[]> = {
  "software engineer": ["backend engineer", "full stack developer", "devops engineer", "platform engineer"],
  "frontend engineer": ["ui engineer", "full stack developer", "web developer"],
  "backend engineer": ["software engineer", "platform engineer", "api engineer"],
  "data scientist": ["machine learning engineer", "data analyst", "research scientist"],
  "data analyst": ["business analyst", "analytics engineer", "data scientist"],
  "machine learning engineer": ["data scientist", "ml researcher", "ai engineer"],
  "product manager": ["product owner", "program manager", "technical product manager"],
  "project manager": ["program manager", "scrum master", "delivery manager"],
  "program manager": ["project manager", "product manager", "operations manager"],
  "designer": ["product designer", "ux designer", "ui designer", "visual designer"],
  "ux designer": ["product designer", "ux researcher", "interaction designer"],
  "marketing manager": ["growth manager", "brand manager", "product marketing manager"],
  "content writer": ["copywriter", "content strategist", "technical writer"],
  "account executive": ["sales manager", "business development", "account manager"],
  "sales development representative": ["business development representative", "account executive", "inside sales"],
  "customer success manager": ["account manager", "customer support manager", "onboarding manager"],
  "recruiter": ["talent acquisition", "sourcer", "hr business partner"],
  "accountant": ["financial analyst", "bookkeeper", "controller"],
  "financial analyst": ["accountant", "fp&a analyst", "investment analyst"],
  "registered nurse": ["care coordinator", "clinical educator", "nurse case manager", "charge nurse"],
  "nurse": ["care coordinator", "clinical specialist", "patient care technician"],
  "medical assistant": ["patient care technician", "clinical assistant", "phlebotomist"],
  "teacher": ["instructional designer", "curriculum developer", "education coordinator", "tutor"],
  "customer service": ["customer support", "call center representative", "client services"],
  "operations manager": ["program manager", "supply chain manager", "general manager"],
  "mechanical engineer": ["manufacturing engineer", "design engineer", "process engineer"],
  "electrical engineer": ["hardware engineer", "controls engineer", "systems engineer"],
  "administrative assistant": ["executive assistant", "office manager", "coordinator"],
  "warehouse associate": ["logistics coordinator", "inventory specialist", "material handler"],
};

// Returns up to `max` adjacent role searches for a query, or [] if none.
// Longest key match wins so a specific seed ("registered nurse") beats a
// generic one ("nurse") when both would match.
export function adjacentRoles(query: string, max = 4): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  let best: string[] | null = null;
  let bestLen = 0;
  for (const [seed, roles] of Object.entries(ADJACENCY)) {
    if (q.includes(seed) && seed.length > bestLen) {
      best = roles;
      bestLen = seed.length;
    }
  }
  if (!best) return [];
  // Never suggest a role the query already contains.
  return best.filter((r) => !q.includes(r)).slice(0, max);
}
