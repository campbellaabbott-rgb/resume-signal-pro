/**
 * ONE RETRIEVER PER SEARCH, CHOSEN BEFORE ANY SQL IS ISSUED.
 *
 * A nine-agent design review measured this board's search paths under load and
 * ranked three architectures. All three judges rejected multi-arm fusion for the
 * same reason: withDeadline is Promise.race and cannot cancel SQL, so fanning
 * out multiplies UNCANCELLABLE load on a database whose entire incident history
 * is timeouts — and losing one arm silently rewrites 65-70% of the top 20, which
 * is incoherence rather than an error. What they converged on instead is a
 * router: decide the class up front, use exactly one retriever, and re-rank its
 * window in memory.
 *
 * Deciding the class UP FRONT is also what fixes the shipped tier's fatal flaw.
 * That tier only ran when the primary path returned ZERO rows, so the queries
 * that return a full page of WRONG answers — the larger class — could never
 * reach it. A pre-SQL router has no such gate.
 *
 * Everything here is a PURE FUNCTION of the query string, which is why this file
 * exists at all: the edge function cannot be imported by the test runner, so
 * logic left inside it can only be checked by matching source text. A review
 * found two of my guards passing while the code they described had been deleted.
 * These are imported and executed by the tests.
 */

/** Fold to letters and digits: "AT&T" -> "att", "Domino's" -> "dominos". */
export const foldName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Occupations and ordinary words that must NEVER resolve to an employer.
 *
 * Several are real companies on this board — Target, Shell, Oracle, Apple. They
 * are excluded anyway: someone typing "shell" almost certainly means the
 * industry or the word, and routing them to one employer hides every other
 * company's jobs behind a filter they never set and cannot see. "shell assessed
 * internship program" is a real query from this board's own miss log.
 *
 * The cost of the guard is that those employers are unreachable by name; the
 * cost of omitting it is that a common word silently collapses the board. The
 * first is a missing feature, the second is a wrong answer.
 */
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
]);

/** English stopwords the 'english' tsvector discards, so a query containing one
 *  cannot be served by the stored english index at all. q="IT" retrieves
 *  nothing there; q="it manager" degenerates to "manager" and returns 92,919
 *  rows of which 99.2% do not contain the typed words. */
export const ENGLISH_STOPWORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "if", "then", "else", "when", "at", "by",
  "for", "with", "about", "into", "to", "from", "up", "down", "in", "out", "on",
  "off", "over", "under", "again", "no", "nor", "not", "only", "own", "same",
  "so", "than", "too", "very", "can", "will", "just", "it", "its", "is", "are",
  "was", "were", "be", "been", "being", "do", "does", "did", "of", "as", "who",
]);

export type Route = "BROWSE" | "EMPLOYER" | "SYMBOL" | "SIMPLE" | "RANKED";

/**
 * Which RETRIEVER a route uses. Deliberately not one-to-one with the route: a
 * SYMBOL query is a distinct class worth naming in the response and the
 * telemetry, but it is served by the ranked retriever because every literal
 * matcher measured too slow under concurrency and the ranked window already
 * contains the rows the scorer needs.
 */
export const RETRIEVER_FOR: Readonly<Record<Route, "browse" | "company" | "simple" | "ranked">> = {
  BROWSE: "browse",
  EMPLOYER: "company",
  SYMBOL: "ranked",
  SIMPLE: "simple",
  RANKED: "ranked",
};

export interface RouteDecision {
  route: Route;
  /** Why, verbatim, for the response and for telemetry. A route nobody can
   *  explain is a route nobody can debug. */
  reason: string;
  /** EMPLOYER only: the company_token values to filter on. */
  tokens?: string[];
  /** EMPLOYER only: the display name, for disclosure. */
  matchedName?: string;
}

/**
 * Pick the single retriever for a query.
 *
 * ORDER MATTERS AND IS NOT THE ORDER THE DESIGN PROPOSED. The original put the
 * stopword rule before the two-token rule, which sent "sales rep", "hr manager"
 * and "it manager" down the unranked path — the keyword-stuffing defect walking
 * straight back in through the side door. Symbols and employers are decided
 * first because they are unambiguous; the stopword rule only claims a query no
 * other rule wanted.
 */
