// @vitest-environment node
/**
 * NEGATED SEARCH PHRASES, MEASURED ON A CORPUS (wave 4 fix rounds 3 and 4, S12-017).
 *
 * WHAT WENT WRONG. Rounds 1 and 2 let "not" take a second word unless it
 * looked like a place, and each recheck found a place the gazetteer did not
 * know. Round 3 took one word unless the pair was a pinned compound or a known
 * place, and its recheck found what no round had measured: the title match.
 * A one-word exclusion ending in "s" was folded to its singular, so "news"
 * struck every "New ..." title and "parts" every "Part-Time" one, which
 * origin/main never did. It also found negated regions cut after their first
 * word ("not south florida" searched Florida), "not A or B" searching B, and
 * "part-time" excluded as "parttime", which strikes no title at all.
 *
 * THE RULE NOW. One negated word, as origin/main does, unless the words are a
 * pinned compound, a known place, or a pinned region or city; "not A or B"
 * negates both. A single word strikes itself and its plural, never its
 * singular; only a phrase's last word folds a plural. A hyphen inside a word
 * is an optional break, and a slash between words lists alternatives.
 *
 * THE CORPUS (fixtures/w4b-fix3-search/negated-phrases.json): 1,169 queries,
 * every one labelled from its structure before any version ran: round 3's
 * 591 (its hyphenated labels corrected to the typed word), the round-3
 * rechecker's 511, and the recheck-3 findings' inputs with titles each
 * exclusion must and must not strike. A case is right only when the split is
 * right AND the version's own titleExcluded strikes what it should. Measured:
 * origin/main 764, fa66a031 496, 9af3c783 737, 237bf2e8 1,017, this rule
 * 1,161. On no case is this rule wrong where origin/main is right; the eight
 * it still gets wrong are pinned with the reason, and main gets each wrong too.
 * Seventy-five queries written after the rule to break it
 * (fixtures/w4b-fix3-search/self-break-round4.json): origin/main 22 right,
 * 237bf2e8 25, this rule all 75 when they were written.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { splitExclusions, titleExcluded } from "../../supabase/functions/job-board/search-routing";

type Out = { positive: string; excluded: string[] };
type Case = {
  id: string; group: string; q: string; expect: Out; alsoAccept?: Out[]; strike?: string[]; keep?: string[]; reason: string;
  ambiguous?: string; source: string; main: Out; correct: Record<"main" | "fa66a031" | "9af3c783" | "237bf2e8", boolean>;
  gap?: string; gapAnswer?: Out;
};
const FILE = JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-search/negated-phrases.json"), "utf8")) as { cases: Case[] };
const CASES = FILE.cases;

// The search lowercases and strips a word's edge punctuation, so two positives that differ only there search the same.
const STRIP = /^[,.;:!?()'‘’-]+|[,.;:!?()'‘’-]+$/g;
const normPos = (s: string) => s.toLowerCase().split(/\s+/).map((t) => t.replace(STRIP, "")).filter((t) => t && t !== "-").join(" ");
const normExc = (e: string) => e.toLowerCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
const sameExc = (a: string[], b: string[]) => {
  const A = new Set(a.map(normExc)), B = new Set(b.map(normExc));
  return A.size === B.size && [...A].every((x) => B.has(x));
};
const tc = (s: string) => s.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
/** The titles a case must strike and keep: its own lists, plus "E Head" / "Head - E" per excluded phrase and the head with each wanted word. */
function probes(c: Case): { strike: string[]; keep: string[] } {
  const pos = normPos(c.expect.positive).split(" ").filter(Boolean);
  const head = pos[0] ?? "x";
  return {
    strike: [...(c.strike ?? []), ...c.expect.excluded.flatMap((e) => [`${tc(e)} ${tc(head)}`, `${tc(head)} - ${tc(e)}`])],
    keep: [...(c.keep ?? []), tc(head), ...pos.slice(1).filter((t) => /^[a-z]/.test(t) && t !== "or" && t !== "not").map((t) => `${tc(head)} ${tc(t)}`)],
  };
}
/** What is wrong with the real code's answer to a case, or "" when it is right. */
function verdict(c: Case): string {
  const got = splitExclusions(c.q);
  const ok = [c.expect, ...(c.alsoAccept ?? [])].some((a) => normPos(a.positive) === normPos(got.positive) && sameExc(a.excluded, got.excluded));
  if (!ok) return `split ${JSON.stringify(got)}, want ${JSON.stringify(c.expect)}`;
  const { strike, keep } = probes(c);
  const missed = strike.filter((t) => !titleExcluded(t, got.excluded));
  const wrong = keep.filter((t) => titleExcluded(t, got.excluded));
  return missed.length || wrong.length ? `excluded ${JSON.stringify(got.excluded)} misses ${JSON.stringify(missed)} and strikes ${JSON.stringify(wrong)}` : "";
}

