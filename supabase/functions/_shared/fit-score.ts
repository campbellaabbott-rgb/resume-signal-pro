// Deterministic posting↔resume fit, shared by application-fit (single) and
// job-board fit-batch (many). The dictionary is the scanner's own detection
// tables, so a term only counts when it's both in the posting and something
// the engine actually recognizes. No AI — fast, free, reproducible.

import { INDUSTRY_KEYWORDS } from "./industry-detection.ts";

const DICTIONARY: string[] = (() => {
  const set = new Set<string>();
  for (const data of Object.values(INDUSTRY_KEYWORDS)) {
    for (const list of [data.primary, data.secondary, data.certifications, data.titles]) {
      for (const term of list) {
        const t = term.toLowerCase().trim();
        if (t.length >= 3) set.add(t);
      }
    }
  }
  // Longest first so "project management" wins before "project".
  return [...set].sort((a, b) => b.length - a.length);
})();

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// One compiled RegExp per dictionary term, built on first use. The old code
// compiled a fresh RegExp on EVERY containsTerm call — and a fit-batch call
// makes hundreds of thousands of them (dictionary x 60 postings, plus
// dictionary x 60 identical resume scans). The cache is bounded by the
// dictionary and is a per-isolate compile cache, not cross-request state —
// its only job is to stop the same pattern being compiled twice in one call.
const TERM_RE = new Map<string, RegExp>();
const containsTerm = (haystack: string, term: string) => {
  let re = TERM_RE.get(term);
  if (!re) {
    re = new RegExp(`(^|[^a-z0-9])${escapeRegex(term)}([^a-z0-9]|$)`, "i");
    TERM_RE.set(term, re);
  }
  return re.test(haystack);
};

export interface FitResult {
  pct: number | null; // null = the posting contains no recognized terms
  matched: string[];
  missing: string[];
  totalRecognized: number;
  /** Share of the JOB's terms the résumé answers. This is what `pct` used to
   *  be, kept because it is the honest input to the "you're missing X" copy. */
  coverage: number;
  /** Share of the RÉSUMÉ's terms this job is about. Low for a broad CV against
   *  a narrow role — that is correct, and it is what stops padding paying. */
  precision: number;
  /** What the reach demotion multiplied the keyword score by. 1 means the
   *  posting states no minimum, the résumé states no history, or the reader is
   *  within reach of it — the three cases where seniority says nothing. */
  reach: number;
}

/**
 * THE SCORE HAD NO RÉSUMÉ TERM IN ITS DENOMINATOR, SO PADDING WAS FREE.
 *
 * It was `matched / postingTerms` — pure recall. That asks only "what share of
 * this job's terms appear somewhere in the résumé", and nothing about how much
 * of the résumé is actually about this job. A document containing every term
 * the scorer knows therefore matched ~100% of every posting.
 *
 * MEASURED, 25 live "software engineer" postings and 15 live "registered nurse"
 * postings, four résumés of the same nine-year career:
 *
 *                        OLD (recall)      NEW (F1)
 *   prose SWE                  11.4          13.5
 *   same career, skills list   37.4          32.8
 *   the dictionary itself     100.0           1.4     <- the exploit
 *   nurse résumé (control)      1.8           2.0
 *
 * On nursing postings the nurse résumé stays top (24.2) and the software
 * résumé stays low (5.3), so cross-field separation is preserved — it was the
 * thing most at risk from adding a precision term, and it did not move.
 *
 * WHY F1 AND NOT A PRETTIER CURVE. A sqrt rescale makes real matches look
 * better (prose 13.5 -> 36) and was tempting, but it also revives the exploit
 * to 11.9 and leaks cross-field (a software résumé scores 20.9 on nursing
 * jobs). That is cosmetics dressed as measurement. The raw harmonic mean is
 * the number we can defend; if the RANGE reads low, the fix is a labelled band
 * in the UI, not a curve that flatters the input.
 *
 * WHAT THIS DOES NOT FIX. Prose still scores below the same career written as
 * a skills list — 2.4x, down from 3.3x but not gone. That gap is inherent to
 * substring matching: "led the migration to Kubernetes" and "Kubernetes" are
 * the same fact and only one of them is a term. Closing it needs semantic
 * matching, not arithmetic.
 */
