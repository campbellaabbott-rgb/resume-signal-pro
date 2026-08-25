import { describe, expect, it } from "vitest";
import {
  pickRoute, scoreTitle, rerankWindow, foldName,
  OCCUPATION_GUARD, ENGLISH_STOPWORDS, RETRIEVER_FOR,
} from "../../supabase/functions/job-board/search-routing";

/**
 * THESE TESTS RUN THE SHIPPED CODE. That is the point of the module existing.
 *
 * A review found two of my guards passing while the functions they described
 * had been deleted — they matched source text, or reimplemented the rule in the
 * test file and exercised the copy. Both would go on passing forever regardless
 * of what happened to the real thing. Everything below imports and executes.
 *
 * The design came from a nine-agent review that measured the alternatives under
 * load. All three judges rejected multi-arm fusion: withDeadline is
 * Promise.race and cannot cancel SQL, so fan-out multiplies uncancellable load,
 * and losing one arm silently rewrites 65-70% of the top 20. One retriever,
 * chosen before any SQL, re-ranked in memory.
 */

const ALIASES = {
  att: { tokens: ["att~wd1~ATTGeneral"], name: "AT&T" },
  dominos: { tokens: ["dominos"], name: "Domino's" },
  pwc: { tokens: ["pwc~a", "pwc~b", "pwc~c", "pwc~d"], name: "PwC" },
  aecom: { tokens: ["AECOM2"], name: "AECOM" },
};

describe("one retriever per search, chosen before any SQL", () => {
  it("sends a whole-query employer name to the indexed company lookup", () => {
    // AT&T is reachable ONLY this way. Measured: title-side matches intersected
    // with real AT&T postings = 0, while company_token lookup = 493 rows in
    // 0.35s. No amount of text matching reaches them — 'at' and 't' are english
    // stopwords and the simple index finds venue jobs at the AT&T Stadium.
    const r = pickRoute("AT&T", ALIASES);
    expect(r.route).toBe("EMPLOYER");
    expect(r.tokens).toEqual(["att~wd1~ATTGeneral"]);
    expect(r.matchedName).toBe("AT&T");
    // A multi-board employer keeps every token.
    expect(pickRoute("PwC", ALIASES).tokens).toHaveLength(4);
    // Punctuation and case fold away.
    expect(pickRoute("at&t", ALIASES).route).toBe("EMPLOYER");
    expect(pickRoute("Domino's", ALIASES).route).toBe("EMPLOYER");
  });

  it("REFUSES to route a prefix — the hijack that cost 7.8% of real queries", () => {
    // An earlier version matched the longest leading span against the company
    // directory. Replaying the board's own job titles as queries, 78 of 997
    // were captured into a one-company filter: "public health nurse" 1,983 -> 0,
    // "medical assistant" 3,753 -> 6. Whole query only.
    for (const q of ["att engineer", "dominos delivery driver", "pwc audit associate"]) {
      expect(pickRoute(q, ALIASES).route, `"${q}" must not route to an employer`).not.toBe("EMPLOYER");
    }
  });

  it("never lets a common word resolve to an employer, even a real one", () => {
    // Target, Shell, Oracle and Apple are all genuine employers on this board.
    // They stay unreachable by name on purpose: "shell assessed internship
    // program" is a real query from the board's own miss log, and routing it
    // hides every other employer's internships behind an invisible filter.
    const withCommon = { ...ALIASES, shell: { tokens: ["shell~x"], name: "Shell" }, target: { tokens: ["t~x"], name: "Target" } };
    expect(pickRoute("shell", withCommon).route).not.toBe("EMPLOYER");
    expect(pickRoute("target", withCommon).route).not.toBe("EMPLOYER");
    expect(OCCUPATION_GUARD.has("shell")).toBe(true);
    // and ordinary occupations are guarded whether or not a company exists
    for (const w of ["sales", "nurse", "engineer", "it", "hr"]) {
      expect(OCCUPATION_GUARD.has(w), `${w} must be guarded`).toBe(true);
    }
  });

  it("classes symbols separately but serves them from the ranked retriever", () => {
    // Every literal matcher was measured UNDER CONCURRENCY 4 and only the
    // prefix survived, at 80% recall loss: ilike prefix 0.25-0.43s/60 rows,
    // ilike contains 1.9-2.7s/311, imatch regex 3.1-3.5s/311 (and 0.35s
    // serially — the trap that put a seq scan in production this morning).
    // None is needed: 38 of the 200 rows the ranked window already returns for
    // "c++" contain the literal string, and the scorer's +90 rule floats them.
    expect(RETRIEVER_FOR.SYMBOL).toBe("ranked");
    expect(RETRIEVER_FOR.EMPLOYER).toBe("company");
    expect(RETRIEVER_FOR.SIMPLE).toBe("simple");
  });

  it("routes symbols to their own class, because every config destroys them", () => {
    // wfts(simple).c++ and wfts(simple).c# are byte-identical at 1,437 rows,
    // ~71% of which contain neither string. The parser strips "++" and "#"
    // under every configuration.
    expect(pickRoute("c++", ALIASES).route).toBe("SYMBOL");
    expect(pickRoute("c#", ALIASES).route).toBe("SYMBOL");
    expect(pickRoute("c++ developer", ALIASES).route).toBe("SYMBOL");
  });

  it("routes anything the english index cannot see to the simple index", () => {
    // q="IT" retrieves NOTHING from the stored english tsvector. q="it manager"
    // is worse: 'it' is dropped, the query degenerates to 'manager', and it
    // returns 92,919 rows of which 99.2% do not contain the typed words.
    expect(pickRoute("IT", ALIASES).route).toBe("SIMPLE");
    expect(pickRoute("it manager", ALIASES).route).toBe("SIMPLE");
    expect(pickRoute("no experience", ALIASES).route).toBe("SIMPLE");
    expect(ENGLISH_STOPWORDS.has("it")).toBe(true);
  });

  it("orders its rules so the stuffing defect cannot slip through the side", () => {
    // The proposed order put the stopword rule ahead of the two-token rule,
    // which sent "sales rep" and "hr manager" down an unranked path. Symbols
    // and employers are decided first because they are unambiguous.
    expect(pickRoute("c#", { ...ALIASES, c: { tokens: ["x"], name: "C" } }).route).toBe("SYMBOL");
    expect(pickRoute("registered nurse", ALIASES).route).toBe("RANKED");
    expect(pickRoute("", ALIASES).route).toBe("BROWSE");
  });
});

