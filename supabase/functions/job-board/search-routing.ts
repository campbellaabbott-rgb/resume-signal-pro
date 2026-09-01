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

/** Fold to letters and digits: "AT&T" -> "att", "Domino's" -> "dominos".
 *
 *  Diacritics TRANSLITERATE (NFD, strip the combining marks), never delete:
 *  the old fold removed the accented letter wholesale, so "L'Oréal" became
 *  "loral" — a string that matches neither the typed name nor anything the
 *  board stores, which silently unreached every accented employer. */
export const foldName = (s: string): string =>
  s.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "");

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
  // Place names + common words from the 2026-08-21 alias regeneration. Each of
  // these IS a real alias key — pickRoute("wisconsin") collapsed the whole
  // board to the University of Wisconsin, "flex" to Flextronics, "mars" to the
  // candy company — and the rule is the same one the block above paid for: a
  // common word must never silently collapse the board to one employer. The
  // regeneration will keep minting keys like these; anything a person types as
  // a place, an acronym or an English word belongs here, not in the aliases.
  "ace", "arrow", "benchmark", "card", "continental", "flex", "infuse", "ing",
  "intuitive", "mars", "nov", "republic", "rochester", "sec", "wisconsin",
  "wood",
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

/**
 * Whole-word occurrences of `term` in `text`. Exported so the tests execute
 * the real counter rather than a copy of it.
 *
 * THE REWIND IS LOAD-BEARING: each match consumes its trailing boundary
 * character, which is the LEADING boundary of an adjacent occurrence, so
 * without stepping back one the 4x-"Sales" titles the repetition penalty
 * exists for count as 2, not 4. But rewinding by one re-finds the SAME match
 * forever when the whole match is a single character with empty boundaries on
 * both sides — foldName("c++") is "c", a retrieved title "C" matches at
 * [0,1), the rewind put the cursor back to 0, and scoreTitle("C", "c++")
 * never returned. One one-letter title in the window hung the entire search.
 * Forward progress is now guaranteed: the cursor never lands at or behind the
 * start of the match it just counted, which changes no count on any input the
 * old loop could finish.
 */
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
  // Split on NON-ALPHANUMERICS — the SAME split the titles get below. The old
  // whitespace-split-then-foldName fused punctuated queries into tokens no
  // title tokenization can produce: "k-8 teacher" carried a token "k8" that
  // matched nothing, so "Teacher, K-8" scored BELOW "Math Teacher"; "c++/c#"
  // became "cc" and lost to "CEO". qRaw stays untouched on purpose — the
  // literal-substring rule below is the entire c++/c# signal and reads it raw.
  const qTokens = qRaw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
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
/**
 * THE QUERY MATCHED A PERKS LIST, NOT THE JOB.
 *
 * Measured 2026-09-01 on live results for q="Costco": positions 7, 9 and 10
 * were a plumbing dispatcher, a CNC machinist and a project manager, and the
 * board was right that each description contains the word —
 *
 *   "Company Paid Gym Membership, [[Costco]] Membership & Chiropractic Care"
 *   "[[Costco]] membership option"
 *   "[[Costco]] Membership Reimbursement"
 *
 * — every one of them an employer brand appearing in a benefits enumeration.
 * Position 8 matched the same single word and was genuinely relevant
 * ("regular travel to [[Costco]] Wholesale stores"), which is why the rule
 * reads the CONTEXT of the match rather than counting occurrences: a mention
 * is not noise because it is brief, it is noise because of the list it sits
 * in. Perks lists are where brand names go to be irrelevant, and this pattern
 * generalises past one warehouse club — a gift card, a free coffee and a gym
 * discount all name a company that is not hiring.
 *
 * Reads ts_headline's own marked snippet, so it sees exactly the text the
 * match was made on. A row with no snippet, or whose marked context is
 * anything else, is NOT boilerplate — the default is to keep.
 */
const PERK_CONTEXT =
  /\b(membership|reimbursement|discount(s|ed)?|perk|benefit(s)?|allowance|stipend|401\s?k|insurance|pto|gym|wellness|voucher|gift\s?card)\b/i;

