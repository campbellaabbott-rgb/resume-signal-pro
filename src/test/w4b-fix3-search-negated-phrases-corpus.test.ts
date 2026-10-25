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
 * negates both; a hyphen inside a word is kept and a slash between words lists
 * alternatives. That is splitExclusions. The title match is origin/main's
 * titleExcluded, byte for byte: an excluded word or phrase strikes a title
 * only where it stands exactly as typed. Round 4's plural and hyphen folds
 * were taken out on 2026-10-25 (wave 4 descope): the final recheck found a
 * plural striking a different job word ("account" struck "Accounts Payable
 * Manager"), which origin/main never does.
 *
 * THE CORPUS (fixtures/w4b-fix3-search/negated-phrases.json): 1,169 queries,
 * every one labelled from its structure before any version ran: round 3's
 * 591 (its hyphenated labels corrected to the typed word), the round-3
 * rechecker's 511, and the recheck-3 findings' inputs with titles each
 * exclusion must and must not strike. A case is right only when the split is
 * right AND the version's own titleExcluded strikes what it should. Measured:
 * origin/main 764, fa66a031 496, 9af3c783 737, 237bf2e8 1,017, round 4
 * (with its folds) 1,161, and the shipped rule after the descope 1,122. On no
 * case is it wrong where origin/main is right. The 47 it gets wrong are each
 * wrong on main too: the 8 gaps (the split) and the 39 RESIDUAL cases below,
 * where the split is right and only the exact title match misses a title
 * spelled another way. Seventy-five queries written after round 4 to break it
 * (fixtures/w4b-fix3-search/self-break-round4.json): origin/main 22 right,
 * 237bf2e8 25, round 4 all 75, the shipped rule 69 (6 RESIDUAL).
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
/** How the real code answers a case: whether the split is right, and the titles it misses and wrongly strikes. */
function judge(c: Case): { splitOk: boolean; got: Out; missed: string[]; wrong: string[] } {
  const got = splitExclusions(c.q);
  const splitOk = [c.expect, ...(c.alsoAccept ?? [])].some((a) => normPos(a.positive) === normPos(got.positive) && sameExc(a.excluded, got.excluded));
  if (!splitOk) return { splitOk, got, missed: [], wrong: [] };
  const { strike, keep } = probes(c);
  return { splitOk, got, missed: strike.filter((t) => !titleExcluded(t, got.excluded)), wrong: keep.filter((t) => titleExcluded(t, got.excluded)) };
}
/** What is wrong with the real code's answer to a case, or "" when it is right. */
function verdict(c: Case): string {
  const { splitOk, got, missed, wrong } = judge(c);
  if (!splitOk) return `split ${JSON.stringify(got)}, want ${JSON.stringify(c.expect)}`;
  return missed.length || wrong.length ? `excluded ${JSON.stringify(got.excluded)} misses ${JSON.stringify(missed)} and strikes ${JSON.stringify(wrong)}` : "";
}

/**
 * RESIDUAL: cases the shipped rule splits right whose exact title match misses a
 * title spelled another way. Every one is wrong on origin/main too. "hyphen":
 * the typed hyphenated word strikes only a title that spells it with the hyphen
 * ("part-time" strikes "Part-Time Barista", not "Part Time Barista" or
 * "Parttime Barista"); origin/main folds it to "parttime", which strikes no
 * Part-Time title at all. That is main's defect, still open, not a right answer.
 * "plural": the typed form strikes only itself ("manager" keeps "Store
 * Managers", "night shifts" keeps "Night Shift RN"), as on origin/main.
 */
const RESIDUAL: Readonly<Record<string, "hyphen" | "plural">> = {
  "neg-020": "hyphen", "neg-053": "hyphen", "neg-093": "hyphen", "neg-129": "hyphen", "neg-146": "hyphen",
  "neg-152": "hyphen", "neg-154": "hyphen", "neg-181": "hyphen", "neg-186": "hyphen", "neg-208": "hyphen",
  "neg-213": "hyphen", "neg-226": "hyphen", "neg-266": "hyphen", "neg-272": "hyphen", "neg-274": "hyphen",
  "neg-300": "hyphen", "neg-302": "hyphen", "neg-462": "hyphen", "neg-532": "hyphen", "neg-545": "hyphen",
  "neg-556": "hyphen", "rc3-H-operator-026": "hyphen", "rc3-H-operator-041": "hyphen", "r4-135": "hyphen",
  "r4-136": "hyphen", "r4-138": "hyphen", "r4-139": "hyphen", "r4-140": "hyphen", "r4-142": "hyphen",
  "r4-143": "hyphen", "r4-144": "hyphen", "r4-145": "hyphen", "r4-146": "hyphen",
  "neg-316": "plural", "neg-438": "plural", "r4-021": "plural", "r4-024": "plural", "r4-025": "plural", "r4-027": "plural",
  // The self-break queries.
  "sb-05": "hyphen", "sb-41": "hyphen", "sb2-08": "hyphen",
  "sb-12": "plural", "sb-13": "plural", "sb2-19": "plural",
};
const isResidual = (c: Case) => Object.prototype.hasOwnProperty.call(RESIDUAL, c.id);
/** A residual is wrong on main too, its split is right, it strikes nothing wanted, and every title it misses is the class's. */
function residualHolds(c: Case): string {
  const { splitOk, got, missed, wrong } = judge(c);
  if (c.correct.main) return "origin/main answers it right, so it cannot be a residual";
  if (!splitOk) return `split ${JSON.stringify(got)}: a residual is a title miss, not a wrong split`;
  if (wrong.length) return `strikes wanted titles ${JSON.stringify(wrong)}`;
  if (!missed.length) return "now answered right: take it out of RESIDUAL";
  const typed = (e: string) => new RegExp(`(^|[^a-z0-9])${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`, "i");
  const stray = missed.filter((t) => got.excluded.some((e) => typed(e).test(t)));
  if (stray.length) return `misses ${JSON.stringify(stray)}, which hold the typed word exactly`;
  if (RESIDUAL[c.id] === "hyphen" && !got.excluded.some((e) => e.includes("-"))) return "a hyphen residual with no hyphenated exclusion";
  return "";
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

  it("the hyphenated words are labelled as typed, and every 'not part-time' case is a residual, never pinned as right", () => {
    const pt = CASES.filter((x) => /\bnot part-time\b/i.test(x.q));
    expect(pt.length).toBeGreaterThanOrEqual(20);
    for (const c of pt) {
      expect(c.expect.excluded.map(normExc), c.q).toContain("part time");
      expect(c.correct.main, `${c.q}: main's "parttime" strikes no Part-Time title`).toBe(false);
      expect(RESIDUAL[c.id], `${c.q}: the exact match misses "Part Time" titles, so it is main's open defect`).toBe("hyphen");
    }
  });

  it("the shipped rule answers 1,122 of the 1,169 right; the other 47 are the 8 gaps and the 39 residuals", () => {
    expect(CASES.filter((c) => verdict(c) === "").length).toBe(1122);
    expect(CASES.filter((c) => c.gap).length).toBe(8);
    expect(CASES.filter(isResidual).length).toBe(39);
    expect(CASES.filter((c) => c.gap && isResidual(c)).map((c) => c.id)).toEqual([]);
  });
});

