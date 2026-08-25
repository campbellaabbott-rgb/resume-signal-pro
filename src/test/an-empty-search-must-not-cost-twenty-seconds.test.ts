import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * A SEARCH THAT MATCHES NOTHING TOOK TWENTY-THREE SECONDS TO SAY SO.
 *
 * The board answers a query that finds too little by walking a rescue ladder:
 * an exact-word tier (7s), a trigram fuzzy RPC, an embedding tier (5s, plus 4s
 * to re-filter when a filter is active), and a head-term prefix ring (4s). The
 * tiers run in SEQUENCE, so their deadlines sum to twenty seconds — and a
 * query that finds nothing is precisely the query that reaches all of them.
 *
 * Measured live against 2026-08-25.6, wall / tookMs / marked-phase sum:
 *
 *   q=zzzqqq            22.9s / 21888 / 2897   -> 19.0s inside unmarked tiers
 *   q=krankenschwester  24.1s / 23045 / 4426   -> 18.6s
 *   q=enfermera         22.9-24.9s / ~23000    -> 16-18s; one run never
 *                                                 returned, the gateway gave up
 *   q=camarero           6.9-10.2s / 5602-8940 -> 3.4-6.6s (a DIFFERENT defect;
 *                                                 45 results, ladder not reached)
 *   q=nurse              2.6-3.1s / 1584-1965  -> ~80% accounted, healthy
 *
 * The natural experiment that identified the mechanism: the same q=zzzqqq with
 * a filter applied — which changes which tiers are reachable — came back in
 * 3.6s wall with 843ms unmarked. Same query, same index, same data.
 *
 * This is not an edge case. Every typo and every non-English job title lands in
 * the slow class, on a board that carries Spanish and German employers.
 *
 * Two things were wrong, and both were invisible because the phase record only
 * ever wrapped RPCs:
 *   1. the per-tier deadlines summed, with no ceiling on the total;
 *   2. embedText — which loads a local gte-small session on first use in an
 *      isolate — was awaited with NO deadline at all, inside the ladder.
 */
const FN = readFileSync(
  resolve(__dirname, "../../supabase/functions/job-board/index.ts"),
  "utf8",
);
// Comments are stripped before every negative assertion: writing a guard's own
// literal into a nearby comment has passed a dead check in this repo nine times.
const CODE = FN.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

describe("an empty search must not cost twenty seconds", () => {
  it("the request carries one budget, and it is finite", () => {
    expect(CODE).toMatch(/const REQUEST_BUDGET_MS = 9_000;/);
    expect(CODE).toMatch(/const budgetLeft = \(\) => Math\.max\(300, REQUEST_BUDGET_MS - \(Date\.now\(\) - reqStart\)\);/);
  });

  it("every rescue tier draws from that budget instead of its own clock", () => {
    // The literals stay so each tier's measured need is readable at the call
    // site; what changes is that a tier cannot spend time the request has
    // already spent. A tier that keeps a bare deadline puts the ladder back to
    // twenty seconds one tier at a time.
    for (const lit of ["7_000", "5_000", "4_000"]) {
      expect(CODE, `a rescue tier still uses a bare ${lit} deadline`)
        .toMatch(new RegExp(`Math\\.min\\(${lit}, budgetLeft\\(\\)\\)`));
    }
    // Four tiers, four clamps — 4_000 is used by two of them.
    expect((CODE.match(/budgetLeft\(\)/g) ?? []).length).toBeGreaterThanOrEqual(5);
  });

  it("the budget cannot starve a tier it lets run", () => {
    // Math.max(300, ...): a tier that IS reached still gets a real attempt.
    // Collapsing it to zero would turn a slow rescue into a silently disabled
    // one, which is the failure mode this codebase keeps rediscovering.
    expect(CODE).toMatch(/Math\.max\(300, REQUEST_BUDGET_MS/);
  });

  it("the budget still leaves the first tier the 7s its own test demands", () => {
    // The exact-word tier is pinned separately against a cold-start spike that
    // made the same query return two different answers. It runs FIRST, so a
    // budget above 7s means the clamp never shortens it in the normal case.
    const budget = Number(/const REQUEST_BUDGET_MS = ([0-9_]+);/.exec(CODE)?.[1]?.replace(/_/g, "") ?? 0);
    expect(budget).toBeGreaterThan(7_000);
  });

  it("the query embedding is deadlined and reports its time", () => {
    // It was awaited bare. On a cold isolate that is a model load on the
    // request path, unbounded and unmeasured.
    expect(CODE).not.toMatch(/const qVec = await embedText\(qText\);/);
    expect(CODE).toMatch(/await withDeadline\(embedText\(qText\), Math\.min\(2_500, budgetLeft\(\)\)\)/);
    expect(CODE).toMatch(/markFrom\("embed_query", t_embed_query\);/);
  });

  it("a missing embedding degrades to no semantic rescue, never to a crash", () => {
    // withDeadline resolves { data: null } on a miss, which is not an array —
    // narrowing here is what keeps a timed-out embedding from being handed to
    // the RPC as a vector.
    expect(CODE).toMatch(/const qVec = Array\.isArray\(qVecRaw\) \? qVecRaw as number\[\] : null;/);
    // And it must leave a trace. A rescue that quietly stops rescuing looks
    // exactly like a board with nothing to offer.
    expect(CODE).toMatch(/query embedding unavailable or past deadline/);
  });
});