describe("the corpus is what it claims", () => {
  it("holds at least 300 labelled queries, every recheck input among them", () => {
    expect(CASES.length).toBeGreaterThanOrEqual(1100);
    const qs = new Set(CASES.map((c) => c.q));
    for (const q of [
      "warehouse not forklift Dallas", "nurse not icu nyc", "barista not part-time Denver",
      "warehouse not forklift San Jose", "warehouse not forklift Jacksonville", "nurse not travel New Orleans",
      "teacher not substitute Oakland", "driver not cdl Fresno", "nurse not icu Birmingham", "accountant not senior Madison",
      "barista not part-time Tulsa", "nurse not night shift, TX", "nurse not night shift, Texas",
      "teacher not substitute teacher, IL", "driver not box truck, CA", "cook not line sf", "nurse not travel uk",
      "analyst not junior us", "nurse not travel er", "nurse not night shift", "nurse not requiring night shifts",
      // Recheck 3.
      "producer not news Atlanta", "video editor not news", "delivery driver not parts", "warehouse associate not parts Tulsa",
      "teacher not arts", "cook not lines", "home health aide not homes", "consultant not services", "engineer not windows",
      "nurse not south florida", "teacher not new england", "engineer not west coast", "nurse not east coast remote",
      "nurse not Long Island", "driver not Inland Empire", "nurse not Sioux Falls", "cook not Fort Lauderdale",
      "teacher not Baton Rouge", "teacher not Little Rock Arkansas", "driver not long beach", "nurse not New Orleans",
      "nurse not travel or agency", "caregiver not noc shift Fresno", "nurse not pm shift Tulsa", "warehouse not cold storage Dallas",
      "rep not outside sales Phoenix", "cna not assisted living Tampa", "nurse not skilled nursing", "worker not light industrial Columbus",
      "cook not fine dining Chicago", "cook not line cook Denver", "developer not tech lead", "teacher not day care",
      "consultant not overnight travel", "nurse not 12 hour shifts", "nurse not long term care", "sales not door to door",
      "nurse not on call", "nurse not the night shift", "nurse not home health care", "nurse not requiring -travel",
    ]) expect(qs.has(q), q).toBe(true);
  });

  it("every gap is a case main gets wrong too", () => {
    const gaps = CASES.filter((c) => c.gap);
    expect(gaps.length).toBeLessThanOrEqual(8);
    for (const c of gaps) expect(c.correct.main, c.q).toBe(false);
  });

  it("the hyphenated words are labelled as typed, so a fold that strikes nothing is never pinned as right", () => {
    for (const c of CASES.filter((x) => /\bnot part-time\b/i.test(x.q))) {
      expect(c.expect.excluded.map(normExc), c.q).toContain("part time");
      expect(c.correct.main, `${c.q}: main's "parttime" strikes no Part-Time title`).toBe(false);
    }
  });
});

describe("each query splits as labelled and strikes the titles it names", () => {
  it.each(CASES.filter((c) => !c.gap).map((c) => [c.id, c.q, c] as const))("%s %s", (_id, _q, c) => {
    expect(verdict(c), `${c.reason}${c.ambiguous ? ` (ambiguous: ${c.ambiguous})` : ""}`).toBe("");
  });
});

describe("the known gaps answer as pinned (or as labelled, if a later rule gets them right)", () => {
  it.each(CASES.filter((c) => c.gap).map((c) => [c.id, c.q, c] as const))("%s %s", (_id, q, c) => {
    const got = splitExclusions(q);
    expect(verdict(c) === "" || JSON.stringify(got) === JSON.stringify(c.gapAnswer), c.gap).toBe(true);
  });
});

describe("never worse than origin/main", () => {
  it("every query origin/main answers right is answered right", () => {
    expect(CASES.filter((c) => c.correct.main && verdict(c) !== "").map((c) => `${c.q}: ${verdict(c)}`)).toEqual([]);
  });

  it("the recheck-3 title cases fail on 237bf2e8 and pass here", () => {
    const titleCases = CASES.filter((c) => c.correct.main && !c.correct["237bf2e8"]);
    expect(titleCases.length).toBeGreaterThanOrEqual(19);
    for (const c of titleCases) expect(verdict(c), c.q).toBe("");
  });
});

type SelfBreakCase = Case & { batch: 1 | 2; correct: Case["correct"] & { whenWritten: boolean } };
const SELF_BREAK = (JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-search/self-break-round4.json"), "utf8")) as { cases: SelfBreakCase[] }).cases;

describe("seventy-five queries written after this rule to break it", () => {
  it("were all right when written, fifty and then twenty-five, where origin/main got 22", () => {
    expect(SELF_BREAK.filter((c) => c.batch === 1).length).toBe(50);
    expect(SELF_BREAK.filter((c) => c.batch === 2).length).toBe(25);
    expect(SELF_BREAK.filter((c) => c.correct.whenWritten).length).toBe(75);
    expect(SELF_BREAK.filter((c) => c.correct.main).length).toBe(22);
  });

  it.each(SELF_BREAK.map((c) => [c.id, c.q, c] as const))("%s %s", (_id, _q, c) => {
    expect(verdict(c), c.reason).toBe("");
  });
});