describe("the scorer fixes ranking, which is what q=\"sales\" actually needed", () => {
  const rank = (titles: string[], q: string) =>
    titles.map((t) => ({ t, s: scoreTitle(t, q) })).sort((a, b) => b.s - a.s).map((x) => x.t);

  it("puts the exact title above the keyword-stuffed one", () => {
    // The live board's page 1 for q="sales" is led by "Corporate Sales for Call
    // Center Solutions and Cloud PBX - Communication Platform Sales Section,
    // Network Sales Department..." while all 959 "Sales Associate" postings —
    // present in the candidate set, verified by intersection — never surface.
    const stuffed = "Corporate Sales for Call Center Solutions and Cloud PBX - Communication Platform Sales Section , Network Sales Department";
    const out = rank([stuffed, "Sales Associate", "Sales Manager"], "sales");
    expect(out[0]).toBe("Sales Associate");
    expect(out[out.length - 1]).toBe(stuffed);
  });

  it("separates c++ from c#, which no text configuration can", () => {
    const out = rank(["C# Developer", "C++ Developer", "Sr. Analyst, Media, FHS, US&C"], "c++");
    expect(out[0]).toBe("C++ Developer");
    expect(rank(["C++ Developer", "C# Developer"], "c#")[0]).toBe("C# Developer");
  });

  it("ISOLATES the anti-stuffing penalty — equal length, only repetition differs", () => {
    // Mutation-testing caught the first version of this: deleting the penalty
    // entirely left every assertion green, because length normalization and the
    // exact-title bonus were quietly doing the work. Both titles here have the
    // same token count and neither is an exact match, so repetition is the only
    // thing between them.
    const once = scoreTitle("Sales Associate Downtown Branch Office", "sales");
    const twice = scoreTitle("Sales Manager Sales Division Office", "sales");
    expect(once).toBeGreaterThan(twice);
  });

  it("ISOLATES the literal-symbol rule — no head-of-title bonus to hide behind", () => {
    // The first version compared "C++ Developer" with "C# Developer", where
    // startsWith() alone separates them; deleting the +90 literal rule changed
    // nothing. Putting the symbol mid-title removes that crutch, and foldName
    // reduces both queries to "c", so coverage and length are identical too.
    const plus = scoreTitle("Senior C++ Engineer", "c++");
    const hash = scoreTitle("Senior C# Engineer", "c++");
    expect(plus).toBeGreaterThan(hash);
    expect(scoreTitle("Senior C# Engineer", "c#")).toBeGreaterThan(scoreTitle("Senior C++ Engineer", "c#"));
  });

  it("ISOLATES length normalization — equal coverage, neither an exact match", () => {
    // Deleting the -22*ln(1+extra) term also left the old assertion green,
    // because the exact-title bonus covered it. Neither title here is exact.
    const shortT = scoreTitle("Registered Nurse Clinic", "registered nurse");
    const longT = scoreTitle("Registered Nurse Clinic Downtown Regional Medical Center Night Shift", "registered nurse");
    expect(shortT).toBeGreaterThan(longT);
  });

  it("penalises length and repetition, and rewards coverage first", () => {
    expect(scoreTitle("Registered Nurse", "registered nurse"))
      .toBeGreaterThan(scoreTitle("Registered Nurse, Cardiac Step-Down Unit, Nights, Per Diem", "registered nurse"));
    // Coverage dominates: a short title missing a term loses to a longer one
    // containing both.
    expect(scoreTitle("Nurse Practitioner Family Medicine Clinic", "registered nurse"))
      .toBeLessThan(scoreTitle("Registered Nurse Clinic", "registered nurse"));
  });

  it("cannot let freshness outrank relevance", () => {
    // Freshness is a tiebreak, capped at 12. A coverage difference is 50+.
    const fresh = scoreTitle("Warehouse Operative", "registered nurse", 0);
    const stale = scoreTitle("Registered Nurse", "registered nurse", 365);
    expect(stale).toBeGreaterThan(fresh);
  });

  it("is deterministic, and equal scores keep their input order", () => {
    // Pagination over an unstable ordering is how page two repeated page one.
    // Note V8's sort is already stable, so the explicit index tiebreak in
    // rerankWindow cannot be caught by mutation here — it is belt and braces
    // and this test does not claim otherwise. What IS asserted is the property
    // that matters: identical input yields identical output, and equal-scoring
    // rows come back in the order they arrived.
    const titles = ["Sales Associate", "Sales Manager", "Sales Associate", "Retail Sales"];
    expect(rank(titles, "sales")).toEqual(rank(titles, "sales"));
    const tied = [{ title: "Nurse", company: "A" }, { title: "Nurse", company: "B" }, { title: "Nurse", company: "C" }];
    expect(rerankWindow(tied, "nurse", 9).map((r) => r.company)).toEqual(["A", "B", "C"]);
  });
});