/** A résumé scanned once, reusable across a whole batch of postings. */
export interface ResumeScan {
  lower: string;
  terms: string[];
  /** Years of experience the document itself evidences, or null if unreadable. */
  years: number | null;
}

/**
 * THE SCORE READ EVERY WORD OF THE POSTING EXCEPT THE ONE THAT DECIDES.
 *
 * A posting that says "minimum of 8 years" is not a match for a reader with
 * two, however many of its words they share — and the words are exactly what
 * they DO share, because a new graduate's résumé and a staff engineer's are
 * written about the same technologies. Measured on the offline corpus
 * (src/test/fixtures/cv-matching-corpus.ts) before this existed: a new
 * graduate's CV scored the Staff Software Engineer posting 37 and the
 * Software Engineer II posting 35, so the one job that would not interview her
 * came first. Across the corpus, in-reach postings outranked out-of-reach ones
 * in their own occupation 76% of the time — a coin-flip dressed as a ranking.
 *
 * The two inputs are already honest and already stored. `min_years` on the
 * posting is a real number pulled from the posting's own text by
 * job-board/experience.ts — never inferred, null when the posting does not say.
 * The reader's side is read here, from employment date ranges and from any
 * explicit "N years of experience" claim, and is null when the document gives
 * nothing to read. Null on EITHER side means no adjustment: a fit we cannot
 * ground is left exactly where the keyword score put it.
 *
 * WHY A DEMOTION AND NOT A FILTER. A stretch is a real application, people make
 * them every day, and the board's own copy calls the bottom tier "stretch". The
 * posting keeps its score, its explanation and its place in the list; it stops
 * outranking the jobs the reader can actually get.
 *
 * WHY NOTHING HAPPENS IN THE OTHER DIRECTION. Over-qualification is not a
 * mismatch: a fourteen-year driver taking a local route and an eleven-year
 * teacher taking a classroom are both ordinary. The corpus was labelled for it
 * and the labels came out contested, so no penalty is applied — a rule nobody
 * can label is a preference, not an accuracy fix.
 */
/** Years short of a stated minimum that still counts as within reach. */
export const REACH_MARGIN_YEARS = 3;

/**
 * How far a posting's score falls when the reader misses its stated minimum.
 * Roughly one tier at the boundary, and never below 0.4 however large the gap:
 * a job that says fifteen years is not zero to a reader with two, it is a long
 * shot, and zero is a claim about the match that we cannot make.
 *
 * THE FLOOR WAS CHOSEN BY SWEEPING IT, not by taste. The demotion trades one
 * measure against another and the trade is real: pushing an unreachable job
 * down its own occupation's list lets an unrelated job move up. Across the
 * offline corpus (in-reach-beats-out-of-reach %, R-precision %):
 *
 *   no demotion              76.3   94.4
 *   floor 0.30 base 0.50    100.0   86.1
 *   floor 0.40 base 0.60    100.0   88.9   <- the knee, and what ships
 *   floor 0.50 base 0.70     92.1   88.9
 *   floor 0.70 base 0.85     84.2   91.7
 *
 * 0.40/0.60 buys the whole seniority correction for the smallest R-precision
 * cost available; below it the cost grows and buys nothing more. The residual
 * R-precision loss is a nurse's own Chief Nursing Officer posting falling below
 * an unrelated clinical row, which reads worse on that metric than it does to
 * the reader: both rows are jobs she will not get, and only one of them was
 * ranked as though she could.
 */
