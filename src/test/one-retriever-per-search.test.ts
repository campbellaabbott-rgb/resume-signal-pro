import { describe, expect, it } from "vitest";
import {
  pickRoute, scoreTitle, rerankWindow, foldName,
  OCCUPATION_GUARD, ENGLISH_STOPWORDS,
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

  it("routes symbols to a literal matcher, because every config destroys them", () => {
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
