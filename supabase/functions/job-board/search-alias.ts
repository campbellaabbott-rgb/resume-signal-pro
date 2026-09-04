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

  // ---- Abbreviated TITLE WORDS, added 2026-08-20 ------------------------
  //
  // The map above is acronyms — whole roles written as initials. This block is
  // the other half of how people type: ordinary words shortened inside a
  // phrase. It was missing entirely, and the cost was measured on the live
  // board, comparing what a person types against the full spelling:
  //
  //     "mech eng"       0  vs  2,206  mechanical engineer   -100%
  //     "svc technician" 7  vs  4,426  service technician    -100%
  //     "medical asst"  69  vs  3,865  medical assistant      -98%
  //     "project mgr"  174  vs  9,275  project manager        -98%
  //     "ops manager"  335  vs  6,974  operations manager     -95%
  //     "sales rep"    491  vs  5,543  sales representative   -91%
  //     "sr accountant" 508 vs  3,172  senior accountant      -84%
  //
  // Losing 84-100% of the real matches, on phrasings that are completely
  // ordinary — "mech eng" returned NOTHING on a board holding 2,206 of them.
  //
  // ONE MEASUREMENT WORTH KEEPING: "office admin" already returned MORE than
  // "office administrator" (1,703 vs 659), because `admin` is a prefix of
  // `administrator` and the ILIKE fallback matches substrings. Prefix
  // abbreviations partly self-heal on that path; non-prefix ones ("mgr",
  // "svc", "asst") cannot, which is why they fail hardest. `admin` is still
  // listed so the ranked tsquery path — which matches WORDS, not substrings —
  // gets it too.
  //
  // Same curation rule as above: unambiguous in a job-title context only.
  // Deliberately absent — "tech" (technician vs technology vs the industry),
  // "pt" (part-time vs physical therapist), "cs", "ops" alone as a role.
  rep: ["representative"],
  reps: ["representatives"],
  asst: ["assistant"],
  assoc: ["associate"],
  mgr: ["manager"],
  mgmt: ["management"],
  supv: ["supervisor"],
  dir: ["director"],
  exec: ["executive"],
  coord: ["coordinator"],
  spec: ["specialist"],
  eng: ["engineer"],
  engr: ["engineer"],
  mech: ["mechanical"],
  elec: ["electrical"],
  svc: ["service"],
  maint: ["maintenance"],
  ops: ["operations"],
  admin: ["administrator", "administrative"],
  acct: ["accounting"],
  sr: ["senior"],
  jr: ["junior"],
  dev: ["developer"],
  devs: ["developers"],
};

// Expands EVERY aliased token into websearch OR-branches that keep the rest
// of the query intact: "senior pm" → "senior pm OR senior product manager OR
// senior project manager"; "sre k8s" → branches covering both expansions AT
// ONCE ("site reliability engineer kubernetes"), which the original
// first-token-only version half-missed — "sre k8s" expanded sre and left k8s
// literal, so titles saying "kubernetes" in full never matched.
// websearch_to_tsquery has no grouping parens, but OR between full AND-groups
// gives exactly the right semantics (and the original spelling stays a branch
// — titles like "SWE II" still match). Branch order is deliberate: original
// first, then the all-tokens-expanded reading (the one multi-abbreviation
// queries actually mean), then partial substitutions until the cap.
// Queries already using advanced syntax (quotes, OR, exclusion) are never
// touched; a plain hyphenated word ("front-end") no longer disables
// expansion — only a leading-minus exclusion does. Bounded: ≤4 branches,
// ≤6 tokens.
/**
 * THE TABLE WAS ONLY EVER READ ONE WAY.
 *
 * ROLE_ALIASES maps an abbreviation to the phrases it stands for, and
 * expandQuery looks up one TOKEN at a time — so "rn" has always found
 * "registered nurse", while someone typing "registered nurse" never reached a
 * posting whose title says "RN". Employers write both, so half the curated
 * table was doing nothing for the reader who spells it out, which is the more
 * common way to type it.
 *
 * Built once at module load, from the same table, so the two directions cannot
 * disagree: adding an alias tomorrow works both ways with no second edit.
 */
