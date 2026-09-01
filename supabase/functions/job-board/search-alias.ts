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
export function expandQuery(raw: string): { q: string; expansions: string[] } {
  const trimmed = raw.trim();
  if (!trimmed || /["']|\bOR\b|(^|\s)-\S/.test(trimmed)) return { q: raw, expansions: [] };
  const tokens = trimmed.toLowerCase().split(/\s+/);
  if (tokens.length > 6) return { q: raw, expansions: [] };
  // Per-position alternatives: the original token plus up to 2 alias phrases.
  const alts = tokens.map((t) => [t, ...(ROLE_ALIASES[t] ?? []).slice(0, 2)]);
  if (!alts.some((a) => a.length > 1)) return { q: raw, expansions: [] };
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
  if (expansions.length === 0) return { q: raw, expansions: [] };
  return { q: branches.map((b) => b.join(" ")).join(" OR "), expansions };
}