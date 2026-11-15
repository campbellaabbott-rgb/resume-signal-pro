// Rationale: docs/job-board-index-notes.md#n1507-export-const-foldname-s-string-string

// Rationale: docs/job-board-index-notes.md#n1508-export-const-foldname-s-string-string
export const foldName = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// Rationale: docs/job-board-index-notes.md#n1509-export-const-foldtypeahead-s-string-stri
export const foldTypeahead = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/ς/g, "σ").replace(/[^\p{L}\p{N}]+/gu, "");

// Rationale: docs/job-board-index-notes.md#n1510-export-const-occupation_guard-readonlyse
export const OCCUPATION_GUARD: ReadonlySet<string> = new Set([
  "sales", "nurse", "nursing", "driver", "chef", "intern", "internship", "it",
  "hr", "manager", "engineer", "engineering", "developer", "analyst", "teacher",
  "accountant", "designer", "recruiter", "technician", "assistant", "associate",
  "director", "specialist", "coordinator", "consultant", "administrator",
  "apple", "target", "shell", "oracle", "next", "general", "digital", "health",
  "talent", "medical", "american", "global", "open", "first", "summit",
  "capital", "premier", "national", "standard", "crown", "pioneer", "frontier",
  "horizon", "unity", "spark", "match", "monster", "indeed", "visa", "discover",
  "guardian", "liberty", "progressive", "cardinal", "sage", "stripe", "square",
  "orange", "gap", "boots", "sky", "three", "giant", "remote", "hybrid",
  // Rationale: docs/job-board-index-notes.md#n1511-ace-arrow-benchmark-card-continental-fle
  "ace", "arrow", "benchmark", "card", "continental", "flex", "infuse", "ing",
  "intuitive", "mars", "nov", "republic", "rochester", "sec", "wisconsin",
  "wood",
]);

// Rationale: docs/job-board-index-notes.md#n1512-export-const-english_stopwords-readonlys
export const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at", "by",
  "for", "with", "about", "into", "to", "from", "up", "down", "in", "out", "on",
  "off", "over", "under", "again", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "can", "will", "just", "it", "its", "is", "are",
  "was", "were", "be", "been", "being", "do", "does", "did", "of", "as", "who",
]);

/** R3's token test: a stopword, or three letters or digits or fewer. */
export const isLiteralToken = (t: string): boolean => ENGLISH_STOPWORDS.has(t) || foldName(t).length <= 3;

// Rationale: docs/job-board-index-notes.md#n1513-export-const-stem_collisions-readonly-re
export const STEM_COLLISIONS: Readonly<Record<string, readonly string[]>> = (() => {
  const pairs: string[][] = [
    ["accountant", "accountants"], ["mechanic", "mechanics"], ["operator", "operators"],
    ["administrator", "administrators"], ["generator", "generators"], ["organizer", "organizers"],
    ["organiser", "organisers"], ["animator", "animators"], ["installer", "installers"],
    ["university", "universities"], ["police"],
  ];
  const out: Record<string, readonly string[]> = {};
  for (const forms of pairs) for (const f of forms) out[f] = forms;
  return out;
})();
export const isStemCollision = (t: string): boolean => Object.prototype.hasOwnProperty.call(STEM_COLLISIONS, String(t ?? "").toLowerCase());

/** The query's tokens the english tsquery discards ("it" in "it technicians"). */
export const stopwordTokens = (q: string): string[] =>
  [...new Set(String(q ?? "").toLowerCase().split(/\s+/).filter((t) => t !== "or" && ENGLISH_STOPWORDS.has(t)))];

export type TitleFilter = {
  column: "title" | "title_tsv"; query: string; config: "simple" | "english";
  /** S12-014: a literal token that names an employer matches its title OR that employer's boards. */
  orCompanyTokens?: string[];
};

