// Role-alias expansion: job seekers type industry shorthand ("swe", "rn",
// "sdr") but postings title the role in full — with zero synonym handling
// those searches silently miss thousands of exact-fit roles. The map is
// CURATED and deliberately small: only abbreviations whose job-search
// meaning is unambiguous (or whose 2-3 readings are all jobs, e.g. "pm").
// Anything context-dependent ("pt" could be part-time, "cs" could be
// customer success or computer science) is left out — a wrong expansion is
// worse than none. Expansions are disclosed in the UI ("also matching: …"),
// never applied invisibly.
export const ROLE_ALIASES: Record<string, string[]> = {
  swe: ["software engineer"],
  sde: ["software development engineer"],
  sre: ["site reliability engineer"],
  qa: ["quality assurance"],
  ml: ["machine learning"],
  ai: ["artificial intelligence"],
  ux: ["user experience"],
  ui: ["user interface"],
  pm: ["product manager", "project manager"],
  tpm: ["technical program manager"],
  rn: ["registered nurse"],
  lpn: ["licensed practical nurse"],
  cna: ["certified nursing assistant"],
  np: ["nurse practitioner"],
  pa: ["physician assistant"],
  emt: ["emergency medical technician"],
  dba: ["database administrator"],
  ba: ["business analyst"],
  ae: ["account executive"],
  sdr: ["sales development representative"],
  bdr: ["business development representative"],
  csm: ["customer success manager"],
  hr: ["human resources"],
  ta: ["talent acquisition", "teaching assistant"],
  gtm: ["go to market"],
  ehs: ["environmental health and safety"],
  infosec: ["information security"],
  cyber: ["cybersecurity"],
  k8s: ["kubernetes"],
  js: ["javascript"],
  frontend: ["front end"],
  backend: ["back end"],
  fullstack: ["full stack"],
};

// Expands the FIRST aliased token into websearch OR-branches that keep the
// rest of the query intact: "senior pm" → "senior pm OR senior product
// manager OR senior project manager". websearch_to_tsquery has no grouping
// parens, but OR between full AND-groups gives exactly the right semantics
// (and the original spelling stays a branch — titles like "SWE II" still
// match). Queries already using advanced syntax (quotes, OR, exclusion,
// hyphens) are never touched. Bounded: ≤3 branches, ≤6 tokens.
export function expandQuery(raw: string): { q: string; expansions: string[] } {
  const trimmed = raw.trim();
  if (!trimmed || /["'-]|\bOR\b/.test(trimmed)) return { q: raw, expansions: [] };
  const tokens = trimmed.toLowerCase().split(/\s+/);
  if (tokens.length > 6) return { q: raw, expansions: [] };
  const branches: string[][] = [tokens];
  const expansions: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const aliases = ROLE_ALIASES[tokens[i]];
    if (!aliases) continue;
    for (const phrase of aliases) {
      if (branches.length >= 3) break;
      const branch = [...tokens];
      branch.splice(i, 1, ...phrase.split(" "));
      branches.push(branch);
      expansions.push(phrase);
    }
    break;
  }
  if (expansions.length === 0) return { q: raw, expansions: [] };
  return { q: branches.map((b) => b.join(" ")).join(" OR "), expansions };
}