export function reachFactor(postingMinYears: number | null, resumeYears: number | null): number {
  if (postingMinYears == null || resumeYears == null) return 1;
  const short = postingMinYears - resumeYears - REACH_MARGIN_YEARS;
  if (short <= 0) return 1;
  return Math.max(0.4, 0.6 - 0.02 * short);
}

/**
 * Years of experience the résumé evidences. Two readings, and the LARGER wins,
 * because every way this number can be wrong should make the reader look more
 * senior, not less: an inflated estimate leaves a posting where the keyword
 * score put it, while a deflated one demotes a job the reader could have had.
 *
 *   1. The span of the employment dates — first start to last end. A degree's
 *      date range inflates it, which is the safe direction.
 *   2. Any explicit "N years of experience" the document claims.
 */
export function resumeYears(resumeText: string): number | null {
  const t = resumeText.toLowerCase().replace(/[\u2010-\u2015]/g, "-");
  let minStart = Infinity;
  let maxEnd = -Infinity;
  const nowYear = new Date().getUTCFullYear();
  const range = /\b(19[7-9]\d|20[0-5]\d)\s*-\s*(19[7-9]\d|20[0-5]\d|present|current|now|today)\b/g;
  let m: RegExpExecArray | null;
  while ((m = range.exec(t)) !== null) {
    const start = Number(m[1]);
    const end = /^\d/.test(m[2]) ? Number(m[2]) : nowYear;
    if (end < start || end > nowYear + 1) continue;
    minStart = Math.min(minStart, start);
    maxEnd = Math.max(maxEnd, end);
  }
  const span = maxEnd >= minStart ? maxEnd - minStart : null;

  let claimed: number | null = null;
  const claim = /(\d{1,2})\s*\+?\s*years?\b[^.?!\n]{0,30}?(?:experience|exp\b|work|professional|industry|career)/g;
  while ((m = claim.exec(t)) !== null) {
    const n = Number(m[1]);
    if (n >= 0 && n <= 45) claimed = Math.max(claimed ?? 0, n);
  }

  const best = Math.max(span ?? -1, claimed ?? -1);
  return best < 0 ? null : Math.min(45, best);
}

/**
 * THE RÉSUMÉ DOES NOT CHANGE BETWEEN POSTING 1 AND POSTING 60.
 *
 * fit-batch called computeFit(posting, resumeText) in a loop, and every call
 * re-lowercased the same 50KB résumé and re-walked the ENTIRE dictionary
 * against it to rebuild the identical resumeTerms list — the full-corpus scan,
 * the expensive half of the function, sixty times for one answer. Scan it once
 * here and hand the result to every computeFit in the batch.
 */
export function scanResume(resumeText: string): ResumeScan {
  const lower = resumeText.toLowerCase();
  // The résumé's own breadth, scanned the SAME way as the posting so the two
  // sides are commensurable. Deliberately uncapped: capping it at maxTerms
  // would re-open the padding exploit, because a padded résumé would have its
  // denominator truncated to the same 60 the posting gets.
  const terms: string[] = [];
  for (const term of DICTIONARY) {
    if (terms.some((p) => p.includes(term))) continue;
    if (containsTerm(lower, term)) terms.push(term);
  }
  // Read once here for the same reason the term list is: it is a property of
  // the résumé, not of the posting, and fit-batch asks about twenty postings.
  return { lower, terms, years: resumeYears(resumeText) };
}

/**
 * @param postingMinYears the posting's OWN stated minimum, from `min_years`.
 *   null (the default, and what every caller that does not read the column
 *   passes) means no experience adjustment at all.
 */
