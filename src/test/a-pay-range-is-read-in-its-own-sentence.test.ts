// @vitest-environment node
/**
 * A PAY RANGE IS READ IN ITS OWN SENTENCE (job-board .103, pay-text miner).
 *
 * Read 2026-11-17 on five Greenhouse boards whose postings carry the board's
 * own structured pay: the description miner found the pay on 23 of Coinbase's
 * 248 and 13 of Airbnb's 163. Each posting states its range plainly; the words
 * near it are what refused it:
 *
 *   "...eligible for bonus, equity, benefits, and Employee Travel Credits.
 *    Pay Range $168,000 — $203,000 USD"           (the sentence BEFORE says bonus)
 *   "Annual base salary range (excluding equity and bonus): $166,345 — $195,700"
 *                                                    (the label itself says bonus)
 *   "Zone 1 Pay Range $311 — $325,000 USD Zone 2 Pay Range $330,000 — ..."
 *                         (the first range is a typo; the miner stopped there)
 *
 * So NOT_PAY reads the text before a figure only from the start of its own
 * sentence; a range a pay label names (pay range, salary range, base salary,
 * base pay) is pay whatever follows the label, unless the label is a bonus's
 * or a word that is not pay stands between it and the figure; and a range
 * refused for the words around it no longer ends the search (one refused for
 * its figures still does: the next is then another place's band). The 20 characters after a figure are still
 * read whole: cut at the full stop, "Average deal size $30,000 - $60,000.
 * Sign-on bonus: ..." read the deal size as pay.
 *
 * The corpus is real: 562 distinct excerpts of 1,123 postings, judged by each
 * board's own pay_input_ranges (or, for the 24 postings with figures and no
 * structured pay, by reading). main = extractSalary at 0b9d5dfab.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSalary } from "../../supabase/functions/_shared/salary-extract";

interface Case { id: string; board: string; title: string; pay: Array<[number, number]>; basis: string; text: string; main: string | null; postings: number }
const FX: { baseCommit: string; cases: Case[] } = JSON.parse(readFileSync(resolve(__dirname, "fixtures/pay-text-miner-corpus-2026-11-17.json"), "utf8"));

/** The figures a mined string states, as numbers. */
function figures(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/[$€£]\s?(\d[\d.,]*)\s?([kK])?/g)) {
    const t = m[1].replace(/[.,]+$/, "");
    let v = /^\d{1,3}([.,]\d{3})+$/.test(t) ? Number(t.replace(/[.,]/g, "")) : /^\d+[.,]\d{1,2}$/.test(t) ? Number(t.replace(",", ".")) : Number(t.replace(/,/g, ""));
    if (m[2]) v *= 1000;
    out.push(v);
  }
  return out;
}
/** Right: one of the posting's stated ranges, or null where no figure is this job's pay. */
function right(c: Case, got: string | null): boolean {
  if (got === null) return c.pay.length === 0;
  const f = figures(got);
  if (!f.length) return false;
  const lo = Math.min(...f), hi = Math.max(...f);
  return c.pay.some(([a, b]) => Math.abs(a - lo) < 1 && Math.abs(b - hi) < 1) ||
    (f.length === 1 && c.pay.some(([a, b]) => Math.abs(a - lo) < 1 || Math.abs(b - lo) < 1));
}
const weigh = (cs: Case[]) => cs.reduce((n, c) => n + c.postings, 0);

describe("the pay-text corpus", () => {
  it("holds at least 300 real cases from the five boards, each with how its answer is known", () => {
    expect(FX.cases.length).toBeGreaterThanOrEqual(300);
    expect(new Set(FX.cases.map((c) => c.board))).toEqual(new Set(["coinbase", "airbnb", "databricks", "robinhood", "figma"]));
    expect(FX.cases.every((c) => c.basis.length > 0 && /[$€£]/.test(c.text))).toBe(true);
    expect(new Set(FX.cases.map((c) => c.id)).size).toBe(FX.cases.length);
    expect(weigh(FX.cases)).toBe(1123);
    expect(FX.cases.filter((c) => c.pay.length === 0).length, "postings whose figures are not pay").toBeGreaterThan(5);
  });

  it("main's pinned answers: right on 754 of the 1,104 postings that state pay and all 19 that do not, never a wrong figure", () => {
    expect(weigh(FX.cases.filter((c) => c.pay.length > 0))).toBe(1104);
    expect(weigh(FX.cases.filter((c) => right(c, c.main)))).toBe(754 + 19);
    expect(FX.cases.filter((c) => c.main !== null && !right(c, c.main)).map((c) => c.id)).toEqual([]);
  });
});