describe("each query splits as labelled and strikes the titles it names", () => {
  it.each(CASES.filter((c) => !c.gap && !isResidual(c)).map((c) => [c.id, c.q, c] as const))("%s %s", (_id, _q, c) => {
    expect(verdict(c), `${c.reason}${c.ambiguous ? ` (ambiguous: ${c.ambiguous})` : ""}`).toBe("");
  });
});

describe("the residuals miss only a title spelled another way, and main misses them too", () => {
  it.each(CASES.filter(isResidual).map((c) => [c.id, c.q, c] as const))("%s %s", (_id, _q, c) => {
    expect(residualHolds(c), RESIDUAL[c.id]).toBe("");
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

describe("seventy-five queries written after round 4 to break it", () => {
  it("round 4 got all 75 when written, origin/main 22, and the shipped rule 69 with 6 residuals", () => {
    expect(SELF_BREAK.filter((c) => c.batch === 1).length).toBe(50);
    expect(SELF_BREAK.filter((c) => c.batch === 2).length).toBe(25);
    expect(SELF_BREAK.filter((c) => c.correct.whenWritten).length).toBe(75);
    expect(SELF_BREAK.filter((c) => c.correct.main).length).toBe(22);
    expect(SELF_BREAK.filter((c) => verdict(c) === "").length).toBe(69);
    expect(SELF_BREAK.filter(isResidual).length).toBe(6);
  });

  it("never wrong where origin/main is right", () => {
    expect(SELF_BREAK.filter((c) => c.correct.main && verdict(c) !== "").map((c) => `${c.q}: ${verdict(c)}`)).toEqual([]);
  });

  it.each(SELF_BREAK.filter((c) => !isResidual(c)).map((c) => [c.id, c.q, c] as const))("%s %s", (_id, _q, c) => {
    expect(verdict(c), c.reason).toBe("");
  });

  it.each(SELF_BREAK.filter(isResidual).map((c) => [c.id, c.q, c] as const))("residual %s %s", (_id, _q, c) => {
    expect(residualHolds(c), RESIDUAL[c.id]).toBe("");
  });
});
