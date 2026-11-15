import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { capLapCovers, ORACLE_RESULT_CAP } from "../../supabase/functions/job-board/read-window";
import { codeOf } from "./helpers/strip-comments";

/**
 * A CAPPED WORKDAY WALK MAY NOT PROVE WHAT THE CAP HIDES.
 *
 * S14X-005 / OI-38: 46 lap-read boards close nothing, so a job the employer
 * took down stays served until the 30-day cutoff. The register's fix was to
 * give Workday the cap-floor proof Oracle got in n1430 — "where the feed is
 * date-ordered, prove a capped wrap when the last readable row predates the
 * fence".
 *
 * THIS FILE EXISTS TO STOP THAT BEING BUILT, and to hold the measurement that
 * replaced it. Nothing here asserts the W5 behaviour, because W5 is not written
 * yet; it pins the VENDOR FACTS the design rests on, so the premise cannot
 * drift between the measurement and the build, and guards the one arm that must
 * not be added. The behavioural fixtures W5 must satisfy are carried as DATA in
 * the same file (behaviouralFixtures) and become tests when the code lands.
 *
 * MEASURED 2026-11-15 against the tenants' own CXS lists, every Workday board
 * the live board serves with 2,000 or more open postings (23 of them, 0 read
 * errors). Scripts and raw output:
 * ~/.config/resumebooster/w5-cap-walks-2026-11-15/.
 *
 * WHY THE CAP-FLOOR PROOF IS REFUSED HERE. Two independent reasons, both
 * measured:
 *   1. It would reach fewer than half the boards. The floor at the last
 *      readable offset is past the fence on 10 of 23 and inside it on 13 (JLL
 *      19 days, Fresenius 23, RTX 20, PACS exactly 30, Accenture 4, CVS 4).
 *   2. Its premise cannot be settled. The list is only APPROXIMATELY
 *      newest-first — 5 of the 10 qualifying boards carry inversions, including
 *      a 30+ day row sitting on page 0 at Sanford Health and Genuine Parts —
 *      and the rows that would validate "nothing past the cap is fresh" are
 *      exactly the rows the cap hides. A proof resting on it publishes a
 *      closure for a live posting the first time one fresh row sits past offset
 *      2,000, on boards the size of Accenture and CVS.
 *
 * WHAT REPLACED IT: facet partitioning. Faceted counts are not capped and a
 * faceted slice walks to its own end and wraps exactly as a board end does, so
 * the existing resumeAt / emptyFirstPage / lap machinery applies per slice with
 * no per-row checks — and it recovers the 82,353 postings the cap also hides.
 */
const FIX = resolve(__dirname, "fixtures/workday-cap-partition-2026-11-15.json");
const READ_WINDOW = resolve(__dirname, "../../supabase/functions/job-board/read-window.ts");
const INDEX = resolve(__dirname, "../../supabase/functions/job-board/index.ts");

interface Board {
  token: string; name: string; stored: number; statedTotal: number | null;
  trueSize: number | null; hidden: number | null;
  capFloorLabel: string | null; capFloorPastFence: boolean | null;
}
interface Fixture {
  cap: { resultCap: number; wrapsToPageZero: boolean };
  orderingPremise: { verdict: string; inPageOrCrossPageInversions: number; ofBoardsWalked: number };
  facetPartition: { verdict: string; evidence: Record<string, unknown> & {
    unfacetedStatedTotal: number; timeTypeFacetSum: number;
    slice: { statedTotal: number; offset1900ReturnsRows: boolean; offset1940WrapsToPageZero: boolean };
  } };
  boards: Board[];
  totals: { boards: number; capFloorPastFence: number; capFloorInsideFence: number; hiddenPostings: number };
  behaviouralFixtures: ReadonlyArray<{ id: string; given: string; expect: string; why: string }>;
}
const F: Fixture = JSON.parse(readFileSync(FIX, "utf8"));