// Rationale: docs/job-board-index-notes.md#n1514-export-function-simpleroutefilters
export function simpleRouteFilters(
  safeQ: string,
  aliases: Readonly<Record<string, readonly string[]>>,
  employers?: Readonly<Record<string, { tokens: string[]; name: string }>>,
): { filters: TitleFilter[]; expansions: string[] } | null {
  const q = String(safeQ ?? "").trim();
  if (!q || q.includes('"')) return null;
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.some((t) => t === "or" || t.startsWith("-"))) return null;
  const literalToken = (t: string) => isLiteralToken(t) || isStemCollision(t);
  const literal = tokens.filter(literalToken);
  const stem = tokens.filter((t) => !literalToken(t));
  // A stemmer collision is matched unstemmed even alone (S12-018).
  if (literal.length === 0 || (stem.length === 0 && !literal.some(isStemCollision))) return null;
  const expansions: string[] = [];
  const alts = (t: string) => (Object.prototype.hasOwnProperty.call(aliases, t) ? aliases[t] : []).slice(0, 2);
  const either = (t: string) => {
    for (const p of alts(t)) if (!expansions.includes(p)) expansions.push(p);
    // Its other number is the same word, not an alias phrase, and is not disclosed as one.
    const forms = isStemCollision(t) ? STEM_COLLISIONS[t].filter((f) => f !== t) : [];
    return [t, ...forms, ...alts(t)].join(" or ");
  };
  // Rationale: docs/job-board-index-notes.md#n1515-const-boardsof-t-string-employers-foldna
  const boardsOf = (t: string) => (employers && foldName(t).length > 2 && !OCCUPATION_GUARD.has(foldName(t)) && Object.prototype.hasOwnProperty.call(employers, foldName(t)) ? employers[foldName(t)].tokens : []);
  const filters: TitleFilter[] = literal.map((t) => {
    const tokens = boardsOf(t);
    return { column: "title", query: either(t), config: "simple", ...(tokens.length ? { orCompanyTokens: tokens } : {}) };
  });
  const plain = stem.filter((t) => alts(t).length === 0);
  const english = [...(plain.length ? [plain.join(" ")] : []), ...stem.filter((t) => alts(t).length > 0).map(either)];
  for (const e of english) {
    filters.push({ column: "title_tsv", query: e, config: "english" });
    filters.push({ column: "title", query: e, config: "english" });
  }
  return { filters, expansions };
}

/** The query with its stemmed plurals singular, a reading for the re-ranker only ("qa engineers" -> "qa engineer"). */
export function singularReading(q: string): string {
  return String(q ?? "").split(/\s+/).filter(Boolean).map((t) =>
    isLiteralToken(t.toLowerCase()) ? t : t.replace(/ies$/i, "y").replace(/([^s])s$/i, "$1")).join(" ");
}

export type Route = "BROWSE" | "EMPLOYER" | "SYMBOL" | "SIMPLE" | "RANKED";

// Rationale: docs/job-board-index-notes.md#n1516-export-const-retriever_for-readonly-reco
export const RETRIEVER_FOR: Readonly<Record<Route, "browse" | "company" | "simple" | "ranked">> = {
  BROWSE: "browse",
  EMPLOYER: "company",
  SYMBOL: "ranked",
  SIMPLE: "simple",
  RANKED: "ranked",
};

export interface RouteDecision {
  route: Route;
  // Rationale: docs/job-board-index-notes.md#n1517-reason-string
  reason: string;
  /** EMPLOYER only: the company_token values to filter on. */
  tokens?: string[];
  /** EMPLOYER only: the display name, for disclosure. */
  matchedName?: string;
}

// Rationale: docs/job-board-index-notes.md#n1518-type-aliases-readonly-record-string-toke
type Aliases = Readonly<Record<string, { tokens: string[]; name: string }>>;
const own = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
const fillerKeyMemo = new WeakMap<object, Map<string, { tokens: string[]; name: string }>>();

// Rationale: docs/job-board-index-notes.md#n1519-export-function-fillerfoldedaliases-alia
export function fillerFoldedAliases(aliases: Aliases, filler: ReadonlySet<string>): ReadonlyMap<string, { tokens: string[]; name: string }> {
  const memo = fillerKeyMemo.get(aliases);
  if (memo) return memo;
  const out = new Map<string, { tokens: string[]; name: string }>();
  const shared = new Set<string>();
  for (const hit of Object.values(aliases)) {
    const words = hit.name.toLowerCase().split(/\s+/).filter((w) => foldName(w) !== "");
    const kept = words.filter((w) => !filler.has(foldName(w)));
    if (kept.length === words.length || kept.length < 2) continue;
    const key = foldName(kept.join(" "));
    if (own(aliases, key)) continue;
    if (out.has(key) && out.get(key)!.name !== hit.name) shared.add(key);
    out.set(key, hit);
  }
  for (const k of shared) out.delete(k);
  fillerKeyMemo.set(aliases, out);
  return out;
}