export function isPerkListMatch(snippet: unknown): boolean {
  const text = String(snippet ?? "");
  const marks = [...text.matchAll(/\[\[(.+?)\]\]/g)];
  if (marks.length === 0) return false;
  // EVERY marked occurrence has to be perks context. One mention in the body
  // of the role is enough to keep the row, however many perks lists follow it.
  return marks.every((m) => {
    const at = m.index ?? 0;
    // Scoped to the LINE the match sits on, not a character window. Perks are
    // written one per line ("Costco Membership Reimbursement"), and a fixed
    // window bleeds into whatever section follows — on a short snippet that
    // meant a match in the body of the role inherited the benefits list below
    // it and was buried for its neighbour's words.
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
    // THE EMPLOYER'S OWN JOBS, WHEN THE TITLE SAYS NOTHING EITHER WAY.
    //
    // Measured 2026-09-01 by scoring served results: q="Costco" put a
    // plumbing dispatcher and a substitute teacher in the top ten — rows the
    // description tier had legitimately matched, tied at a title score of
    // zero and then ordered by nothing. Meanwhile an actual Costco job
    // titled "Cashier" scores zero too, because the query names the employer
    // and not the work.
    //
    // Deliberately a TIEBREAK, never a boost: it is read only when the title
    // scores are equal, so it cannot reorder a query the title already
    // separates. That is what keeps it away from occupation searches, which
    // measured ~1.00 precision@5 and had nothing to gain here — "nurse" must
    // not start preferring a company called Nurse Staffing over nursing
    // jobs, and under a tiebreak it cannot.
    c: Math.max(...queries.map((q) => scoreTitle(String(r.company ?? ""), q))),
  })).map((x) => ({
    ...x,
    // RELEVANCE CLASS, because a tiebreak below scoreTitle would never fire.
    //
    // scoreTitle PENALISES LENGTH, so two irrelevant rows are almost never
    // equal: measured against q="Costco", "Dispatcher" scores 0 while "Brand
    // Ambassador" scores -15.2, and a key placed after it is unreachable in
    // practice. Ordering by class first is what makes the two facts below
    // actually decide anything.
    //
    //   0 — the title carries the query. Untouched: this is the signal that
    //       measured ~1.00 precision@5 and nothing here may reorder it.
    //   1 — no title signal, but the COMPANY carries the query. The
    //       employer's own job for an employer-named search ("Cashier" at
    //       Costco Wholesale), which used to tie with pure noise at zero.
    //   2 — no signal either way.
    //   3 — no signal AND the only match sits in a perks list. Last, because
    //       "Costco Membership Reimbursement" in a benefits enumeration tells
    //       a searcher nothing about the job.
    cls: x.s > 0 ? 0 : x.c > 0 ? 1 : isPerkListMatch(x.r.snippet) ? 3 : 2,
  }));
  // Index breaks ties so the order is total and identical on every call —
  // pagination over an unstable ordering is how page two repeated page one.
  scored.sort((a, b) => (a.cls - b.cls) || (b.s - a.s) || (b.c - a.c) || (a.i - b.i));
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

/** Stopword-grade words that must never become an exclusion. A "not" followed
 *  by one of these is part of a phrase ("not for profit"), and excluding a
 *  stopword strikes half the board by coincidence of grammar. */
const EXCLUSION_STOPWORDS: ReadonlySet<string> = new Set([
  "for", "the", "a", "an", "of", "in", "at", "to", "on",
]);

export function splitExclusions(raw: string): { positive: string; excluded: string[] } {
  const text = String(raw ?? "").trim();
  if (!text) return { positive: text, excluded: [] };

  const words = text.split(/\s+/);
  const positive: string[] = [];
  const excluded: string[] = [];
  let pendingNot: string | null = null;
  for (const w of words) {
    if (pendingNot !== null) {
      // "not" marks exactly this one token — never the whole remainder — and
      // a stopword-grade token vetoes the operator reading entirely.
      if (EXCLUSION_STOPWORDS.has(w.toLowerCase())) positive.push(pendingNot, w);
      else excluded.push(w.toLowerCase());
      pendingNot = null;
      continue;
    }
    if (/^not$/i.test(w)) { pendingNot = w; continue; }
    if (w.length > 1 && w.startsWith("-")) { excluded.push(w.slice(1).toLowerCase()); continue; }
    positive.push(w);
  }
  const cleanExcluded = [...new Set(excluded.map((e) => e.replace(/[^a-z0-9+#.]/gi, "").toLowerCase()).filter((e) => e.length >= 2))];
  // Nothing left to search means the exclusion has eaten the query. Run what
  // they typed instead of returning the entire board.
  if (!positive.length || !cleanExcluded.length) return { positive: text, excluded: [] };
  return { positive: positive.join(" "), excluded: cleanExcluded };
}

/** Does a title contain any excluded term? Word-ish match, so "manager" does
 *  not strike out "management-adjacent" by coincidence of substring. */
export function titleExcluded(title: string, excluded: readonly string[]): boolean {
  if (!excluded.length) return false;
  const t = String(title ?? "").toLowerCase();
  return excluded.some((e) => new RegExp(`(^|[^a-z0-9])${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i").test(t));
}
