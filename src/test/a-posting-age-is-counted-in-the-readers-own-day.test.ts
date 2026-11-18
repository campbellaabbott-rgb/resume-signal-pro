/**
 * A POSTING AGE IS COUNTED IN THE READER'S OWN DAY (NB-22).
 *
 * WHAT WAS WRONG. listingAge counted whole UTC calendar days, so a card read
 * in New York at 21:00 said "posted 1 day ago" of a posting made at 18:00 that
 * same evening (23:00Z, which is the next UTC day by the reader's 02:00Z): a
 * posting inside the board's own "Today" filter. Swapping only "today" to the
 * reader's date would be wrong the other way: a 02:00Z posting would read
 * "today" on the evening before it was posted, in the reader's day.
 *
 * WHAT HOLDS NOW: given the reader's IANA zone, a full timestamp becomes the
 * reader's local date and a date-only stamp (or an exact UTC midnight) stays
 * the employer's calendar date; both are counted against the reader's local
 * today, with a future date reading today. With no zone, or a zone the runtime
 * does not know, the age is the UTC count it always was.
 */
import { describe, expect, it } from "vitest";
import { dayInZone, listingAge, readerTimeZone } from "@/lib/listing/age";

const job = (postedAt: string | null, id = "greenhouse:acme:1") => ({ id, source: null, postedAt });
const NY = "America/New_York";
const TOKYO = "Asia/Tokyo";

describe("a full timestamp", () => {
  it("posted this evening in New York reads today to a New York reader, not one day ago", () => {
    const now = new Date("2026-11-15T02:00:00Z"); // 21:00 on the 14th in New York
    expect(listingAge(job("2026-11-14T23:00:00Z"), now, NY)).toEqual({ kind: "dated", days: 0, day: "2026-11-14" });
  });

  it("posted at 02:00Z does not read today to a New York reader the evening before", () => {
    const now = new Date("2026-11-14T23:30:00Z"); // 18:30 on the 14th in New York
    // 02:00Z on the 14th is 21:00 on the 13th in New York: the reader's yesterday, though it is the UTC today.
    expect(listingAge(job("2026-11-14T02:00:00Z"), now, NY)).toEqual({ kind: "dated", days: 1, day: "2026-11-13" });
  });

  it("counts a Tokyo reader's days in Tokyo", () => {
    const now = new Date("2026-11-15T16:00:00Z"); // 01:00 on the 16th in Tokyo
    expect(listingAge(job("2026-11-15T14:00:00Z"), now, TOKYO)).toEqual({ kind: "dated", days: 1, day: "2026-11-15" });
  });
});

describe("a date-only stamp", () => {
  it("stays the employer's calendar date, whatever the reader's zone", () => {
    const now = new Date("2026-11-15T02:00:00Z"); // the 14th in New York
    expect(listingAge(job("2026-11-12"), now, NY)).toEqual({ kind: "dated", days: 2, day: "2026-11-12" });
    expect(listingAge(job("2026-11-12T00:00:00Z"), now, NY)).toEqual({ kind: "dated", days: 2, day: "2026-11-12" });
    expect(listingAge(job("2026-11-12T00:00:00.000+00:00"), now, NY)).toEqual({ kind: "dated", days: 2, day: "2026-11-12" });
  });

  it("an employer's tomorrow reads today", () => {
    const now = new Date("2026-11-15T02:00:00Z");
    expect(listingAge(job("2026-11-15"), now, NY)).toEqual({ kind: "dated", days: 0, day: "2026-11-14" });
  });
});

describe("what does not change", () => {
  it("no zone counts UTC days, as before", () => {
    const now = new Date("2026-11-15T02:00:00Z");
    expect(listingAge(job("2026-11-14T23:00:00Z"), now)).toEqual({ kind: "dated", days: 1, day: "2026-11-14" });
    expect(listingAge(job("2026-11-13T23:00:00Z"), now)).toEqual({ kind: "dated", days: 2, day: "2026-11-13" });
  });

  it("a zone the runtime does not know falls back to UTC days", () => {
    const now = new Date("2026-11-15T02:00:00Z");
    expect(listingAge(job("2026-11-13T23:00:00Z"), now, "Not/AZone")).toEqual(listingAge(job("2026-11-13T23:00:00Z"), now));
  });

  it("a re-dating system still prints no age, and an undated posting nothing", () => {
    const now = new Date("2026-11-15T02:00:00Z");
    expect(listingAge(job("2026-11-14T23:00:00Z", "breezy:acme:1"), now, NY)).toEqual({ kind: "redated", day: "2026-11-14" });
    expect(listingAge(job(null), now, NY)).toEqual({ kind: "undated" });
  });

  it("the reader's zone is what the runtime reports, and a day in a zone is that zone's calendar day", () => {
    expect(typeof readerTimeZone()).toBe("string");
    expect(dayInZone(Date.parse("2026-11-15T02:00:00Z"), NY)).toBe("2026-11-14");
    expect(dayInZone(Date.parse("2026-11-15T02:00:00Z"), "Not/AZone")).toBeNull();
  });
});