export function pickRoute(
  rawQ: string,
  aliases: Readonly<Record<string, { tokens: string[]; name: string }>>,
): RouteDecision {
  const raw = String(rawQ ?? "").trim();
  if (!raw) return { route: "BROWSE", reason: "empty query" };

  const alnum = foldName(raw);
  const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);

  // R1 — the WHOLE query is a known employer name. Whole-query only: a prefix
  // match ("medical assistant" -> a company called Medical) hijacked 7.8% of
  // real job titles when it was tried, measured by replaying the board's own
  // titles as queries.
  if (alnum.length >= 3 && !OCCUPATION_GUARD.has(alnum)) {
    const hit = aliases[alnum];
    if (hit && hit.tokens.length > 0) {
      return { route: "EMPLOYER", reason: `whole query matches employer ${hit.name}`, tokens: hit.tokens, matchedName: hit.name };
    }
  }

  // R2 — symbols. The parser strips "++" and "#" under EVERY configuration, so
  // wfts(simple).c++ and wfts(simple).c# are byte-identical at 1,437 rows of
  // which ~71% contain neither string.
  //
  // THIS ROUTE DELIBERATELY HAS NO RETRIEVER OF ITS OWN. Three literal matchers
  // were measured UNDER CONCURRENCY 4, which is the only measurement that
  // counts here — everything looks fine at one request at a time, and that is
  // exactly how a sequential scan reached production this morning:
  //     title=ilike.'c++%'   (prefix)    0.25-0.43s   but only 60 rows
  //     title=ilike.'%c++%'  (contains)  1.9-2.7s     311 rows
  //     title=imatch '\yc\+\+'          3.1-3.5s     311 rows
  // The regex is 0.35s SERIALLY and 3.5s at four callers. Prefix is the only
  // safe one and it costs 80% of the recall.
  //
  // None of them is needed. The ranked window ALREADY holds the answers: of the
  // 200 rows search_jobs returns for "c++", 38 contain the literal string, and
  // 25 do for "c#". The scorer's +90 literal-substring rule floats them to the
  // top for free. So a symbol query takes the ranked retriever and is separated
  // by SCORING, not by a second query. The label is kept because it belongs in
  // the disclosure and the telemetry.
  if (/[+#]/.test(raw)) {
    return { route: "SYMBOL", reason: "symbol query — ranked retrieval, separated by literal scoring" };
  }

  // R3 — anything the english index cannot see. A stopword or a one-to-three
  // character token is absent from the stored english tsvector, so that path is
  // either blind (q="IT" -> 0 rows) or answering a different question
  // (q="it manager" -> 92,919 rows for "manager").
  if (tokens.some((t) => ENGLISH_STOPWORDS.has(t) || foldName(t).length <= 3)) {
    return { route: "SIMPLE", reason: "query contains a token the english index discards" };
  }

  // R4 — everything else keeps the path it has always had. GENERIC was proposed
  // as a fifth route and all three judges rejected it: it selects candidates by
  // recency, which silently converts the board to a date sort for every head
  // term. The scorer fixes those on the RANKED path instead, without changing
  // what is retrieved.
  return { route: "RANKED", reason: "default" };
}

/** Whole-word occurrences of `term` in `text`. */
const wordCount = (text: string, term: string): number => {
  if (!term) return 0;
  const re = new RegExp(`(^|[^a-z0-9])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "gi");
  let n = 0;
  while (re.exec(text) !== null) { n++; if (re.lastIndex > 0) re.lastIndex--; }
  return n;
};

/**
 * Score one title against the query. Higher is better.
 *
 * THIS IS THE PIECE THAT FIXES q="sales", AND IT IS NOT A RETRIEVAL PROBLEM.
 * All 959 postings titled exactly "Sales Associate" are already inside both the
 * english and the simple candidate sets — verified by intersection, 959/959 in
 * each. They never reach the top 100 because ts_rank's default normalization
 * applies NO document-length penalty, so a title repeating "sales" four times
 * outranks the exact match. Measured on the live board: the top 100 for
 * q="sales" have a median title length of 53 characters and a median of 2
 * occurrences; the control q="welder" has median length 14.5 and 31 exact-title
 * hits in its top 100.
 *
 * Pure, deterministic, and about 4ms for 600 rows — unmeasurable against ~1,050ms
 * of fixed edge overhead.
 */
export function scoreTitle(title: string, query: string, ageDays?: number): number {
  const t = String(title ?? "");
  const tl = t.toLowerCase();
  const qRaw = String(query ?? "").trim();
  const qTokens = qRaw.toLowerCase().split(/\s+/).map(foldName).filter(Boolean);
  if (qTokens.length === 0) return 0;

  // Coverage is the floor everything else modifies: a title missing half the
  // query cannot be rescued by being short or fresh.
  const present = qTokens.filter((tok) => wordCount(tl, tok) > 0).length;
  let score = (100 * present) / qTokens.length;

  const normT = foldName(t);
  const normQ = foldName(qRaw);
  if (normT === normQ) score += 120;                       // "Sales Associate"
  else if (tl.startsWith(qRaw.toLowerCase())) score += 45; // "Sales Manager"

  if (qTokens.length > 1 && tl.includes(qRaw.toLowerCase())) score += 25; // adjacency

  // The ONLY thing that separates c++ from c#: the parser destroys both, so a
  // literal check is the entire signal.
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

/**
 * Re-rank a window by score, then cap any one employer at `perCompany` rows.
 *
 * Demoted, never dropped: one employer with 142 of the 1,000 intern postings
 * should not own page one, but its jobs are still real and still wanted further
 * down. Dropping them would be a different lie from the one being fixed.
 */
/**
 * SCORE AGAINST THE BEST READING OF THE QUERY, NOT ONLY THE TYPED ONE.
 *
 * `query` widened to a list because alias expansion and re-ranking were working
 * against each other: expandQuery widens retrieval so "pm" also finds "Product
 * Manager", and then this function scored every one of those rows against the
 * literal string "pm" — which they do not contain. The alias rows landed at the
 * bottom of the very window they were fetched into, so page one stayed full of
 * whatever literally spelled "pm", and the expansion bought nothing a searcher
 * could see. That is the whole set the alias table was written for: pm, pa, ta,
 * np, ba, ai, rn.
 *
 * Math.max over the readings, so a row scores as well as its BEST
 * interpretation — never worse than today, because the typed query is always
 * one of the readings.
 *
 * Still a single string at every existing call site: the extra readings are
 * optional and callers that pass none behave exactly as before.
 */
export function rerankWindow<T extends { title?: unknown; company?: unknown; token?: unknown }>(
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
  }));
  // Index breaks ties so the order is total and identical on every call —
  // pagination over an unstable ordering is how page two repeated page one.
  scored.sort((a, b) => (b.s - a.s) || (a.i - b.i));
  const seen = new Map<string, number>();
  const keep: typeof scored = [];
  const demoted: typeof scored = [];
  for (const x of scored) {
    const key = String(x.r.company ?? x.r.token ?? "").toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    (n <= perCompany ? keep : demoted).push(x);
  }
  return [...keep, ...demoted].map((x) => x.r);
}
