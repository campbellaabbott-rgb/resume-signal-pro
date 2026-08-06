/**
 * THE ARITHMETIC BEHIND PAGING TWO SUBSETS, TESTED EXHAUSTIVELY.
 *
 * Ordering across the chosen category and `other` in SQL was tried and reverted
 * — it costs the date index and returned HTTP 500 after 17.5s on a large
 * widened set. Fetching the two subsets separately is fast, because each is a
 * plain indexed `.eq()`, but it moves the risk from the database to this
 * calculation.
 *
 * A boundary bug here does not throw. It silently skips a posting, or shows one
 * twice, at the exact page where the first subset runs out — which nobody
 * reports, because from the outside it looks like the board simply not having
 * that job. So this is checked by SIMULATION against a model list rather than
 * by a handful of examples: for every plausible countA, every page is walked and
 * the concatenation compared to what the ordering was supposed to produce.
 */
import { describe, expect, it } from "vitest";
import { splitPage } from "../../supabase/functions/job-board/filters";

/** Walk every page and rebuild the full list from the two subsets. */
const walk = (countA: number, countB: number, limit: number): string[] => {
  const A = Array.from({ length: countA }, (_, i) => `a${i}`);
  const B = Array.from({ length: countB }, (_, i) => `b${i}`);
  const out: string[] = [];
  for (let offset = 0; offset < countA + countB; offset += limit) {
    const s = splitPage(offset, limit, countA);
    out.push(
      ...A.slice(s.aOffset, s.aOffset + s.aLimit),
      ...B.slice(s.bOffset, s.bOffset + s.bLimit),
    );
  }
  return out;
};

describe("paging reproduces the intended order exactly", () => {
  it("never skips, repeats or reorders, across every shape that matters", () => {
    const limits = [1, 2, 7, 20, 60];
    for (const limit of limits) {
      for (let countA = 0; countA <= 25; countA++) {
        for (const countB of [0, 1, 13, 40]) {
          const expected = [
            ...Array.from({ length: countA }, (_, i) => `a${i}`),
            ...Array.from({ length: countB }, (_, i) => `b${i}`),
          ];
          expect(walk(countA, countB, limit),
            `limit=${limit} countA=${countA} countB=${countB}`).toEqual(expected);
        }
      }
    }
  });

  it("puts the chosen field first — the whole point", () => {
    // The complaint that started this: page one of legal+DE was entirely
    // `other` because the bucket is 27x larger and sorted newer.
    const first = walk(5, 1000, 60).slice(0, 5);
    expect(first).toEqual(["a0", "a1", "a2", "a3", "a4"]);
  });
});

describe("the boundary page, where a naive split goes wrong", () => {
  it("fills the rest of a part-full page from the second subset", () => {
    // countA=5, limit=3: page 2 is a3,a4 then b0.
    expect(splitPage(3, 3, 5)).toEqual({ aOffset: 3, aLimit: 2, bOffset: 0, bLimit: 1 });
  });

  it("moves cleanly onto B once A is exhausted", () => {
    // The page after the spill must NOT restart B at 0 — that was the trap in
    // the count-free version of this idea, which re-served the same rows.
    expect(splitPage(6, 3, 5)).toEqual({ aOffset: 5, aLimit: 0, bOffset: 1, bLimit: 3 });
  });

  it("asks nothing of B while the page sits wholly inside A", () => {
    const s = splitPage(0, 60, 500);
    expect(s.bLimit).toBe(0);
    expect(s.aLimit).toBe(60);
  });

  it("asks nothing of A when the chosen category is empty", () => {
    const s = splitPage(0, 60, 0);
    expect(s.aLimit).toBe(0);
    expect(s.bOffset).toBe(0);
    expect(s.bLimit).toBe(60);
  });
});

describe("it cannot produce a range the database would reject", () => {
  it("never emits a negative offset or limit, for any input", () => {
    for (const offset of [-10, 0, 1, 59, 60, 10_000]) {
      for (const limit of [0, 1, 60]) {
        for (const countA of [0, 1, 59, 1000]) {
          const s = splitPage(offset, limit, countA);
          for (const [k, v] of Object.entries(s)) {
            expect(Number.isInteger(v), `${k} not an integer`).toBe(true);
            expect(v, `${k} negative for (${offset},${limit},${countA})`).toBeGreaterThanOrEqual(0);
          }
          // The two halves must always add up to the page size asked for.
          expect(s.aLimit + s.bLimit).toBe(Math.max(0, limit));
        }
      }
    }
  });

  it("tolerates a fractional or absurd count without breaking the sum", () => {
    const s = splitPage(0, 60, 12.7);
    expect(s.aLimit + s.bLimit).toBe(60);
    expect(Number.isInteger(s.aLimit)).toBe(true);
  });
});