export function computeFit(
  jobPosting: string,
  resume: string | ResumeScan,
  maxTerms = 60,
  postingMinYears: number | null = null,
): FitResult {
  const postingLower = jobPosting.toLowerCase();
  const scan = typeof resume === "string" ? scanResume(resume) : resume;

  const postingTerms: string[] = [];
  for (const term of DICTIONARY) {
    if (postingTerms.length >= maxTerms) break;
    if (postingTerms.some((p) => p.includes(term))) continue;
    if (containsTerm(postingLower, term)) postingTerms.push(term);
  }

  // Against the résumé TEXT, not its term list: a posting term can be covered
  // by a longer résumé term ("management" inside "project management") and
  // still be a genuine match.
  const matched = postingTerms.filter((t) => containsTerm(scan.lower, t));
  const missing = postingTerms.filter((t) => !containsTerm(scan.lower, t));

  if (postingTerms.length === 0) {
    // NOT ZERO. Zero says "you are a bad match"; this says "we could not read
    // this posting". The reach factor is 1 here rather than 0 for the same
    // reason — there is nothing to demote.
    return { pct: null, matched, missing, totalRecognized: 0, coverage: 0, precision: 0, reach: 1 };
  }

  const coverage = matched.length / postingTerms.length;
  const precision = scan.terms.length ? matched.length / scan.terms.length : 0;
  const reach = reachFactor(postingMinYears, scan.years);
  const raw = coverage === 0 || precision === 0
    ? 0
    : ((2 * coverage * precision) / (coverage + precision)) * 100;
  // A demoted match is still a match. Rounding a real overlap down to 0 would
  // print the one number this file refuses to print without meaning it.
  const pct = raw === 0 ? 0 : Math.max(1, Math.round(raw * reach));

  return { pct, matched, missing, totalRecognized: postingTerms.length, coverage, precision, reach };
}

/**
 * THE RÉSUMÉ COULD SCORE A POSTING BUT NEVER FIND ONE.
 *
 * Reported 2026-09-01: "I tried this drop resume feature and it didn't match me
 * to applicable jobs." The scorer was not the problem — the candidates were.
 * Dropping a résumé scored ONLY the postings already loaded in the board's
 * window and re-sorted those. On the default browse that window is the newest
 * 60 of 814,859 openings, chosen by recency and related to nobody's résumé, so
 * the feature reordered sixty irrelevant rows under a header claiming fit
 * ranking. Nothing was ever retrieved.
 *
 * Measured live, four résumés, mean fit over the scored window:
 *
 *                  loaded window    résumé-derived search
 *   senior SWE           4.5               17.1
 *   ICU nurse            2.9               12.5
 *   sales AE             3.8               11.6
 *   accountant           1.4               15.3
 *
 * and rows scoring zero fell from 7-14 of 20 to 0-1.
 *
 * THE RETRIEVAL KEY IS THE ROLE, NOT THE SKILL LIST. Searching "TypeScript"
 * returns everything that mentions it; "software engineer" returns the job. So
 * this reads role TITLES out of the résumé and hands them to the ordinary
 * search — the same path a typed query takes, keeping its ranking, its filters
 * and its disclosure rather than inventing a second retrieval engine.
 *
 * WHY SINGLE-WORD TITLES ARE TREATED DIFFERENTLY. "electrician", "paralegal"
 * and "welder" are whole occupations and have to work. "manager" and "analyst"
 * sit in the same list and appear in half of all résumés as a fragment of
 * something else. A single word therefore counts only where the headline lives
 * — the top of the document — while a multi-word title counts anywhere. Any
 * term contained in a longer match is then dropped as the vaguer way to say the
 * same thing, which is also what keeps "manager" from beating "product manager".
 */
/**
 * A FOUNDER'S RÉSUMÉ SEARCHED THE BOARD FOR "GO-TO-MARKET".
 *
 * Reported 2026-09-03 as "the drop didn't work". Reproduced against fit-terms:
 * every résumé that mentions go-to-market got it as the FIRST term — ahead of
 * the actual job title even on a software engineer's CV — and for a Founder &
 * CEO or a Chief of Staff it was the ONLY term. The client searches terms[0],
 * so the board ran q=go-to-market, a strategy phrase that names no job, and
 * fit-ranked whatever that returned. It looked like nothing happened.
 *
 * Two causes. The sales `titles` list carries "gtm" and "go-to-market" as if
 * they were occupations (the same phrase sits in product_management.primary,
 * where it belongs: it is a skill). And the scanner has no executive titles
 * at all, so a founder's headline resolves to nothing and a stray skill wins.
 * The classifier's dictionary is frozen at v9 and feeds industry detection, so
 * it is not edited; the exclusion and the supplement live here, at the one
 * place that turns that dictionary into search queries.
 */
