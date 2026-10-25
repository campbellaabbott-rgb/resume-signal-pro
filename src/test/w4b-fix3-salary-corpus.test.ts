// @vitest-environment node
/**
 * THE SALARY MINER, MEASURED ON REAL POSTINGS (S12-019, wave 4 fix rounds 3 and 4).
 *
 * Round 3 measured its rule on 556 cases and found it never worse than
 * origin/main; its recheck then broke it with inputs the corpus never held: a
 * pay-transparency template ("the Target Earning potential is $200,000 to
 * $250,000 annually") read as a business figure because "Target" stood beside
 * it, contractor and locum rates multiplied by 2080 into "big" figures beside
 * "contract" or "coverage", "+ RSUs" tails, earnings statements and job titles.
 * Its re-sweep then wrote NULL over the stored pay.
 *
 * THE RULE NOW. A figure the old guards accept is set aside only when a
 * business noun OWNS it ("<noun> of / valued at / worth / in excess of $X",
 * "deal size $X", "$X in/of <noun>", "$X portfolio"), no pay word stands in
 * its sentence or right after it, and it reads as annual. A noun beside a
 * figure owns nothing. The v11 re-sweep rewrites a stored figure only to a
 * later stated pay, never to NULL.
 *
 * THE CORPUS (fixtures/w4b-fix3-salary/corpus.json): 941 cases, each labelled
 * by reading: round 3's 556 less 21 repeated texts (471 live), the round-3
 * rechecker's 352 less 4 (113 live, every regression class), 54 inputs
 * written for the recheck-3 findings and 4 fresh live rows. Measured (each version's answer is in the fixture):
 *   origin/main 844 right, fa66a031 827 (worse than main on 66), 9af3c783 855
 *   (31), 237bf2e8 801 (101, and its re-sweep NULLs 98 stored pays), this rule
 *   902 (0, and its re-sweep NULLs none and swaps none).
 * The 39 cases it still gets wrong are pinned as gaps, and on every one its
 * answer is origin/main's own. Fifty excerpts written after the rule to break
 * it (fixtures/w4b-fix3-salary/self-break-round4.json): origin/main 34 right,
 * this rule 48, its two misses origin/main's own answers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSalary, minedSalaryRefused } from "../../supabase/functions/_shared/salary-extract";

type Sweep = "keep" | { to: string | null } | null;
type Result = { got: string | null; ok: boolean; sweep: Sweep };
interface Case {
  id: string; origin: string; vendor: string | null; country: string | null; text: string; stored: string | null;
  extract: string | null; also: string[]; safeNull: boolean; resweep: Sweep; reason: string;
  results: Record<"main" | "fa66a031" | "9af3c783" | "237bf2e8", Result>; gap?: { answer: string | null; isMain: boolean };
}
const CORPUS: { cases: Case[] } = JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-salary/corpus.json"), "utf8"));

/** The money figures a string states: two strings that state the same figures are the same answer. */
function figs(s: string | null): string | null {
  if (s === null) return null;
  const out: number[] = [];
  for (const m of s.matchAll(/[$€£]\s?(\d[\d.,]*)\s?([kK])?/g)) {
    const t = m[1].replace(/[.,]+$/, "");
    let v = /^\d{1,3}([.,]\d{3})+$/.test(t) ? Number(t.replace(/[.,]/g, "")) : /^\d+[.,]\d{1,2}$/.test(t) ? Number(t.replace(",", ".")) : Number(t.replace(/,/g, ""));
    if (m[2]) v *= 1000;
    out.push(v);
  }
  return out.length ? out.join("|") : s;
}
const isPay = (c: Case, x: string | null) => x !== null && [c.extract, ...c.also].filter((p) => p !== null).map(figs).includes(figs(x));
const minerOk = (c: Case, x: string | null) => isPay(c, x) || (x === null && (c.extract === null || c.safeNull));
/** What backfill-salary does with a stored text: keep it, or write the miner's answer. */
function resweep(c: Case): Sweep {
  if (c.stored === null) return null;
  if (!minedSalaryRefused(c.text, c.stored)) return "keep";
  return { to: extractSalary(c.text) };
}