const PHRASE_TO_ABBREV: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [abbrev, phrases] of Object.entries(ROLE_ALIASES)) {
    for (const phrase of phrases) {
      const key = phrase.toLowerCase();
      const cur = m.get(key) ?? [];
      // ONLY WHERE THE ABBREVIATION MEANS ONE THING. I first wrote the
      // opposite — that the reverse direction is unambiguous even where the
      // forward one is not — and an existing guard caught it: "pm" stands for
      // BOTH product manager and project manager, so contracting "product
      // manager" into "pm" would quietly drag project-manager postings into a
      // product-manager search. The forward direction may fan out, because the
      // reader typed the ambiguous thing and gets to see both readings; the
      // reverse may not, because the reader typed the precise thing.
      if (phrases.length === 1 && !cur.includes(abbrev)) cur.push(abbrev);
      m.set(key, cur);
    }
  }
  return m;
})();

/** The longest contiguous run of tokens that spells out an abbreviation. */
function longestSpelledOutRun(tokens: string[]): { at: number; len: number; abbrevs: string[] } | null {
  // Longest first: "licensed practical nurse" must win over any shorter run
  // inside it, or the more specific reading is never offered.
  for (let len = Math.min(4, tokens.length); len >= 2; len--) {
    for (let at = 0; at + len <= tokens.length; at++) {
      const abbrevs = PHRASE_TO_ABBREV.get(tokens.slice(at, at + len).join(" "));
      if (abbrevs && abbrevs.length) return { at, len, abbrevs };
    }
  }
  return null;
}

export function expandQuery(raw: string): { q: string; expansions: string[] } {
  const trimmed = raw.trim();
  if (!trimmed || /["']|\bOR\b|(^|\s)-\S/.test(trimmed)) return { q: raw, expansions: [] };
  const tokens = trimmed.toLowerCase().split(/\s+/);
  if (tokens.length > 6) return { q: raw, expansions: [] };
  // Per-position alternatives: the original token plus up to 2 alias phrases.
  const alts = tokens.map((t) => [t, ...(ROLE_ALIASES[t] ?? []).slice(0, 2)]);
  // The reverse reading: the reader spelled out something employers abbreviate.
  const spelledOut = longestSpelledOutRun(tokens);
  if (!alts.some((a) => a.length > 1) && !spelledOut) return { q: raw, expansions: [] };

  const MAX_BRANCHES = 4;
  const seen = new Set<string>();
  const branches: string[][] = [];
  const expansions: string[] = [];
  const push = (choice: number[]) => {
    if (branches.length >= MAX_BRANCHES) return;
    const words: string[] = [];
    for (let i = 0; i < tokens.length; i++) words.push(...alts[i][choice[i]].split(" "));
    const key = words.join(" ");
    if (seen.has(key)) return;
    seen.add(key);
    branches.push(words);
    for (let i = 0; i < tokens.length; i++) {
      if (choice[i] > 0 && !expansions.includes(alts[i][choice[i]])) expansions.push(alts[i][choice[i]]);
    }
  };

  // 1. The original spelling.
  push(tokens.map(() => 0));
  // 2. Everything expanded to its first alias — what a multi-abbreviation
  //    query means ("sre k8s" → "site reliability engineer kubernetes").
  push(alts.map((a) => (a.length > 1 ? 1 : 0)));
  // 3. Single substitutions (covers "pm" alone in "senior pm"), then second
  //    readings ("pm" → project manager), until the branch cap.
  for (let i = 0; i < tokens.length && branches.length < MAX_BRANCHES; i++) {
    for (let v = 1; v < alts[i].length && branches.length < MAX_BRANCHES; v++) {
      const choice = tokens.map(() => 0);
      choice[i] = v;
      push(choice);
    }
  }

  // The spelled-out run, contracted. Added after the forward branches so the
  // reader's own spelling still leads, and capped by the same MAX_BRANCHES.
  if (spelledOut) {
    for (const abbrev of spelledOut.abbrevs.slice(0, 2)) {
      if (branches.length >= MAX_BRANCHES) break;
      const words = [...tokens.slice(0, spelledOut.at), abbrev, ...tokens.slice(spelledOut.at + spelledOut.len)];
      const key = words.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      branches.push(words);
      if (!expansions.includes(abbrev)) expansions.push(abbrev);
    }
  }

  if (expansions.length === 0) return { q: raw, expansions: [] };
  return { q: branches.map((b) => b.join(" ")).join(" OR "), expansions };
}
