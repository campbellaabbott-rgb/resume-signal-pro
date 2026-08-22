import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * SIX list exits since routed retrieval landed (recency, ranked, fuzzy,
 * semantic, exact-word, routed). The count is asserted rather than a minimum
 * precisely so that adding an exit FAILS here and forces every disclosure
 * onto it — which is what happened, again, and is why this number keeps
 * moving.
 *
 * FIVE list exits since the simple-config tier landed (recency, ranked,
 * fuzzy, semantic, exact-word). The count is asserted rather than a minimum
 * precisely so that ADDING an exit fails here and forces the author to carry
 * every disclosure onto it — which is what happened.
 *
 * THE PLAINEST USE OF THE FEATURE WAS THE ONE THAT DID NOT WORK.
 *
 * Reading a pay figure out of the search box shipped working for "100k
 * engineer" and broken for "100k". MEASURED on production the same hour:
 *
 *   q="120000"  ->     0 results   |  salaryFloor=120000 alone -> 13,381
 *   q="80k"     ->    88 results   |  salaryFloor=80000  alone -> 25,896
 *   q="150k"    ->    95 results   |  salaryFloor=150000 alone ->  7,817
 *
 * 98.8% of the matching board suppressed, and the 88 rows that did come back
 * were titles like "Senior Product Engineer (£80k-125k + Equity)" — literal
 * text matches on the characters "80k". The board answered a text question
 * nobody asked instead of the pay question they did.
 *
 * THE CAUSE was a fallback that could not tell two empty results apart.
 * queryTerms strips the money token because it becomes a filter; for "120000"
 * that leaves nothing, and `if (kept.length === 0) return { terms: all }` put
 * the money token straight back as a required title word. That fallback is
 * CORRECT for "jobs near me", where every word is filler and the raw string is
 * still the best guess. It is wrong when a figure was lifted. Same empty list,
 * two opposite right answers — so the function now says WHICH it is.
 *
 * AND THE FALLBACK EXISTS TWICE. Both qText derivations end in
 * `|| String(body.q)`: one builds the ROWS, one builds the COUNT. Fixing only
 * the rows would leave the count answering a substring question while the page
 * answered a pay question — the shape of the incident where 60 rows rendered
 * under a total of 36. Their parity is asserted below and is not optional.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);

/** queryTerms, sliced to its real closing brace rather than by a line count. */
const QT = (() => {
  const start = FN.indexOf("function queryTerms(");
  expect(start, "queryTerms has moved or been renamed").toBeGreaterThan(-1);
  const end = FN.indexOf("\n}", start);
  return FN.slice(start, end);
})();

describe("a pay figure is a filter, not a word to search for", () => {
  it("reports WHICH kind of empty it produced", () => {
    expect(/liftedSalary: boolean/.test(QT), "queryTerms must declare liftedSalary").toBe(true);
    expect(
      /if \(money !== null\) return \{ terms: \[\]/.test(QT),
      "a money-only query must yield NO search terms — returning the token puts it back as a title word",
    ).toBe(true);
    expect(
      /return \{ terms: all, dropped: \[\], liftedSalary: false \}/.test(QT),
      "an all-filler query must still fall back to the raw terms",
    ).toBe(true);
  });

  it("guards BOTH qText derivations, so the count and the rows ask the same question", () => {
    // This is the assertion that matters. One guarded and one not is worse than
    // neither guarded: the page would filter by pay while the total counted
    // substring matches, and the header would contradict the list.
    const guards = FN.match(/liftedSalary \? "" : String\(body\.q \?\? ""\)/g) ?? [];
    expect(
      guards.length,
      `expected the liftedSalary guard on BOTH the rows and the count qText, found ${guards.length}`,
    ).toBe(2);
    // And neither may keep the old unguarded form.
    expect(
      /queryTerms\(body\.q\)\.terms\.join\(" "\)\.slice\(0, 200\) \|\| String\(body\.q/.test(FN),
      "an unguarded `|| String(body.q)` fallback survives — it re-adds the pay figure as search text",
    ).toBe(false);
  });

  it("says out loud what it did, on EVERY list path and not just the one", () => {
    // The disclosures lived at the recency return only, so browsers were told
    // and searchers were not. Four list returns, four spreads.
    const calls = FN.match(/\.\.\.searchDisclosures\(body, applied, maxAgeClamped\)/g) ?? [];
    expect(
      calls.length,
      `searchDisclosures must be spread at all SEVEN list returns; found ${calls.length}`,
    ).toBe(7);
    // No inline copy may come back alongside it — a second definition is how
    // these drift apart again.
    expect(
      (FN.match(/const d = queryTerms\(body\.q\)\.dropped/g) ?? []).length,
      "an inline droppedTerms block has reappeared outside the shared helper",
    ).toBe(0);
  });

  it("reads the pay disclosure off the DERIVED filter, never the raw body", () => {
    const H = (() => {
      const start = FN.indexOf("function searchDisclosures(");
      expect(start, "searchDisclosures is missing").toBeGreaterThan(-1);
      return FN.slice(start, FN.indexOf("\n}", start));
    })();
    expect(
      /applied\.salaryFloor === fromQuery/.test(H),
      "the disclosure must compare against applied.salaryFloor — an explicit slider beats a typed " +
        "figure, so announcing the typed one unconditionally would be a false claim",
    ).toBe(true);
    expect(
      /body\.salaryFloor/.test(H),
      "reading body.salaryFloor outside normalizeFilters is the second-derivation bug the filter " +
        "contract forbids",
    ).toBe(false);
  });

  it("behaviourally: the split the fix turns on", () => {
    // The rule, exercised directly. Reimplemented rather than imported because
    // the edge function is a Deno module, so this pins the DECISION and the
    // source assertions above pin the shipped code that implements it.
    const FILLER = new Set(["jobs", "job", "near", "me", "hiring"]);
    const money = (q: string) => /^\$?\d[\d,]*k?\+?$/.test(q) ? q : null;
    const split = (raw: string) => {
      const all = raw.toLowerCase().split(/\s+/).filter(Boolean);
      const m = all.find((t) => money(t)) ?? null;
      const kept = all.filter((t) => !FILLER.has(t) && t !== m);
      if (kept.length === 0) return m !== null ? { terms: [], lifted: true } : { terms: all, lifted: false };
      return { terms: kept, lifted: m !== null };
    };
    // A bare figure searches for nothing and filters by pay.
    expect(split("120000")).toEqual({ terms: [], lifted: true });
    expect(split("80k")).toEqual({ terms: [], lifted: true });
    // A figure with a role still searches the role.
    expect(split("100k engineer")).toEqual({ terms: ["engineer"], lifted: true });
    // All-filler still falls back, or "jobs near me" would match everything.
    expect(split("jobs near me")).toEqual({ terms: ["jobs", "near", "me"], lifted: false });
    // An ordinary query is untouched.
    expect(split("registered nurse")).toEqual({ terms: ["registered", "nurse"], lifted: false });
  });
});
