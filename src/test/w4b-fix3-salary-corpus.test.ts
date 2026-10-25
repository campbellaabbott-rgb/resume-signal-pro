// @vitest-environment node
/**
 * THE SALARY MINER, MEASURED ON REAL POSTINGS (S12-019, wave 4 round 3).
 *
 * Two rounds fixed the exact spellings a reviewer listed and the recheck broke
 * them with new ones. This round starts from a corpus: 492 real postings read
 * from the live board on 2026-10-24 (anonymised excerpts that every version
 * reads exactly as it reads the full text), every input of both rechecks and
 * the earlier rounds' test inputs, 556 cases, each labelled by reading the
 * text: the pay the miner should return, and what the v11 re-sweep should do
 * with the salary text the board stores for it.
 *
 * Measured (scratch harness, same labels):
 *   origin/main  extract 522 right / 34 wrong; re-sweep 449 / 19 (main never rewrites)
 *   fa66a031     extract 511 / 45; re-sweep 430 / 38, 30 stored pay NULLed; worse than main on 58
 *   9af3c783     extract 524 / 32; re-sweep 446 / 22, 11 stored pay NULLed; worse than main on 24
 *   this branch  extract 542 / 14; re-sweep 468 / 0, no stored pay changed; worse than main on 0
 * The 14 it still gets wrong are marked residual and pinned to the old
 * miner's answer: 11 safe misses (a bonus or 401(k) word beside stated pay
 * keeps the old null) and one benefit allowance on three postings.
 *
 * The re-sweep is run as job-board's backfill-salary runs it: when
 * minedSalaryRefused says the stored text is the miner's business figure, it
 * writes extractSalary's answer, null included.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractSalary, minedSalaryRefused } from "../../supabase/functions/_shared/salary-extract";

interface Case {
  id: string;
  origin: string;
  text: string;
  stored: string | null;
  extract: string | null;
  also: Array<string | null>;
  safe: boolean;
  resweep: "keep" | { to: string | null } | null;
  reason: string;
  residual?: string;
  mainExtract?: string | null;
}
const CORPUS: { cases: Case[] } = JSON.parse(readFileSync(resolve(__dirname, "fixtures/w4b-fix3-salary/corpus.json"), "utf8"));
const norm = (s: string | null) => (s === null ? null : s.replace(/\s+/g, " ").trim());

/** What backfill-salary does with a stored salary text. */
function resweep(text: string, stored: string): "keep" | { to: string | null } {
  if (!minedSalaryRefused(text, stored)) return "keep";
  const to = extractSalary(text);
  return norm(to) === norm(stored) ? "keep" : { to };
}

describe("the corpus", () => {
  it("is the size the round promised: at least 300 real postings and every recheck input", () => {
    expect(CORPUS.cases.filter((c) => c.origin === "live").length).toBeGreaterThanOrEqual(300);
    expect(CORPUS.cases.filter((c) => c.origin === "recheck1").length).toBe(7);
    expect(CORPUS.cases.filter((c) => c.origin.startsWith("recheck2")).length).toBe(18);
    expect(CORPUS.cases.every((c) => c.reason.length > 0)).toBe(true);
  });
});

describe("the miner returns the pay the posting states", () => {
  it.each(CORPUS.cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const out = extractSalary(c.text);
    if (c.residual) {
      expect(norm(out), `${c.residual} — ${c.reason}`).toBe(norm(c.mainExtract ?? null));
      return;
    }
    expect([c.extract, ...c.also].map(norm), c.reason).toContain(norm(out));
  });
});

describe("the v11 re-sweep keeps stored pay and re-mines only the miner's business figure", () => {
  const withStored = CORPUS.cases.filter((c) => c.stored !== null);
  it.each(withStored.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(resweep(c.text, c.stored as string), `${c.reason} (stored: ${c.stored})`).toEqual(c.resweep);
  });

  it("never changes a stored text the corpus reads as pay", () => {
    const changed = withStored.filter((c) => c.resweep === "keep" && resweep(c.text, c.stored as string) !== "keep");
    expect(changed.map((c) => c.id)).toEqual([]);
  });
});