describe("the corpus", () => {
  it("holds at least 300 real postings and every recheck input", () => {
    expect(CORPUS.cases.filter((c) => /live/.test(c.origin)).length).toBeGreaterThanOrEqual(580);
    expect(CORPUS.cases.filter((c) => c.origin === "r3-builder:recheck1").length).toBe(7);
    expect(CORPUS.cases.filter((c) => c.origin.startsWith("r3-builder:recheck2")).length).toBe(18);
    expect(CORPUS.cases.filter((c) => c.origin.startsWith("r3-recheck:")).length).toBeGreaterThanOrEqual(330);
    expect(CORPUS.cases.every((c) => c.reason.length > 0)).toBe(true);
  });

  it("every gap is a case origin/main gets wrong too, answered exactly as main answers it", () => {
    const gaps = CORPUS.cases.filter((c) => c.gap);
    expect(gaps.length).toBeLessThanOrEqual(39);
    for (const c of gaps) {
      expect(c.results.main.ok, c.id).toBe(false);
      expect(c.gap?.isMain, c.id).toBe(true);
    }
  });
});

describe("the miner returns the pay the posting states", () => {
  it.each(CORPUS.cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const out = extractSalary(c.text);
    if (c.gap) {
      expect(minerOk(c, out) || out === c.results.main.got, `gap, pinned to main's answer — ${c.reason}`).toBe(true);
      return;
    }
    expect(minerOk(c, out), `${JSON.stringify(out)} — ${c.reason}`).toBe(true);
  });
});

describe("never worse than origin/main", () => {
  it("every case main answers right is answered right", () => {
    const worse = CORPUS.cases.filter((c) => c.results.main.ok && !minerOk(c, extractSalary(c.text)));
    expect(worse.map((c) => `${c.id}: ${JSON.stringify(extractSalary(c.text))}`)).toEqual([]);
  });

  it("the recheck-3 regressions fail on 237bf2e8 and pass here", () => {
    const fixed = CORPUS.cases.filter((c) => c.results.main.ok && !c.results["237bf2e8"].ok);
    expect(fixed.length).toBeGreaterThanOrEqual(100);
    for (const c of fixed) expect(minerOk(c, extractSalary(c.text)), c.id).toBe(true);
  });
});

describe("the v11 re-sweep never NULLs and never swaps a stored pay", () => {
  const withStored = CORPUS.cases.filter((c) => c.stored !== null);
  it.each(withStored.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const got = resweep(c);
    if (c.resweep === "keep") { expect(got, `a stored pay is kept — ${c.reason}`).toBe("keep"); return; }
    // A business figure: rewritten to the stated pay, or left as main leaves it. Never NULLed.
    expect(got === "keep" || (got !== null && got.to !== null && isPay(c, got.to)), `${JSON.stringify(got)} — ${c.reason}`).toBe(true);
  });

  it("writes NULL nowhere, though 237bf2e8 wrote it over stored pay", () => {
    expect(withStored.filter((c) => { const r = resweep(c); return r !== "keep" && r !== null && r.to === null; }).map((c) => c.id)).toEqual([]);
    const r3Nulled = withStored.filter((c) => c.resweep === "keep" && c.results["237bf2e8"].sweep !== "keep");
    expect(r3Nulled.length).toBeGreaterThanOrEqual(90);
  });

  it("still rewrites the business figures that have a stated pay after them", () => {
    const rewritten = withStored.filter((c) => c.resweep !== "keep" && resweep(c) !== "keep");
    expect(rewritten.length).toBeGreaterThanOrEqual(20);
  });
});

type SelfBreakCase = Case & { results: Case["results"] & { whenWritten: Result } };
const SELF_BREAK = (JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-salary/self-break-round4.json"), "utf8")) as { cases: SelfBreakCase[] }).cases;

describe("fifty excerpts written after this rule to break it", () => {
  it("it got 48 right when they were written, and is never wrong where origin/main is right", () => {
    expect(SELF_BREAK.length).toBe(50);
    expect(SELF_BREAK.filter((c) => c.results.whenWritten.ok).length).toBe(48);
    expect(SELF_BREAK.filter((c) => c.results.main.ok && !minerOk(c, extractSalary(c.text))).map((c) => c.id)).toEqual([]);
  });

  it.each(SELF_BREAK.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const out = extractSalary(c.text);
    expect(minerOk(c, out) || (!c.results.main.ok && out === c.results.main.got), `${JSON.stringify(out)} — ${c.reason}`).toBe(true);
    const got = resweep(c);
    if (c.resweep === "keep") expect(got, "a stored pay is kept").toBe("keep");
    else expect(got === "keep" || (got !== null && got.to !== null && isPay(c, got.to)), JSON.stringify(got)).toBe(true);
  });
});
