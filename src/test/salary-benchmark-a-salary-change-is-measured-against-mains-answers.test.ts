// @vitest-environment node
/**
 * SALARY BENCHMARK: A SALARY CHANGE IS MEASURED AGAINST MAIN'S ANSWERS.
 *
 * This is a benchmark, not a fix. Wave 4 tried four rounds of changes to the
 * description salary miner (S12-019, business figures such as "a book of
 * business of $500,000 - $1,000,000" read as pay) and every round's recheck
 * found a case where it was worse than origin/main. On 2026-10-25 the miner
 * went back to main's code byte for byte (_shared/salary-extract.ts), with
 * SALARY_PARSE_VERSION at main's 10, so no re-sweep runs. S12-019 moved to its
 * own salary project.
 *
 * WHAT IS PINNED. fixtures/w4b-fix3-salary/corpus.json holds 941 labelled
 * cases: 535 from the round-3 builder (most of them live postings), 348 from
 * the round-3 rechecker, 54 written for the round-3 findings and 4 fresh live
 * rows. Each has the right answer by reading (extract, also, safeNull) and
 * origin/main's own answer (results.main.got). This file runs the SHIPPED
 * extractor and expects main's answer on every case. By reading, main is right
 * on 844 of the 941.
 *
 * WHEN THIS FAILS. A change to the salary miner moved answers. Do not re-pin
 * them here first. Measure the change the salary project's way: re-parse every
 * stored salary string the board serves with main and with the candidate, plus
 * a sampled re-read of descriptions; hand-review every changed row; and allow
 * no value-to-NULL. On this corpus the candidate must be right wherever main is
 * right (the never-worse test below). Only then update the pinned answers, with
 * the measurement in the commit.
 *
 * The other versions' results and the resweep labels in the fixture are the
 * wave 4 rounds' history, kept for that project. They are not read here.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSalary } from "../../supabase/functions/_shared/salary-extract";

type Result = { got: string | null; ok: boolean };
interface Case {
  id: string; origin: string; text: string; extract: string | null; also: string[]; safeNull: boolean; reason: string;
  results: { main: Result };
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
/** Right by reading: the stated pay, or null where the posting states none or the old guards refuse it. */
const rightByReading = (c: Case, x: string | null) => isPay(c, x) || (x === null && (c.extract === null || c.safeNull));

/** The cases on which `miner` does not give main's pinned answer. */
const movedFromMain = (miner: (t: string) => string | null) =>
  CORPUS.cases.filter((c) => miner(c.text) !== c.results.main.got);

describe("the salary benchmark corpus", () => {
  it("holds 941 labelled cases, at least 580 of them live postings, each with a reason", () => {
    expect(CORPUS.cases.length).toBe(941);
    expect(CORPUS.cases.filter((c) => /live/.test(c.origin)).length).toBeGreaterThanOrEqual(580);
    expect(CORPUS.cases.every((c) => c.reason.length > 0)).toBe(true);
    expect(new Set(CORPUS.cases.map((c) => c.id)).size).toBe(941);
  });

  it("main's pinned answers are right by reading on 844 of the 941", () => {
    expect(CORPUS.cases.filter((c) => rightByReading(c, c.results.main.got)).length).toBe(844);
    expect(CORPUS.cases.every((c) => c.results.main.ok === rightByReading(c, c.results.main.got))).toBe(true);
  });
});

describe("the shipped miner gives main's answer on every case", () => {
  it("no case moved", () => {
    const moved = movedFromMain(extractSalary).map((c) => `${c.id}: now ${JSON.stringify(extractSalary(c.text))}, main ${JSON.stringify(c.results.main.got)}`);
    expect(
      moved,
      `${moved.length} answers moved. Measure the salary change with a whole-population diff (every stored salary string, main against the candidate, plus a sampled description re-read, every changed row hand-reviewed, zero value-to-NULL) before re-pinning these.`,
    ).toEqual([]);
  });

  it("never worse than main: every case main gets right is still right", () => {
    const worse = CORPUS.cases.filter((c) => c.results.main.ok && !rightByReading(c, extractSalary(c.text)));
    expect(worse.map((c) => `${c.id}: ${JSON.stringify(extractSalary(c.text))} (${c.reason})`)).toEqual([]);
  });
});

describe("TEETH: the benchmark sees a changed miner", () => {
  it("a miner that never answers moves every case where main found a figure, and is worse where main was right", () => {
    const silent = () => null;
    const withFigure = CORPUS.cases.filter((c) => c.results.main.got !== null).length;
    expect(withFigure).toBeGreaterThan(300);
    expect(movedFromMain(silent).length).toBe(withFigure);
    expect(CORPUS.cases.filter((c) => c.results.main.ok && !rightByReading(c, silent())).length).toBeGreaterThan(0);
  });

  it("a miner that takes the first money figure it sees moves cases too", () => {
    const first = (t: string) => t.match(/[$€£]\s?\d[\d.,]*(?:\s?[kK])?/)?.[0] ?? null;
    expect(movedFromMain(first).length).toBeGreaterThan(0);
  });
});