// Rationale: docs/job-board-index-notes.md#n1520-export-const-brand_min_open
export const BRAND_MIN_OPEN = 100;
const CORPORATE_TAIL = /\s+(?:health|healthcare|health\s+system|co\.?|company|companies|inc\.?|incorporated|corp\.?|corporation|group|holdings?|llc|ltd\.?|limited|plc|stores?|international|industries|brands|enterprises)$/i;
const keyShapeOk = (name: string, key: string): boolean =>
  key.length >= 2 && (name.trim().split(/\s+/).length >= 2 || key.length <= 4 || /[0-9&]/.test(name));
export function brandKeysOf(name: string): string[] {
  const out = new Set<string>();
  const full = foldName(name);
  if (keyShapeOk(name, full)) out.add(full);
  let core = name.trim().replace(/^the\s+/i, "");
  for (let i = 0; i < 3 && CORPORATE_TAIL.test(core); i++) core = core.replace(CORPORATE_TAIL, "").trim();
  const brand = foldName(core);
  if (core && brand !== full && keyShapeOk(core, brand)) out.add(brand);
  return [...out];
}
/** The last set built, only: a memo keyed by every employers list seen kept each ~32k-row list alive. */
let liveAliasLast: { base: Aliases; employers: object; refuse: ReadonlySet<string>; out: Aliases } | null = null;
export function withLiveBrands(
  base: Aliases,
  employers: ReadonlyArray<{ name?: string; token?: string; tokens?: string[]; open?: number; count?: number }>,
  refuse: ReadonlySet<string>,
): Aliases {
  const last = liveAliasLast;
  if (last && last.base === base && last.employers === employers && last.refuse === refuse) return last.out;
  const live = new Map<string, { tokens: string[]; name: string }>();
  const shared = new Set<string>();
  for (const e of employers) {
    const name = String(e.name ?? "").trim();
    const size = typeof e.open === "number" ? e.open : Number(e.count ?? 0);
    const tokens = Array.isArray(e.tokens) && e.tokens.length ? e.tokens : e.token ? [e.token] : [];
    if (!name || size < BRAND_MIN_OPEN || tokens.length === 0) continue;
    for (const k of brandKeysOf(name)) {
      if (own(base, k) || refuse.has(k) || OCCUPATION_GUARD.has(k) || ENGLISH_STOPWORDS.has(k)) continue;
      const prev = live.get(k);
      if (prev && prev.name !== name) shared.add(k);
      else live.set(k, { tokens, name });
    }
  }
  for (const k of shared) live.delete(k);
  const out: Record<string, { tokens: string[]; name: string }> = { ...base };
  for (const [k, v] of live) out[k] = v;
  liveAliasLast = { base, employers, refuse, out };
  return out;
}

export function pickRoute(
  rawQ: string,
  aliases: Aliases,
  filler?: ReadonlySet<string>,
): RouteDecision {
  const raw = String(rawQ ?? "").trim();
  if (!raw) return { route: "BROWSE", reason: "empty query" };

  const alnum = foldName(raw);
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);

  // Rationale: docs/job-board-index-notes.md#n1521-if-alnum-length-alnum-length-test
  if ((alnum.length >= 3 || (alnum.length === 2 && /[0-9&]/.test(raw))) && !OCCUPATION_GUARD.has(alnum)) {
    // Own keys only: aliases["constructor"] was Object's constructor, and the route threw (n447).
    const hit = own(aliases, alnum) ? aliases[alnum] : filler ? fillerFoldedAliases(aliases, filler).get(alnum) : undefined;
    if (hit && hit.tokens.length > 0) {
      return { route: "EMPLOYER", reason: `whole query matches employer ${hit.name}`, tokens: hit.tokens, matchedName: hit.name };
    }
  }

  // Rationale: docs/job-board-index-notes.md#n1522-if-test-raw
  if (/[+#]/.test(raw)) {
    return { route: "SYMBOL", reason: "symbol query — ranked retrieval, separated by literal scoring" };
  }

  // Rationale: docs/job-board-index-notes.md#n1523-if-tokens-some-isliteraltoken
  if (tokens.some(isLiteralToken)) {
    return { route: "SIMPLE", reason: "query contains a token the english index discards" };
  }
  // R3b — a word the english stemmer merges with a different job (S12-018).
  if (tokens.some(isStemCollision)) {
    return { route: "SIMPLE", reason: "query contains a word the english stemmer merges with another (accountant/account)" };
  }

  // Rationale: docs/job-board-index-notes.md#n1524-return-route-ranked-reason-default
  return { route: "RANKED", reason: "default" };
}

