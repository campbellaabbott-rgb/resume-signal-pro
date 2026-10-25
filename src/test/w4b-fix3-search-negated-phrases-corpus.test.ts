// @vitest-environment node
/**
 * NEGATED SEARCH PHRASES, MEASURED ON A CORPUS (wave 4 fix 3, S12-017).
 *
 * WHAT WENT WRONG TWICE. Round 1 let "not" take up to two words and stop at
 * a place; round 2 widened the stop to every place the gazetteer knew. Each
 * recheck broke it with inputs nobody had listed: a city the gazetteer does
 * not know became the excluded phrase's second word ("warehouse not forklift
 * San Jose" searched "warehouse Jose" and excluded "forklift san"), "nurse
 * not night shift, TX" read "shift, TX" as a City, ST, and a wanted word went
 * the same way ("nurse not travel er", the ER nurse origin/main pins).
 *
 * THE RULE NOW. One negated word, as origin/main always did, unless the two
 * words are a pinned compound ("night shift", "box truck", "call center") or
 * the words are a place of two or three words the board knows ("not new
 * york"). No other second word is ever taken, capitalised or not.
 *
 * THE CORPUS (fixtures/w4b-fix3-search/negated-phrases.json): 591 queries,
 * every one labelled from its structure, never from a version's code, with
 * every input from both rechecks and the round-1/round-2 tests. Measured:
 * origin/main 458 right, fa66a031 258, 9af3c783 439, this rule 579. On no
 * case is this rule wrong where origin/main is right. The twelve it still
 * gets wrong are listed with the reason, and main gets each of them wrong too.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { splitExclusions } from "../../supabase/functions/job-board/search-routing";

type Out = { positive: string; excluded: string[] };
type Case = {
  id: string; group: string; q: string; expect: Out; alsoAccept?: Out[]; reason: string; ambiguous?: string; source: string;
  main: Out; mainCorrect: boolean; fa66a031Correct: boolean; r9af3c783Correct: boolean; gap?: string; gapAnswer?: Out;
};
const FILE = JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-search/negated-phrases.json"), "utf8")) as { cases: Case[] };
const CASES = FILE.cases;
const accepted = (c: Case): Out[] => [c.expect, ...(c.alsoAccept ?? [])];

describe("the corpus is what it claims", () => {
  it("holds at least 300 labelled queries, every recheck input among them", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(300);
    const qs = new Set(CASES.map((c) => c.q));
    for (const q of [
      "warehouse not forklift Dallas", "nurse not icu nyc", "barista not part-time Denver",
      "warehouse not forklift San Jose", "warehouse not forklift Jacksonville", "nurse not travel New Orleans",
      "teacher not substitute Oakland", "driver not cdl Fresno", "nurse not icu Birmingham", "accountant not senior Madison",
      "barista not part-time Tulsa", "nurse not night shift, TX", "nurse not night shift, Texas",
      "teacher not substitute teacher, IL", "driver not box truck, CA", "cook not line sf", "nurse not travel uk",
      "analyst not junior us", "nurse not travel er", "nurse not night shift", "nurse not requiring night shifts",
    ]) expect(qs.has(q), q).toBe(true);
  });

  it("every gap is a case main gets wrong too", () => {
    const gaps = CASES.filter((c) => c.gap);
    expect(gaps.length).toBeLessThanOrEqual(12);
    for (const c of gaps) expect(c.mainCorrect, c.q).toBe(false);
  });
});

describe("each query splits as labelled", () => {
  it.each(CASES.filter((c) => !c.gap).map((c) => [c.id, c.q, c] as const))("%s %s", (_id, q, c) => {
    expect(accepted(c), `${c.reason}${c.ambiguous ? ` (ambiguous: ${c.ambiguous})` : ""}`).toContainEqual(splitExclusions(q));
  });
});

describe("the known gaps answer as pinned (or as labelled, if a later rule gets them right)", () => {
  it.each(CASES.filter((c) => c.gap).map((c) => [c.id, c.q, c] as const))("%s %s", (_id, q, c) => {
    expect([...accepted(c), c.gapAnswer as Out], c.gap).toContainEqual(splitExclusions(q));
  });
});

describe("never worse than origin/main", () => {
  it("every query origin/main answers right is answered right", () => {
    const worse = CASES.filter((c) => c.mainCorrect && !accepted(c).some((a) => JSON.stringify(a) === JSON.stringify(splitExclusions(c.q))));
    expect(worse.map((c) => c.q)).toEqual([]);
  });
});