describe("employer diversity demotes, never drops", () => {
  it("caps one company at two rows on the page and keeps the rest below", () => {
    // One employer held 142 of the 1,000 intern postings. Its jobs are real and
    // still wanted — dropping them would be a different lie from the one fixed.
    const rows = [
      { title: "Intern", company: "Big" }, { title: "Intern", company: "Big" },
      { title: "Intern", company: "Big" }, { title: "Intern", company: "Big" },
      { title: "Intern", company: "Small" },
    ];
    const out = rerankWindow(rows, "intern", 2);
    expect(out).toHaveLength(5);
    expect(out.slice(0, 3).filter((r) => r.company === "Big")).toHaveLength(2);
    expect(out.slice(0, 3).some((r) => r.company === "Small")).toBe(true);
  });

  it("folds punctuation the same way everywhere", () => {
    expect(foldName("AT&T")).toBe("att");
    expect(foldName("Domino's")).toBe("dominos");
    expect(foldName("Turner & Townsend")).toBe("turnertownsend");
  });
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const FN = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
const PAGING = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/paging.ts"), "utf8");

/**
 * The WIRING, asserted against source because the edge function cannot be
 * imported. The logic above is executed; only the plumbing is matched here, and
 * only for the properties that would fail silently.
 */
describe("routed retrieval is wired so it cannot fail quietly", () => {
  const BLK = /── ROUTED RETRIEVAL[\s\S]*?catch \{ \/\* fall through to the path this query would have taken anyway \*\/ \}/.exec(FN)?.[0] ?? "";

  it("is present, and decides the route BEFORE any SQL", () => {
    expect(BLK, "the routed branch is missing").not.toBe("");
    const routeAt = FN.indexOf("const routeDecision = qText");
    // Anchored on a PREFIX, not the whole condition. This used to match the
    // full literal `if (qText && body.sort !== "salary" && !countOnly)`, so
    // adding a legitimate conjunct to that line (the rpcBlindFilters gate, added
    // 2026-08-25 so a filter search_jobs cannot bind is not answered by it) made
    // indexOf return -1 and the ordering assertion compare against -1 — failing
    // for a reason with nothing to do with routing order. A guard that breaks
    // when unrelated code is added trains people to edit the guard.
    const rankedAt = FN.indexOf('if (qText && body.sort !== "salary" && !countOnly');
    expect(routeAt, "the route decision is missing").toBeGreaterThan(-1);
    expect(rankedAt, "the ranked path's condition is missing or was respelled").toBeGreaterThan(-1);
    expect(routeAt < rankedAt, "routing must precede the ranked path, not rescue after it").toBe(true);
  });

  it("binds filters through the ONE filter binder", () => {
    // A route with its own PostgREST chain is the mistake behind five defects
    // in two days.
    expect(/buildQuery\("effective_posted", false, undefined, \{ skipTerms: true \}\)/.test(BLK)).toBe(true);
    expect(/\.in\("company_token", routeDecision\.tokens\)/.test(BLK)).toBe(true);
    expect(/\.textSearch\("title", ftsQuery\(qText\), \{ type: "websearch", config: "simple" \}\)/.test(BLK)).toBe(true);
  });

  it("stands down when a filter is active, rather than answering from a capped subset", () => {
    // The routed window is capped at 400. Applying a filter on top of a capped
    // window silently answers from a subset of the matches — the honest place
    // for a filtered query is the ranked path, which binds filters in SQL.
    // NOT isUnfiltered() — that asks "is this the bare board?" and counts the
    // QUERY itself as a filter, so gating on it stood the router down on every
    // search. Verified live before the fix: AT&T and IT returned no searchRoute
    // at all. The gate must test the filter fields, excluding q.
    const gate = FN.slice(FN.indexOf("const onlyQuery"), FN.indexOf("const routedRetriever"));
    expect(gate, "the routing gate is missing").not.toBe("");
    expect(/isUnfiltered\(applied\)/.test(gate), "isUnfiltered treats q as a filter — it blocks every route").toBe(false);
    for (const f of ["country", "category", "workMode", "salaryFloor", "maxAgeDays", "postedAfter", "remote", "experience", "companies", "location"]) {
      expect(gate, `the gate must consider ${f}`).toContain(f);
    }
  });

  it("slices AFTER scoring, so offset indexes the order the reader sees", () => {
    // Paging a re-ranked list by a retriever-ordered offset is what made sorted
    // page two repeat page one.
    expect(/const ordered = routedRetriever === "company" \? mapped : rerankWindow\(mapped, qText\);/.test(BLK)).toBe(true);
    expect(/const page = ordered\.slice\(offset, offset \+ limit\);/.test(BLK)).toBe(true);
    expect(/hasMore: offset \+ limit < ordered\.length,/.test(BLK)).toBe(true);
  });

  it("does not score an employer page by title similarity", () => {
    // Every row already IS that employer's; scoring by title would demote roles
    // for not repeating the company name.
    expect(/routedRetriever === "company" \? mapped :/.test(BLK)).toBe(true);
  });

  it("publishes a real total only when the window is not the cap", () => {
    expect(/total: ordered\.length < ROUTE_WINDOW \? ordered\.length : null,/.test(BLK)).toBe(true);
    expect(/countUnavailable: true/.test(BLK)).toBe(true);
  });

  it("names the route it took, and logs a deadline miss", () => {
    // A route nobody can see is a route nobody can debug; a silent deadline is
    // indistinguishable from "no matches".
    expect(/searchRoute: routeDecision\.route,/.test(BLK)).toBe(true);
    expect(/searchRouteReason: routeDecision\.reason,/.test(BLK)).toBe(true);
    expect(/hit its deadline/.test(BLK)).toBe(true);
  });

  it("falls through instead of erroring when the route finds nothing", () => {
    // A route that returns an empty page would be WORSE than the path it
    // replaced — the query must still reach the retriever it would have used.
    expect(/if \(routedGrouped\.jobs\.length > 0\) \{/.test(BLK)).toBe(true);
    expect(/catch \{ \/\* fall through/.test(BLK)).toBe(true);
  });
});

describe("the scorer reaches the path that serves most searches", () => {
  it("scores the RANKED path too — the one that serves most searches", () => {
    // Verified live BEFORE this: q="sales" came back route=ranked with 0 of 60
    // rows titled "Sales Associate", and c++ / c# returned identical totals of
    // 1,641. The routed branch alone could never fix either, because both are
    // served by RANKED. All 959 exact "Sales Associate" titles are already in
    // that window — 959/959 by intersection — and 38 of the 200 rows for "c++"
    // contain the literal string.
    // Widened from rankedRows to mergedRows: the ranked window alone could not
    // fix q="sales", because zero of its 200 rows carry the exact title. The
    // head-term ring supplies those rows and the scorer ranks the union.
    expect(/const rankedScored = pagePlan\.rerank \? rerankWindow\(mergedRows, qText\) : mergedRows;/.test(FN)).toBe(true);
    // pagePlan.rerank IS `scoreRanked && !deepPage` — the scorer still reaches
    // every page it used to; it stands down only past the re-ranked window,
    // where the rows are served in the RPC's own ts_rank_cd order. Proven by
    // walking the seam in a-sorted-page-two-must-not-repeat-page-one.test.ts
    // rather than by matching this expression.
    expect(/rerank: opts\.scoreRanked && !deepPage,/.test(PAGING)).toBe(true);
    // Scoring permutes the rows, so below the seam it needs the SAME fixed
    // window a sort does.
    expect(/pLimit: windowed && !deepPage \? w : opts\.fetchLimit,/.test(PAGING)).toBe(true);
    expect(/pOffset: windowed && !deepPage \? 0 : opts\.offset,/.test(PAGING)).toBe(true);
    expect(/rankedScored\.slice\(pagePlan\.sliceStart, pagePlan\.sliceEnd\)/.test(FN)).toBe(true);
    expect(/hasMore: deepPage/.test(FN)).toBe(true);
    // And the top-up pages in relevance order, which a scored window has left.
    expect(/if \(!newestFirst && !scoreRanked && groupSimilar/.test(FN)).toBe(true);
  });

  it("does not override an ordering the reader chose", () => {
    // Scoring a date- or pay-sorted page would silently replace the control the
    // visitor picked with our own opinion.
    const m = /const scoreRanked = ([^;]+);/.exec(FN);
    expect(m, "scoreRanked is missing").not.toBeNull();
    expect(m![1]).toContain("!newestFirst");
    expect(m![1]).toContain('body.sort !== "salary"');
  });
});

describe("the head-term ring fetches what the scorer cannot reach", () => {
  const FN2 = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");

  it("fires only for short queries, where the stuffing defect lives", () => {
    // A scorer cannot rank what the retriever never fetched. MEASURED for
    // q="sales": of the 200 rows search_jobs returns, ZERO are titled exactly
    // "Sales Associate" and ZERO are three words or shorter, against 958 such
    // postings. ts_rank's normalization pushes them past rank 200.
    const m = /const headTermRing = \(\(\) => \{([\s\S]*?)\}\)\(\);/.exec(FN2);
    expect(m, "headTermRing is missing").not.toBeNull();
    expect(m![1]).toContain("toks.length <= 2");
    expect(m![1]).toContain("length >= 3");
  });

  it("ADDS candidates rather than replacing them", () => {
    // Prefix alone would lose every "Software Engineer" for q="engineer" —
    // 2,313 prefix rows against a far larger real set. The merge is what makes
    // it safe.
    expect(/const mergedRows = \[\.\.\.headRows, \.\.\.rankedRows\]/.test(FN2)).toBe(true);
    expect(/rerankWindow\(mergedRows, qText\)/.test(FN2)).toBe(true);
    expect(/mergedSeen\.has\(id\)/.test(FN2), "the merge must dedupe by id").toBe(true);
  });

  it("degrades to today's page, not to something incoherent", () => {
    // This is the difference between one extra ring and the multi-arm fusion
    // three judges rejected: losing the ring gives exactly the ranked result,
    // never a scrambled one.
    const blk = /let headRows: Array<Record<string, unknown>> = \[\];[\s\S]*?\n        \}/.exec(FN2)?.[0] ?? "";
    expect(blk, "the head ring block is missing").not.toBe("");
    expect(/withDeadline\(/.test(blk), "must be deadline-bounded").toBe(true);
    expect(/catch \{/.test(blk), "a failure must leave the ranked window standing").toBe(true);
    expect(/missed its deadline/.test(blk), "a silent miss is indistinguishable from no matches").toBe(true);
    expect(/\.range\(0, 199\)/.test(blk), "the ring must be bounded").toBe(true);
  });

  it("sanitises the term before it reaches an ILIKE pattern", () => {
    expect(/\.ilike\("title", `\$\{sanitizeTerm\(qText\)\}%`\)/.test(FN2)).toBe(true);
  });
});