const NOT_AN_OCCUPATION = new Set(["gtm", "go-to-market"]);
/** Roles the industry lists never carried because no industry owns them. */
const GENERAL_TITLES = [
  "founder", "co-founder", "cofounder", "ceo", "chief executive officer",
  "coo", "chief operating officer", "cto", "chief technology officer",
  "cfo", "chief financial officer", "chief of staff", "managing director",
  "general manager", "vice president", "executive director",
];
/**
 * FOUND FROM THE BOARD'S OWN TITLES, NOT GUESSED. scripts/role-vocab-gaps.ts
 * (2026-09-03, 800 newest postings, 455 distinct headline titles) ran the
 * scanner over each title as a résumé headline: only 43% resolved to a term.
 * The industry dictionary is professional and clinical; the board is also
 * grocery aisles, auto-parts counters and bank branches, and a reader whose
 * headline is "Deli Clerk" or "Relationship Banker" got the silent fallback.
 * These are the unresolved titles that name an occupation (activities and
 * fragments the normaliser produced — "packaged", "program", "checker" — are
 * deliberately not here). Multi-word so they cannot false-match a bullet.
 */
const COMMON_TITLES = [
  "store driver", "retail parts pro", "commercial parts pro", "parts pro",
  "relationship banker", "personal banker", "leasing professional", "leasing consultant",
  "deli clerk", "meat clerk", "bakery clerk", "produce clerk", "grocery clerk",
  "courtesy clerk", "pharmacy clerk", "delicatessen clerk", "market grille clerk",
  "coffee shop barista", "facilities coordinator", "mechanical technician",
  "application developer", "client services representative", "operating engineer",
  "mechatronics technician", "robotics technician", "order fulfillment associate",
];
const TITLE_VOCAB: string[] = (() => {
  const set = new Set<string>();
  for (const data of Object.values(INDUSTRY_KEYWORDS)) {
    for (const term of data.titles) {
      const t = term.toLowerCase().trim();
      if (NOT_AN_OCCUPATION.has(t)) continue;
      // A bare word needs length to be an occupation; "rep" and "aide" are not
      // queries. A multi-word title carries its own specificity.
      if (t.includes(" ") ? t.length >= 4 : t.length >= 6) set.add(t);
    }
  }
  // The supplement bypasses the length rule ("ceo" is three letters and a
  // job); as bare words they still need to be in the headline to count, which
  // is what stops "reported to the CEO" in a bullet from hijacking the query.
  for (const t of GENERAL_TITLES) set.add(t);
  for (const t of COMMON_TITLES) set.add(t);
  return [...set];
})();

/**
 * Bare words in the title list that are a rank, a state or a fragment rather
 * than an occupation. Each appears in ordinary résumé prose, and each as a
 * whole-board query returns a different job than the reader does. "veteran" is
 * the clearest case: it is in the vocabulary, it is not a job, and it sits in
 * the header of every résumé that mentions military service.
 *
 * The asymmetry that decides membership: stoplisting a real occupation costs
 * that reader the retrieval and leaves them browsing normally — the behaviour
 * everyone had before this existed. Admitting a noise word silently searches
 * the WRONG career and presents it as their match. An ambiguous word is
 * therefore excluded. Multi-word titles are untouched, because "account
 * manager" is precise even though "manager" is not.
 */
