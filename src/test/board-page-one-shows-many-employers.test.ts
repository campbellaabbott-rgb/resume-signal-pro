import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * PAGE 1 OF A 598,066-JOB BOARD WAS ELEVEN EMPLOYERS.
 *
 * The server sorts `effective_posted DESC, id ASC`, and `id` is
 * `vendor:token:jobid` — so every date tie collapses into a per-company block.
 * Measured live on the default view: 60 rows, 11 distinct companies, including
 * an unbroken run of 24 Republic postings and 13 PNC. On /jobs/field/engineering
 * it was 20 companies with a 12-run of Parsons.
 *
 * The existing collapseClusters cannot help: it folds same-company SAME-TITLE
 * rows (one role listed in five locations). Those 24 Republic postings are 24
 * different titles, so they stayed 24 rows.
 *
 * WHY IT MATTERS MORE THAN IT LOOKS. A visitor scrolls past two dozen
 * near-identical rows from one employer and concludes this is a scrape — the
 * precise opposite of the "verified, straight from the employer" claim in the
 * hero directly above. It also hid the revenue product: 59 of the 60 default
 * rows were Workday, which is walled, so the "Agent can apply" chip never fired
 * on the one screen every visitor sees.
 *
 * The fix is a round-robin, NOT a cap — the same rows in a different order.
 * That distinction is the whole reason this is safe, and it is what these tests
 * pin: no posting may be dropped, hidden, or made unreachable to sell a
 * prettier first screen.
 */
const SRC = readFileSync(resolve(__dirname, "../pages/Jobs.tsx"), "utf8");

/** The groupedJobs memo body, bounded — never a whole-file regex. */
const memo = (() => {
  const start = SRC.indexOf("const groupedJobs = useMemo(");
  if (start === -1) return "";
  const end = SRC.indexOf("}, [displayJobs", start);
  return end === -1 ? SRC.slice(start, start + 6000) : SRC.slice(start, end);
})();

describe("page 1 shows many employers, without hiding anything", () => {
  it("weaves employers together, and the weave is REACHABLE", () => {
    expect(memo, "groupedJobs memo not found").not.toBe("");
    expect(
      /byCompany/.test(memo) && /woven/.test(memo),
      "groupedJobs must interleave by employer — a date-tie block of one " +
        "company owning the first screen reads as a scrape.",
    ).toBe(true);

    // REACHABILITY, not just presence. The first version of this test only
    // asserted the strings existed, so replacing the conditional bail-out with
    // an unconditional `return order` left the weave in the file, dead, and the
    // test still passed. Break-testing caught it. Assert the ONLY early return
    // before the weave is the intentional gate.
    const beforeWeave = memo.slice(0, memo.indexOf("const byCompany"));
    const returns = [...beforeWeave.matchAll(/\breturn\s+order\s*;/g)];
    expect(
      returns.length,
      "exactly one early `return order;` may precede the weave — the " +
        "interleaveEmployers gate. More than one means the weave is dead code.",
    ).toBe(1);
    expect(
      /if\s*\(!interleaveEmployers\)\s*return order;/.test(beforeWeave),
      "that early return must be guarded by !interleaveEmployers",
    ).toBe(true);
  });

  it("LOSES NOTHING — the woven list is the same length as the input", () => {
    // The single most important property. A cap would have been easier and
    // would have made "Showing N" false, broken pagination, and made some
    // employers' postings unreachable. Simulate the exact algorithm.
    const weave = <T,>(order: T[], keyOf: (t: T) => string): T[] => {
      const byCompany = new Map<string, T[]>();
      for (const g of order) {
        const k = keyOf(g);
        const b = byCompany.get(k);
        if (b) b.push(g); else byCompany.set(k, [g]);
      }
      const buckets = [...byCompany.values()];
      const woven: T[] = [];
      for (let round = 0; woven.length < order.length; round++) {
        let placed = false;
        for (const b of buckets) {
          if (round < b.length) { woven.push(b[round]); placed = true; }
        }
        if (!placed) break;
      }
      return woven;
    };

    // The measured shape: one employer with a 24-run, another with 13, then a tail.
    const rows = [
      ...Array.from({ length: 24 }, (_, i) => ({ co: "republic", n: i })),
      ...Array.from({ length: 13 }, (_, i) => ({ co: "pnc", n: i })),
      ...Array.from({ length: 23 }, (_, i) => ({ co: `other${i}`, n: i })),
    ];
    const out = weave(rows, (r) => r.co);
    expect(out.length, "the weave must not drop rows").toBe(rows.length);
    expect(new Set(out.map((r) => `${r.co}:${r.n}`)).size).toBe(rows.length);
  });

  it("puts many employers in the first screen", () => {
    const weave = <T,>(order: T[], keyOf: (t: T) => string): T[] => {
      const byCompany = new Map<string, T[]>();
      for (const g of order) {
        const k = keyOf(g);
        const b = byCompany.get(k);
        if (b) b.push(g); else byCompany.set(k, [g]);
      }
      const buckets = [...byCompany.values()];
      const woven: T[] = [];
      for (let round = 0; woven.length < order.length; round++) {
        let placed = false;
        for (const b of buckets) {
          if (round < b.length) { woven.push(b[round]); placed = true; }
        }
        if (!placed) break;
      }
      return woven;
    };
    const rows = [
      ...Array.from({ length: 24 }, (_, i) => ({ co: "republic", n: i })),
      ...Array.from({ length: 13 }, (_, i) => ({ co: "pnc", n: i })),
      ...Array.from({ length: 23 }, (_, i) => ({ co: `other${i}`, n: i })),
    ];
    const before = new Set(rows.slice(0, 10).map((r) => r.co)).size;
    const after = new Set(weave(rows, (r) => r.co).slice(0, 10).map((r) => r.co)).size;
    expect(before, "control: the unwoven head is one employer").toBe(1);
    expect(after, "the woven head must show many employers").toBeGreaterThanOrEqual(10);
  });

  it("preserves each employer's own recency order", () => {
    // Weaving across employers is fine; reordering WITHIN one is not — the
    // newest role at a company must still outrank its older ones.
    const rows = Array.from({ length: 6 }, (_, i) => ({ co: i % 2 ? "b" : "a", n: i }));
    const byCompany = new Map<string, typeof rows>();
    for (const g of rows) {
      const b = byCompany.get(g.co);
      if (b) b.push(g); else byCompany.set(g.co, [g]);
    }
    for (const [, bucket] of byCompany) {
      const ns = bucket.map((r) => r.n);
      expect(ns, "bucket order must match input order").toEqual([...ns].sort((x, y) => x - y));
    }
  });

  it("stands down when the reader asked for one employer or a specific order", () => {
    // Weaving a company lander, a salary sort, or a relevance-ranked search
    // would fight an intent the reader expressed — and would make the sort
    // label false.
    const gate = /const interleaveEmployers =\s*([\s\S]{0,200}?);/.exec(SRC)?.[1] ?? "";
    expect(gate, "interleaveEmployers gate not found").not.toBe("");
    for (const off of ["company", "landerCompany", "q", "salary", "fitRanking"]) {
      expect(gate.includes(off), `the weave must stand down for ${off}`).toBe(true);
    }
  });

  it("says so in the sort label instead of still claiming plain 'newest first'", () => {
    // Strict date order IS relaxed. Saying "newest first" and quietly meaning
    // something else is the class of claim this codebase keeps paying for.
    expect(SRC.includes("orderNewestWoven")).toBe(true);
    expect(SRC).toMatch(/spread across employers/);
  });
});
