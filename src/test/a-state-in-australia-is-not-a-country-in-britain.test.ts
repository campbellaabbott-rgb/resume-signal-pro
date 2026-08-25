import { describe, expect, it } from "vitest";
import { detectCountry, COUNTRY_MAP_VERSION } from "../../supabase/functions/job-board/normalize";

/**
 * TWENTY-FIVE OF TWENTY-FIVE SYDNEY JOBS WERE FILED UNDER THE UNITED KINGDOM.
 *
 * COUNTRY_PATTERNS is an ordered list and the first regex to match wins. The
 * GB pattern sits at index 1 and matches the bare word "wales"; the AU pattern
 * sat at index 7. So "Sydney, New South Wales, Australia" — a string that
 * names its own country in plain text, at the end — resolved to GB, because
 * Wales was read first.
 *
 * Measured live against 2026-08-25.6: `{"action":"list","location":"New South
 * Wales","limit":25}` returned 25 rows, every one of them `country: "GB"`,
 * every one of them reading "Sydney, New South Wales, Australia".
 *
 * A spot check returns zero, which is why this stood: the error only fires on
 * boards that spell the state out, so most Australian rows are fine and the
 * broken ones cluster on a handful of employers.
 *
 * ASSERTED ON RETURN VALUES, NOT SOURCE LITERALS — a guard that greps the
 * pattern passes while the function is dead. That trap has caught this repo
 * nine times.
 */
describe("a state in Australia is not a country in Britain", () => {
  it.each([
    ["Sydney, New South Wales, Australia", "AU"],
    ["Newcastle, New South Wales", "AU"],
    ["NEW SOUTH WALES", "AU"],
    ["Melbourne, Australia", "AU"],
  ] as const)("%s → %s", (loc, want) => {
    expect(detectCountry(loc)).toBe(want);
  });

  it.each([
    // Wales is still Wales. The guard excludes exactly one prefix, so every
    // real Welsh location must keep resolving to GB — including "South Wales",
    // which is a Welsh region and NOT the thing being excluded.
    ["Cardiff, Wales", "GB"],
    ["Newport, South Wales", "GB"],
    ["South Wales, UK", "GB"],
    ["Swansea, Wales, United Kingdom", "GB"],
    ["Edinburgh, Scotland", "GB"],
  ] as const)("%s stays %s", (loc, want) => {
    expect(detectCountry(loc)).toBe(want);
  });

  it("the map version was bumped so stored rows get re-derived", () => {
    // The mislabelled rows are already in the table. Without a bump the
    // backfill skips them and the fix only helps postings ingested from now
    // on — the board would keep serving Sydney as London indefinitely.
    expect(COUNTRY_MAP_VERSION).toBeGreaterThanOrEqual(5);
  });
});