const GENERIC_SINGLES = new Set([
  "manager", "analyst", "director", "associate", "specialist", "consultant",
  "partner", "principal", "fellow", "veteran", "captain", "server", "doctor",
  "counsel", "trading", "treasury", "litigation", "clerical", "postdoc",
  "postdoctoral",
]);

/**
 * Rank modifiers, which narrow the SEARCH without improving the match —
 * seniority already reaches the score through the description terms computeFit
 * reads. Measured against the live board, candidate pool graded vs plain:
 *
 *   journeyman electrician    139  vs  electrician        1,181   (8.5x)
 *   staff accountant          453  vs  accountant       10,000+   (22x)
 *   charge nurse              309  vs  registered nurse 10,000+   (22x)
 *
 * A journeyman electrician shown 139 openings instead of 1,181 has been
 * filtered, not matched. The strip is deliberately conservative: it fires only
 * where the remainder is ITSELF a title this résumé claimed, so it can only
 * ever swap one real occupation for a broader real occupation.
 */
/**
 * "assistant" and "associate" join the list on the same evidence and for the
 * same reason. A STORE MANAGER's résumé searched the board for "loss
 * prevention": her own title never reached the ranking, because the containment
 * rule below reads "store manager" as the vaguer way of saying "assistant store
 * manager" — a job she held five years ago and was promoted out of. With her
 * title gone the best remaining candidate was a department name.
 *
 * WHAT THE "REMAINDER IS ALSO CLAIMED" GUARD ACTUALLY BUYS, because the comment
 * above overstated it until a test said otherwise: nothing, for a suffix. A
 * résumé containing "assistant store manager" contains "store manager" by
 * construction, exactly as one containing "journeyman electrician" contains
 * "electrician" — so a graded title ALWAYS widens to its plain form, and a
 * reader who has only ever been an assistant store manager is searched as a
 * store manager. That is the behaviour the live pool sizes above argue for and
 * the behaviour every existing grade already had; the guard only bites on a
 * prefix that is not a suffix of anything ("entry level" alone).
 */
const GRADE_PREFIXES = [
  "journeyman", "apprentice", "trainee", "senior", "junior", "staff", "lead",
  "master", "entry level", "entry-level", "sr", "jr", "assistant", "associate",
];

/**
 * THE LINES A RÉSUMÉ WRITES ITS TITLE ON — the only place a term is allowed to
 * be COINED rather than looked up, because a guess is only defensible where a
 * reader is stating their occupation rather than describing their work.
 *
 * Two lines, because a name on one and a title on the next is as common as
 * both on one, and capped in characters because a PDF that parses to a single
 * blob has no lines at all — the cap is what keeps this a headline rule rather
 * than a whole-document rule in that case.
 *
 * This window was also tried as a RANKING tier above the 400-character
 * headline window and refuted; see the sort at the end of resumeRoleTerms.
 */
const TITLE_LINE_CHARS = 200;
function titleLines(lower: string): string[] {
  const out: string[] = [];
  // The lines stay SEPARATE, and the budget is shared between them: a job title
  // does not span a line break, so the last word of the name line must never
  // become the modifier of the first word of the next one.
  let budget = TITLE_LINE_CHARS;
  for (const raw of lower.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    out.push(line.slice(0, budget));
    budget -= Math.min(line.length, budget);
    if (out.length === 2 || budget <= 0) break;
  }
  return out;
}

/**
 * HOW OFTEN THE VOCABULARY USES A WORD AS THE HEAD OF A JOB TITLE.
 *
 * Derived, not authored: this is the frozen dictionary counting itself, so it
 * carries no new judgements about which words are jobs. It answers the one
 * question the next rule needs — is this word an occupational head noun, or a
 * standalone occupation, or neither?
 *
 *   manager 175   engineer 140   analyst 54   technician 47   director 32
 *   specialist 32   officer 29   coordinator 26   consultant 19   teacher 11
 *   ...  worker 9   agent 8   associate 7   partner 5   captain 3   fellow 2
 *   veteran 0   server 0   doctor 0   trading 0   reporter 0   welder 0
 *
 * The words the stoplist above was written to refuse — veteran, server, doctor,
 * trading, treasury, litigation, clerical, postdoc — score ZERO, every one of
 * them, while every word that reads as a job function scores in the dozens.
 * That agreement is why the count is trusted as a discriminator here.
 */