describe("the measurement the W5 design rests on", () => {
  it("is a census of every over-cap Workday board, not a sample", () => {
    expect(F.boards).toHaveLength(23);
    expect(F.totals.boards).toBe(F.boards.length);
    for (const b of F.boards) expect(b.stored, `${b.name} is not an over-cap board`).toBeGreaterThanOrEqual(2000);
  });

  it("pins the cap at 2,000 and the wrap to page 0", () => {
    // The Workday result cap is its own number and is NOT Oracle's. A single
    // shared constant would quietly give one vendor the other's proof.
    expect(F.cap.resultCap).toBe(2000);
    expect(F.cap.wrapsToPageZero).toBe(true);
    expect(ORACLE_RESULT_CAP).toBe(10_000);
    expect(F.cap.resultCap).not.toBe(ORACLE_RESULT_CAP);
  });

  it("records that the cap-floor proof would reach 10 of 23 and no more", () => {
    const past = F.boards.filter((b) => b.capFloorPastFence === true);
    const inside = F.boards.filter((b) => b.capFloorPastFence === false);
    expect(past).toHaveLength(10);
    expect(inside).toHaveLength(13);
    expect(F.totals.capFloorPastFence).toBe(past.length);
    expect(F.totals.capFloorInsideFence).toBe(inside.length);
    // A floor inside the fence is a board with rows between the floor and the
    // cutoff that no capped walk can ever read.
    for (const b of inside) {
      expect(b.capFloorLabel, `${b.name} has no measured floor`).toBeTruthy();
      expect(b.capFloorLabel, `${b.name} would have qualified after all`).not.toMatch(/30\+/);
    }
  });

  it("records the ordering premise as unsettled, which is why the proof is refused", () => {
    expect(F.orderingPremise.verdict).toMatch(/UNVALIDATED/);
    expect(
      F.orderingPremise.inPageOrCrossPageInversions,
      "the inversions are gone — re-walk the boards before trusting a date order",
    ).toBeGreaterThanOrEqual(5);
    expect(F.orderingPremise.ofBoardsWalked).toBe(10);
  });

  it("records that faceted counts are not capped, which is what makes partitioning work", () => {
    const e = F.facetPartition.evidence;
    expect(F.facetPartition.verdict).toBe("WORKS");
    // The board states 2,000 and has 40,427. The gap IS the defect.
    expect(e.unfacetedStatedTotal).toBe(F.cap.resultCap);
    expect(e.timeTypeFacetSum).toBeGreaterThan(F.cap.resultCap * 10);
    // A slice under the cap is walkable to its end and then wraps, which is the
    // one shape the existing lap machinery already proves.
    expect(e.slice.statedTotal).toBeLessThan(F.cap.resultCap);
    expect(e.slice.offset1900ReturnsRows).toBe(true);
    expect(e.slice.offset1940WrapsToPageZero).toBe(true);
  });

  it("carries the hidden inventory, the half the register did not log", () => {
    const summed = F.boards.reduce((a, b) => a + (b.hidden ?? 0), 0);
    expect(summed).toBe(F.totals.hiddenPostings);
    expect(summed).toBeGreaterThan(80_000);
    // The worst board serves under 40% of what it states it has.
    const worst = [...F.boards].sort((a, b) => (b.hidden ?? 0) - (a.hidden ?? 0))[0];
    expect(worst.trueSize! - worst.stored).toBe(worst.hidden);
  });

  it("states the two fixtures the shrinking rule has to separate", () => {
    const ids = F.behaviouralFixtures.map((f) => f.id);
    expect(ids).toContain("W5-FX-shrinking-tenant");
    expect(ids).toContain("W5-FX-broken-read");
    expect(ids).toContain("W5-FX-capped-wrap");
    const shrink = F.behaviouralFixtures.find((f) => f.id === "W5-FX-shrinking-tenant")!;
    const broken = F.behaviouralFixtures.find((f) => f.id === "W5-FX-broken-read")!;
    // The pair is the whole point: both satisfy lapSeen >= totalRef - tailSlack,
    // and only one of them may prove. min(t0, current) alone cannot tell them
    // apart, so it is not the rule.
    expect(shrink.expect).toMatch(/PROVES/);
    expect(broken.expect).toMatch(/NEVER proves/);
  });
});

describe("the refused arm is not in the code", () => {
  const rw = codeOf(readFileSync(READ_WINDOW, "utf8"));
  const idx = codeOf(readFileSync(INDEX, "utf8"));

  it("keeps the cap-floor proof Oracle-only", () => {
    // Comment-stripped, because this repo has failed guards whose required
    // literal was satisfied by a sentence in a comment. capLapCovers is read at
    // exactly one site, and that site is reached only when the vendor handed us
    // a capFloor — which only the Oracle arm sets.
    const declsOnly = rw.replace(/export function capLapCovers\(/g, "DECL_MASKED(");
    expect(
      [...declsOnly.matchAll(/capLapCovers\(/g)].length,
      "read-window now calls its own cap-floor proof",
    ).toBe(0);
    expect(
      [...idx.matchAll(/capLapCovers\(/g)].length,
      "the cap-floor proof is read at more than one site",
    ).toBe(1);
    expect(idx, "capFloor is being set from a Workday read — that is the refused arm")
      .not.toMatch(/workday[\s\S]{0,400}?capFloor\s*[:=]/i);
  });

  it("has no Workday result cap wired into a lap proof yet", () => {
    // W5 will add one. Until it does, a constant named for the Workday cap
    // sitting beside the lap proof would mean the refused arm shipped quietly.
    const capConst = /WORKDAY_RESULT_CAP/.test(rw) || /WORKDAY_RESULT_CAP/.test(idx);
    if (capConst) {
      expect(
        /partition|slice|facet/i.test(rw) || /appliedFacets\s*:\s*\{\s*[a-zA-Z]/.test(idx),
        "a Workday cap constant exists but nothing partitions the walk — the cap-floor proof was built instead of the partition",
      ).toBe(true);
    }
    expect(capLapCovers(2000, "2026-01-01T00:00:00Z", Date.now()), "the Oracle proof now fires below its own cap")
      .toBe(false);
  });
});
