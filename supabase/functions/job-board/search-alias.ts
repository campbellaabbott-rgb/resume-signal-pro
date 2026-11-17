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
  devops: ["dev ops"],
  devsecops: ["dev sec ops"],

  // Rationale: docs/job-board-index-notes.md#n1501-rep-representative
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

// SEARCH REACH (job-board .103): "back end developer" found 32 jobs and "backend developer" 281.
// Rationale: docs/job-board-index-notes.md#n1600-one-role-word-in-every-spelling
const SOFTWARE_FAMILY: ReadonlySet<string> = new Set([
  "software", "backend", "frontend", "fullstack", "devops", "devsecops", "web", "mobile", "ios", "android",
  "java", "javascript", "typescript", "js", "python", "react", "angular", "vue", "node", "nodejs", "php",
  "ruby", "rails", "golang", "rust", "kotlin", "swift", "scala", "salesforce", "wordpress", "ai", "ml",
]);
/** Words that make developer and engineer two different jobs, read from the board's own titles. */
const NOT_SOFTWARE: ReadonlySet<string> = new Set([
  "sales", "business", "property", "properties", "real", "estate", "land", "product", "products",
  "residential", "commercial", "housing", "community", "content", "curriculum", "course", "instructional",
  "training", "talent", "application", "applications", "solutions", "solution", "field", "support",
]);
const ROLE_NOUNS: ReadonlySet<string> = new Set([
  "developer", "developers", "engineer", "engineers", "engineering", "dev", "devs", "eng", "engr",
  "programmer", "programmers", "architect", "architects", "ui", "ux",
]);
const ROLE_SWAP: Readonly<Record<string, string>> = {
  developer: "engineer", engineer: "developer", developers: "engineers", engineers: "developers",
};
const words = (q: string) => q.toLowerCase().split(/[\s-]+/).filter(Boolean);
const softwareContext = (ws: readonly string[]) => ws.some((w) => ROLE_NOUNS.has(w) || SOFTWARE_FAMILY.has(w));

/** True when developer and engineer name the same job in this query: a software family word, and no word that splits them. */
export function roleSwapApplies(q: string): boolean {
  const ws = words(q);
  const family = ws.some((w) => SOFTWARE_FAMILY.has(w)) || (ws.includes("machine") && ws.includes("learning"));
  return family && !ws.some((w) => NOT_SOFTWARE.has(w) || (w === "learning" && !ws.includes("machine")));
}

/** The alias table for one query: the role words trade places only inside a software family. */
export function roleAliasesFor(q: string): Record<string, string[]> {
  if (!roleSwapApplies(q)) return ROLE_ALIASES;
  const out: Record<string, string[]> = { ...ROLE_ALIASES };
  for (const [w, other] of Object.entries(ROLE_SWAP)) out[w] = [other];
  return out;
}

/**
 * One spelling for a compound role word: "back end", "back-end" and "backend" are one word, and so are
 * full stack, dev ops, dev sec ops and "a.i.". Back end and front end join only beside a role or software
 * word: a grocery's "Front End Manager" is a checkout, not a web page. Quoted text is left as typed.
 */
export function joinCompoundRoleWords(q: string): string {
  return String(q ?? "").split(/("[^"]*")/).map((part) => {
    if (part.startsWith('"')) return part;
    let s = part
      .replace(/(^|\s)a\.i\.?(?=\s|$)/gi, "$1ai")
      .replace(/(^|\s)dev[\s-]*sec[\s-]*ops(?=\s|$)/gi, "$1devsecops")
      .replace(/(^|\s)dev[\s-]+ops(?=\s|$)/gi, "$1devops")
      .replace(/(^|\s)full[\s-]+stack(?=\s|$)/gi, "$1fullstack");
    if (softwareContext(words(s.replace(/(^|\s)(?:back|front)[\s-]+end(?=\s|$)/gi, " ")))) {
      s = s.replace(/(^|\s)(back|front)[\s-]+end(?=\s|$)/gi, (_m, pre: string, side: string) => `${pre}${side.toLowerCase()}end`);
    }
    return s;
  }).join("");
}

// Rationale: docs/job-board-index-notes.md#n1502-const-phrase_to_abbrev-map-string-string
// Rationale: docs/job-board-index-notes.md#n1503-const-phrase_to_abbrev-map-string-string
const PHRASE_TO_ABBREV: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const [abbrev, phrases] of Object.entries(ROLE_ALIASES)) {
    for (const phrase of phrases) {
      const key = phrase.toLowerCase();
      const cur = m.get(key) ?? [];
      // Rationale: docs/job-board-index-notes.md#n1504-if-phrases-length-cur-includes-abbrev
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
  // Own keys only: ROLE_ALIASES["constructor"] is Object's, and the spread threw (n447).
  const aliases = roleAliasesFor(trimmed);
  const alts = tokens.map((t) => [t, ...(Object.prototype.hasOwnProperty.call(aliases, t) ? aliases[t] : []).slice(0, 2)]);
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