const HEAD_COUNTS: Map<string, number> = (() => {
  const m = new Map<string, number>();
  for (const t of TITLE_VOCAB) {
    const i = t.lastIndexOf(" ");
    if (i < 0) continue;
    const head = t.slice(i + 1);
    m.set(head, (m.get(head) ?? 0) + 1);
  }
  return m;
})();
const TITLE_SET = new Set(TITLE_VOCAB);
/** Where the counts stop meaning "rank or state" and start meaning "job kind". */
const HEAD_NOUN_MIN = 10;
/** Words that join two title words without making one title out of them. */
const CONNECTORS = new Set([
  "and", "the", "of", "at", "for", "with", "in", "on", "to", "or", "a", "an",
  "as", "de", "del", "la", "el", "y", "und", "der", "die", "des",
]);

/**
 * THE COURT REPORTER SEARCHED THE BOARD FOR JOURNALISM.
 *
 * Measured on the offline corpus: of three résumés whose occupation the frozen
 * dictionary does not carry, one came back with a confident wrong answer. A
 * stenographer with twelve years of depositions got `reporter` — a real query,
 * for a real job, in somebody else's career, captioned as her match. The other
 * two got nothing, which is the honest outcome and costs the reader only the
 * upgrade. A wrong occupation costs them the board.
 *
 * The reader had already written the answer: her headline says "Court
 * Reporter". So this reads the two-word phrase out of the headline when the
 * vocabulary's own counts say the bare word cannot stand for it. Two cases,
 * and each needs its own evidence:
 *
 *   1. The bare word IS a vocabulary title, but the vocabulary never builds a
 *      compound on it (count 0): reporter, welder, photographer. A modifier in
 *      front of such a word names an occupation the dictionary does not model,
 *      so the compound leads and the bare word follows as the runner-up chip.
 *
 *   2. The bare word is NO query at all — stoplisted, or not a title in the
 *      first place — but the vocabulary builds dozens of titles on it (count
 *      >= 10): manager, director, engineer, technician. "Project Manager" and
 *      "Funeral Director" have nowhere else to land; before this they resolved
 *      to nothing at all.
 *
 * TWO THINGS KEEP THIS FROM INVENTING QUERIES. The modifier must not itself be
 * a title, so "Founder CEO" stays two jobs rather than becoming one; and the
 * compound must appear at least TWICE in the document. Real résumés state their
 * occupation in the headline and again in the employment history, while a
 * chance adjacency in a page header appears once — which is what stops
 * "Campbell Abbott Founder", the shape a PDF that lost its punctuation leaves
 * behind, from becoming a query about somebody called Abbott.
 *
 * A THIRD RULE WAS WRITTEN AND DELETED: the two words had to be separated by a
 * single space, so a dash or a comma could not glue a compound together.
 * Mutation-testing it found nothing, and the reason is that it was already
 * enforced twice over — a compound is only ever kept if the LITERAL phrase
 * occurs in the document, which a pair spanning " — " cannot do. A rule with no
 * effect is a rule the next reader has to disprove again.
 */
