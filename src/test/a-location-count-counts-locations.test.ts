import { describe, expect, it } from "vitest";
import { collapseClusters } from "../../supabase/functions/job-board/clusters";

/**
 * "ALSO HIRING IN 84 MORE LOCATIONS" — ABOUT A ROLE IN ONE CITY.
 *
 * collapseClusters folds sibling postings (same employer, same title) into one
 * card and reports how many places the role covers. It counted sibling ROWS
 * and called them locations — while deduping the sample list it displayed
 * beside the number, so the code demonstrably knew locations repeat and
 * counted them anyway. Measured 2026-08-23 over the whole servable set: 2.4%
 * of served cards claimed locations that do not exist. The largest was a
 * single-location Kyiv role posted 85 times, captioned as 84 more locations.
 *
 * The card that renders the number sits on a board whose header promises
 * "zero ghost jobs". A phantom location is a small ghost.
 *
 * Same-place repeats are genuine requisitions (85 openings is real hiring) —
 * they are OPENINGS, not places, and the fold now reports both counts so the
 * client can say whichever is true.
 *
 * This file WALKS the fold rather than grepping the source, because the
 * defect lived precisely in the gap between what the code said and what it
 * counted.
 */
const row = (title: string, location: string, id: string) =>
  ({ id, company: "Acme", title, location }) as Record<string, unknown>;

describe("a location count counts locations", () => {
  it("the Kyiv case: 85 postings, one city, ZERO extra locations", () => {
    const rows = Array.from({ length: 85 }, (_, i) => row("Economic Security Specialist", "Kyiv, UA", `r${i}`));
    const { jobs } = collapseClusters(rows, 60);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].postingCount).toBe(85);
    expect(jobs[0].locationCount, "one city is one location, however many times it is posted").toBe(1);
  });

  it("a genuinely multi-site role counts its distinct places, uncapped", () => {
    // The display sample is capped at six; the COUNT must not be, or a role
    // across 13 sites reads "6 more locations".
    const rows = Array.from({ length: 13 }, (_, i) => row("Field Engineer", `City ${i}`, `r${i}`));
    const { jobs } = collapseClusters(rows, 60);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].locationCount).toBe(13);
    expect((jobs[0].otherLocations as string[]).length, "the display sample stays capped").toBeLessThanOrEqual(6);
  });

  it("mixed: repeats within a city do not inflate the place count", () => {
    const rows = [
      row("Nurse", "Pueblo, CO", "a"), row("Nurse", "Pueblo, CO", "b"),
      row("Nurse", "Denver, CO", "c"), row("Nurse", "Denver, CO", "d"),
      row("Nurse", "Boulder, CO", "e"),
    ];
    const { jobs } = collapseClusters(rows, 60);
    expect(jobs[0].postingCount).toBe(5);
    expect(jobs[0].locationCount).toBe(3);
  });

  it("an unfolded card carries neither count", () => {
    const { jobs } = collapseClusters([row("Solo Role", "Berlin", "x")], 60);
    expect(jobs[0].postingCount).toBeUndefined();
    expect(jobs[0].locationCount).toBeUndefined();
  });

  it("blank locations fold without minting a phantom place", () => {
    const rows = [row("Ghost", "", "a"), row("Ghost", "", "b"), row("Ghost", "", "c")];
    const { jobs } = collapseClusters(rows, 60);
    expect(jobs[0].postingCount).toBe(3);
    expect(jobs[0].locationCount, "no location text means no countable place beyond the card itself")
      .toBeLessThanOrEqual(1);
  });

  it("rawConsumed still counts source rows, so pagination cannot skip", () => {
    const rows = [
      ...Array.from({ length: 5 }, (_, i) => row("A", `L${i}`, `a${i}`)),
      row("B", "Solo", "b0"),
    ];
    const { jobs, rawConsumed } = collapseClusters(rows, 60);
    expect(jobs).toHaveLength(2);
    expect(rawConsumed).toBe(6);
  });
});