describe("the shipped miner against main", () => {
  const now = new Map(FX.cases.map((c) => [c.id, extractSalary(c.text)]));

  it("never worse: every case main gets right is still right", () => {
    expect(FX.cases.filter((c) => right(c, c.main) && !right(c, now.get(c.id)!)).map((c) => `${c.id}: ${now.get(c.id)}`)).toEqual([]);
  });

  it("where main answered, the answer is the same text: no figure changes and none is withdrawn", () => {
    expect(FX.cases.filter((c) => c.main !== null && now.get(c.id) !== c.main).map((c) => `${c.id}: ${c.main} -> ${now.get(c.id)}`)).toEqual([]);
  });

  it("reads the stated pay on more postings, and never a wrong figure", () => {
    const mainRight = weigh(FX.cases.filter((c) => c.pay.length && right(c, c.main)));
    const nowRight = weigh(FX.cases.filter((c) => c.pay.length && right(c, now.get(c.id)!)));
    expect(mainRight).toBe(749 + 5);
    // Coinbase 23 -> 225 of 230, Airbnb 13 -> 152 of 155; Databricks, Robinhood and Figma were already read.
    // 1,095, not 1,096: a range refused for its figures ends the search (review 103), so Databricks' typo'd
    // Zone 1 posting no longer takes Zone 2's band, which may be another place's pay (Gusto's Denver posting).
    expect(nowRight, `${mainRight} -> ${nowRight}`).toBe(1095);
    expect(FX.cases.filter((c) => now.get(c.id) !== null && !right(c, now.get(c.id)!)).map((c) => `${c.id}: ${now.get(c.id)}`)).toEqual([]);
  });
});

describe("the clause, the label and the next range", () => {
  it("a sentence before the range that names a bonus no longer refuses it", () => {
    expect(extractSalary("This role may also be eligible for bonus, equity, benefits, and Employee Travel Credits. Pay Range $168,000 — $203,000 USD Reasonable Accommodations"))
      .toBe("$168,000 — $203,000");
  });

  it("a pay label is pay whatever its own parenthesis or the next words say", () => {
    expect(extractSalary("Annual base salary range (excluding equity and bonus): $166,345 — $195,700 USD Application Limit"))
      .toBe("$166,345 — $195,700");
    expect(extractSalary("Salary Range: $95,000 - $120,000 plus deal bonuses")).toBe("$95,000 - $120,000");
  });

  it("a range refused for the words around it no longer ends the search; one refused for its figures still does", () => {
    expect(extractSalary("Annual bonus potential of $20,000 - $30,000. Salary: $120,000 - $140,000.")).toBe("$120,000 - $140,000");
    // The next range after a typo'd one is another zone's band: nothing, rather than another place's pay (review 103).
    expect(extractSalary("Zone 1 Pay Range $311 — $325,000 USD Zone 2 Pay Range $330,000 — $350,000 USD")).toBeNull();
  });

  it("still refuses what is not pay", () => {
    for (const t of [
      "Average deal size $30,000 - $60,000. Sign-on bonus: $10,000 - $15,000.",
      "Book of business of $500,000 - $1,000,000. Housing allowance: $20,000 - $30,000 per year.",
      "Bonus pay range $10,000 - $20,000 for the year.",
      "The pay range for the sign-on bonus is $10,000 - $20,000.",
      "Sign-on bonus $20,000 - $30,000 for experienced hires.",
      "We raised $50,000,000 - $80,000,000 in funding.",
    ]) expect(extractSalary(t), t).toBeNull();
  });

  it("every range refused still means no single figure is taken", () => {
    expect(extractSalary("Sign-on bonus $20,000 - $30,000. Earn $40 per hour.")).toBeNull();
  });
});