function headlineCompounds(lower: string, lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const words = line.match(/[a-z][a-z'’-]*/g) ?? [];
    for (let i = 1; i < words.length; i++) {
      const mod = words[i - 1];
      const head = words[i];
      if (mod.length < 3 || CONNECTORS.has(mod) || TITLE_SET.has(mod)) continue;
      if (GRADE_PREFIXES.includes(mod)) continue;
      const count = HEAD_COUNTS.get(head) ?? 0;
      const standalone = TITLE_SET.has(head) && !GENERIC_SINGLES.has(head);
      const worthCoining = standalone ? count === 0 : count >= HEAD_NOUN_MIN;
      if (!worthCoining) continue;
      const compound = `${mod} ${head}`;
      if (TITLE_SET.has(compound) || out.includes(compound)) continue;
      if (lower.split(compound).length - 1 < 2) continue; // stated once is an accident
      out.push(compound);
    }
  }
  return out;
}

/**
 * Role titles this résumé actually claims, best first — the search terms that
 * turn "score what's on screen" into "find what fits". Empty when the document
 * names no occupation the vocabulary knows, which the caller must treat as
 * "keep browsing normally", never as "no jobs match you".
 */
export function resumeRoleTerms(resumeText: string, limit = 4): string[] {
  const lower = resumeText.toLowerCase();
  if (lower.trim().length < 100) return [];
  // Where a headline sits, with room for a contact block above it.
  const head = lower.slice(0, Math.max(400, Math.floor(lower.length * 0.2)));
  const lead = titleLines(lower);
  const found: { term: string; first: number; inHead: boolean; coined: boolean; score: number }[] = [];
  const candidates: { term: string; coined: boolean }[] = [
    ...TITLE_VOCAB.map((term) => ({ term, coined: false })),
    ...headlineCompounds(lower, lead).map((term) => ({ term, coined: true })),
  ];
  for (const { term, coined } of candidates) {
    if (!containsTerm(lower, term)) continue;
    const single = !term.includes(" ");
    if (single && GENERIC_SINGLES.has(term)) continue;
    const inHead = containsTerm(head, term);
    if (single && !inHead) continue; // a bare word counts only as a headline
    const first = lower.indexOf(term);
    // REPETITION IS CAPPED. Uncapped, a phrase repeated in three bullets
    // (go-to-market x3 = 25) outscored the headline title mentioned once
    // (software engineer = 24), and the bullets became the search. Two
    // mentions is all the evidence repetition gets to contribute.
    const freq = Math.min(2, lower.split(term).length - 1);
    found.push({
      term,
      first,
      inHead,
      coined,
      score: freq * 2 + term.split(" ").length * 3 + (inHead ? 12 : 0) +
        (first / Math.max(1, lower.length) < 0.35 ? 4 : 0),
    });
  }
  // A graded title whose plain form is also claimed retrieves a fraction of the
  // same jobs — drop the grade and keep the occupation.
  const ungraded = found.filter((f) => {
    const p = GRADE_PREFIXES.find((g) => f.term.startsWith(g + " "));
    return !(p && found.some((o) => o.term === f.term.slice(p.length + 1)));
  });
  // "engineer" inside "software engineer" is the same claim, less precise.
  // A COINED compound does not get to delete the word it was built from: it is
  // the guess, and the vocabulary word is the fallback the reader can click if
  // the guess is wrong. That is the whole reason coining is safe to do at all.
  const kept = ungraded.filter((a) =>
    !ungraded.some((b) => b.term !== a.term && !b.coined && b.term.includes(a.term))
  );
  // The headline outranks the body outright: what a résumé LEADS with is the
  // role, however often something else is mentioned further down.
  //
  // A THIRD TIER FOR THE FIRST TWO LINES WAS TRIED HERE AND REMOVED. It is the
  // obvious next move — inside the 400-character window a bullet competes with
  // the name line on equal terms — and it changed NOTHING: over the sixteen
  // labelled résumés it produced a byte-identical term list for every one of
  // them, because the grade strip above already rescues the case it was written
  // for. Deleting a rule that survives its own mutation test is cheaper than
  // carrying one whose only argument is that it sounds right.
  kept.sort((a, b) =>
    Number(b.inHead) - Number(a.inHead) ||
    b.score - a.score || a.first - b.first
  );
  return kept.slice(0, limit).map((c) => c.term);
}