// Rationale: docs/job-board-index-notes.md#n1525-export-const-wordcount-text-string-term
export const wordCount = (text: string, term: string): number => {
  if (!term) return 0;
  const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "gi");
  let n = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    n++;
    if (re.lastIndex > 0) re.lastIndex--;
    if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
  }
  return n;
};

// Rationale: docs/job-board-index-notes.md#n1526-export-function-startswithword-text-stri
// Rationale: docs/job-board-index-notes.md#n1527-export-function-startswithword-text-stri
export function startsWithWord(text: string, prefix: string): boolean {
  if (!prefix || !text.startsWith(prefix)) return false;
  const next = text.charAt(prefix.length);
  return next === "" || !/[a-z0-9]/i.test(next) || !/[a-z0-9]/i.test(prefix.charAt(prefix.length - 1));
}

/** The head-term ring's word boundary as a Postgres regex for `title ~* ...` (L8-05). */
export function ringWordPattern(prefix: string): string {
  const esc = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return /[a-z0-9]$/i.test(prefix) ? `^${esc}([^[:alnum:]]|$)` : `^${esc}`;
}

export function scoreTitle(title: string, query: string, ageDays?: number): number {
  const t = String(title ?? "");
  const tl = t.toLowerCase();
  // Rationale: docs/job-board-index-notes.md#n1528-const-qraw-string-query-replace-g
  const qRaw = String(query ?? "").replace(/"/g, "").trim();
  // Rationale: docs/job-board-index-notes.md#n1529-const-qtokens-qraw-tolowercase-split-a
  const qTokens = qRaw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (qTokens.length === 0) return 0;

  // Rationale: docs/job-board-index-notes.md#n1530-const-present-qtokens-filter-tok-wordcou
  const present = qTokens.filter((tok) => wordCount(tl, tok) > 0).length;
  let score = (100 * present) / qTokens.length;

  const normT = foldName(t);
  const normQ = foldName(qRaw);
  if (normT === normQ) score += 120;                       // "Sales Associate"
  else if (startsWithWord(tl, qRaw.toLowerCase())) score += 45; // "Sales Manager", never "Nursery" for nurse (L8-05)

  if (qTokens.length > 1 && tl.includes(qRaw.toLowerCase())) score += 25; // adjacency

  // Rationale: docs/job-board-index-notes.md#n1531-if-a-z0-s-i-test
  if (/[^a-z0-9\s]/i.test(qRaw) && tl.includes(qRaw.toLowerCase())) score += 90;

  // The ts_rank knob that is not reachable through PostgREST.
  const titleTokens = tl.split(/[^a-z0-9]+/).filter(Boolean).length;
  const extra = Math.max(0, titleTokens - qTokens.length);
  score -= 22 * Math.log(1 + extra);

  // The 4x-"Sales" titles.
  for (const tok of qTokens) score -= 12 * Math.max(0, wordCount(tl, tok) - 1);

  // Tiebreak only — capped so it can never outrank a coverage difference.
  if (typeof ageDays === "number" && Number.isFinite(ageDays) && ageDays >= 0) {
    score += Math.min(12, Math.max(0, 12 - 3 * Math.log(1 + ageDays)));
  }
  return score;
}

// Rationale: docs/job-board-index-notes.md#n1532-const-perk_context
// Rationale: docs/job-board-index-notes.md#n1533-const-perk_context
// Rationale: docs/job-board-index-notes.md#n1534-const-perk_context
const PERK_CONTEXT =
  /\b(membership|reimbursement|discount(s|ed)?|perk|benefit(s)?|allowance|stipend|401\s?k|insurance|pto|gym|wellness|voucher|gift\s?card)\b/i;

export function isPerkListMatch(snippet: unknown): boolean {
  const text = String(snippet ?? "");
  const marks = [...text.matchAll(/\[\[(.+?)\]\]/g)];
  if (marks.length === 0) return false;
  // Rationale: docs/job-board-index-notes.md#n1535-return-marks-every-m
  return marks.every((m) => {
    const at = m.index ?? 0;
    // Rationale: docs/job-board-index-notes.md#n1536-const-from-text-lastindexof-n-at
    const from = text.lastIndexOf("\n", at) + 1;
    const toRaw = text.indexOf("\n", at);
    const line = text.slice(from, toRaw === -1 ? text.length : toRaw);
    return PERK_CONTEXT.test(line);
  });
}

export function rerankWindow<T extends { title?: unknown; company?: unknown; token?: unknown; snippet?: unknown }>(
  rows: readonly T[],
  query: string | readonly string[],
  perCompany = 2,
): T[] {
  const readings = (Array.isArray(query) ? query : [query as string])
    .map((q) => String(q ?? "").trim())
    .filter((q) => q.length > 0);
  const queries = readings.length ? readings : [""];
  const scored = rows.map((r, i) => ({
    r,
    i,
    s: Math.max(...queries.map((q) => scoreTitle(String(r.title ?? ""), q))),
    // Rationale: docs/job-board-index-notes.md#n1537-c-math-max-queries-map-q
    c: Math.max(...queries.map((q) => scoreTitle(String(r.company ?? ""), q))),
  })).map((x) => ({
    ...x,
    // Rationale: docs/job-board-index-notes.md#n1538-cls-x-s-x-c-isperklistmatch
    cls: x.s > 0 ? 0 : x.c > 0 ? 1 : isPerkListMatch(x.r.snippet) ? 3 : 2,
  }));
  // Rationale: docs/job-board-index-notes.md#n1539-scored-sort-a-b-a-cls
  scored.sort((a, b) => (a.cls - b.cls) || (b.s - a.s) || (b.c - a.c) || (a.i - b.i));
  const seen = new Map<string, number>();
  const keep: typeof scored = [];
  const demoted: typeof scored = [];
  for (const x of scored) {
    // Rationale: docs/job-board-index-notes.md#n1540-if-x-cls-keep-push-x
    if (x.cls === 1) { keep.push(x); continue; }
    const key = String(x.r.company ?? x.r.token ?? "").toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    (n <= perCompany ? keep : demoted).push(x);
  }
  return [...keep, ...demoted].map((x) => x.r);
}

/**
 * "engineer not manager" WAS RETURNING MANAGERS.
 *
 * The words were dropped from the tsquery and the remainder re-read as a
 * conjunction, so the query came back as roughly "engineer manager" — the exact
 * opposite of what was asked. "nurse -travel" and "driver not cdl" are the same
 * shape, and they are ordinary refinements a searcher reaches for the moment a
 * result set is nearly right.
 *
 * Split BEFORE any SQL is issued, so every tier — ranked, routed, fuzzy,
 * semantic — searches the positive query and none of them has to know this
 * exists. The exclusion is then applied to what comes back.
 *
 * TWO FORMS, both common and neither ambiguous:
 *   "-token"    a leading hyphen, the convention every search engine uses
 *   "not X"     the ONE token after the word "not", which reads as English
 *
 * ONE TOKEN, not the remainder. "not" used to claim everything after it, and
 * "director not for profit" — a search FOR nonprofit titles — came back as
 * excluded:["for","profit"]: it struck the exact titles asked for AND every
 * title containing the word "for". And when the token after "not" is a
 * stopword, the "not" is the English word inside a phrase, not an operator at
 * all, so both words stay in the positive query.
 *
 * A bare "not" with nothing after it, or a query that is ONLY exclusions, is
 * left alone: stripping it would leave an empty query, and an empty query
 * returns the whole board — "better to run the poor query the person typed
 * than to silently ignore them", as the note above queryTerms puts it.
 */

// Rationale: docs/job-board-index-notes.md#n1541-const-exclusion_stopwords-readonlyset-st
const EXCLUSION_STOPWORDS: ReadonlySet<string> = new Set([
  "for", "the", "a", "an", "of", "in", "at", "to", "on",
]);

const NOT_LEAD_VERB = /^(?:requiring|involving|including|needing)$/i;

export function splitExclusions(raw: string): { positive: string; excluded: string[] } {
  const text = String(raw ?? "").trim();
  if (!text) return { positive: text, excluded: [] };

  // S12-017: a balanced "…" pair is one word, so -"team lead" excludes the phrase (n1410).
  const words = (text.match(/-?"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/\s+/g, " "));
  const positive: string[] = [];
  const excluded: string[] = [];
  let pendingNot: string | null = null;
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (pendingNot !== null) {
      // Rationale: docs/job-board-index-notes.md#n1542-if-exclusion_stopwords-has-w-tolowercase
      if (EXCLUSION_STOPWORDS.has(w.toLowerCase())) positive.push(pendingNot, w);
      // "not requiring night shifts": the verb is not the thing excluded (n1410).
      else if (NOT_LEAD_VERB.test(w) && i + 1 < words.length && !EXCLUSION_STOPWORDS.has(words[i + 1].toLowerCase()) && !/^not$/i.test(words[i + 1])) continue;
      else excluded.push(w.toLowerCase());
      pendingNot = null;
      continue;
    }
    if (/^not$/i.test(w)) { pendingNot = w; continue; }
    if (w.length > 1 && w.startsWith("-")) { excluded.push(w.slice(1).toLowerCase()); continue; }
    positive.push(w);
  }
  const cleanExcluded = [...new Set(excluded.map((e) => e.replace(/^"|"$/g, "").split(" ").map((x) => x.replace(/[^a-z0-9+#.]/gi, "")).filter(Boolean).join(" ").toLowerCase()).filter((e) => e.length >= 2))];
  // Rationale: docs/job-board-index-notes.md#n1543-if-positive-length-cleanexcluded-length
  if (!positive.length || !cleanExcluded.length) return { positive: text, excluded: [] };
  return { positive: positive.join(" "), excluded: cleanExcluded };
}

/** normalize.ts's negated-remote pattern, copied because this file imports nothing; a test pins the copy (n1411). */
export const NEGATED_REMOTE_IN_TITLE = new RegExp("\\b(?:non|not|no)[-\\s]?remote\\b|\\bnot\\s+(?:a\\s+|an\\s+|fully\\s+)?remote\\b|\\bnot\\s+(?:eligible|available|open|considered)\\s+(?:for|to)\\s+remote\\b|\\bremote\\s*[:=(–—-]\\s*(?:no|none)\\s*(?=$|[).|,;·/])|\\b(?:remote|wfh|work\\s+from\\s+home|home\\s?office)\\s*[:=–—-]?\\s*(?:not\\s+(?:available|offered|permitted|an\\s+option)|unavailable)\\b|\\b(?:non|not|no)[-\\s]?(?:wfh|work\\s+from\\s+home|home\\s?office)\\b|\\bno\\s+remote\\s+(?:work|option|options|opportunit(?:y|ies))\\b|\\b(?:keine|kein|nicht)\\s+(?:im\\s+)?home\\s?office\\b|\\b(?:non|sans|aucun)[-\\s]?t[ée]l[ée]travail\\b|\\bpas\\s+de\\s+t[ée]l[ée]travail\\b|\\bt[ée]l[ée]travail\\s*[:=(–—-]\\s*non\\s*(?=$|[).|,;·/])|\\b(?:no|n[ãa]o)[-\\s]?remoto\\b|\\b(?:sin|no)\\s+teletrabajo\\b|\\b(?:geen|niet)\\s+thuiswerken\\b", "gi");

// Rationale: docs/job-board-index-notes.md#n1544-export-function-titleexcluded-title-stri
export function titleExcluded(title: string, excluded: readonly string[]): boolean {
  if (!excluded.length) return false;
  const raw = String(title ?? "").toLowerCase();
  // A title that says "Not Remote" is the posting a remote exclusion asks for (n1411).
  const unsaid = raw.replace(NEGATED_REMOTE_IN_TITLE, " ");
  // S12-017: a phrase matches across a space, hyphen or slash, its last word singular or plural (n1410).
  const re = (e: string) => e.includes(" ") ? `${e.replace(/([^s])s$/, "$1").replace(/ /g, "[\\s/-]+")}s?` : e;
  return excluded.some((e) => new RegExp(`(^|[^a-z0-9])${re(e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))}([^a-z0-9]|$)`, "i").test(e === "remote" ? unsaid : raw));
}
