/**
 * DATE CLASSES MATCH THE LISTING RULE.
 *
 * WHAT HAPPENED. A posting's age has two writers: the listing (cards, panes
 * and posting pages, src/lib/listing/age.ts) and now the check answer
 * (supabase/functions/public-api/date-classes.ts), which an edge function
 * cannot share with the page and so carries its own copy. The listing learned
 * the hard way that Breezy, Paylocity and UKG rewrite a posting's date when it
 * is edited (audit JL2: up to 248 days younger than the posting), and prints
 * their date as a feed date, never as an age. A copy that forgot one system,
 * or counted days its own way, would print "posted 3 days ago" on the check
 * for a posting the card refuses to age.
 *
 * THE PROPERTY.
 *   - The date-moving systems are the listing's REDATING_SOURCES, exactly.
 *   - Over a corpus of systems, stamps (date-only, full timestamps, exact UTC
 *     midnights, late-evening stamps, a future date, garbage and none) and
 *     clocks, the check's age agrees with the listing's: no age where the
 *     listing has none, no day count where the listing prints a feed date,
 *     and otherwise the same day and the same count.
 *   - Every class has its note, and the classes are the five the design
 *     names.
 * The teeth: a copy missing one system, and one counting days its own way,
 * are each caught by the same comparison.
 */
import { describe, expect, it } from "vitest";
import { REDATING_SOURCES, listingAge } from "@/lib/listing/age";
import {
  DATE_CLASSES,
  DATE_CLASS_NOTE,
  EMPLOYER_RELATIVE,
  FEED_DATE_MOVES_ON_EDIT,
  REPUBLISH_MOVES_DATE,
  dateClassOf,
  postingAge,
  type PostingAge,
} from "../../supabase/functions/public-api/date-classes";

const SOURCES = [
  "greenhouse", "lever", "ashby", "workday", "oracle", "icims", "smartrecruiters", "workable", "teamtailor",
  "personio", "recruitee", "breezy", "paylocity", "ukg", "adp", "bamboohr", "pinpoint", "rippling", "jazzhr", "usajobs",
  "Breezy", " UKG ",
];
const STAMPS: Array<string | null> = [
  null, "", "not a date", "2026-13-45",
  "2026-11-30", "2026-12-06", "2026-12-07", "2027-01-01",
  "2026-11-30T00:00:00Z", "2026-11-30T00:00:00.000Z", "2026-11-30T23:59:59Z", "2026-11-30T23:59:59+05:00",
  "2026-12-05T18:30:00-08:00", "2025-06-01T12:00:00Z", "2026-12-06T11:59:00Z",
];
const CLOCKS = [
  new Date("2026-12-06T00:00:01Z"), new Date("2026-12-06T12:00:00Z"), new Date("2026-12-06T23:59:59Z"), new Date("2027-01-01T00:00:00Z"),
];

type Compare = (source: string, stamp: string | null, now: Date) => PostingAge;

/** Every point of the corpus where the check's age and the listing's age disagree. */
function disagreements(ageOf: Compare): string[] {
  const out: string[] = [];
  for (const source of SOURCES) {
    for (const stamp of STAMPS) {
      for (const now of CLOCKS) {
        const card = listingAge({ id: `${source.trim().toLowerCase()}:t:1`, source, postedAt: stamp as string }, now);
        const check = ageOf(source, stamp, now);
        const at = `${source} ${stamp} @${now.toISOString()}`;
        if (card.kind === "undated") {
          if (check.dateClass !== "none" || check.days !== null || check.day !== null) out.push(`${at}: the card prints no age, the check does`);
        } else if (card.kind === "redated") {
          if (check.dateClass !== "feed_date_moves_on_edit" || check.days !== null) out.push(`${at}: the card prints a feed date, the check an age`);
          if (check.day !== card.day) out.push(`${at}: feed day ${check.day} vs the card's ${card.day}`);
        } else {
          if (check.days !== card.days || check.day !== card.day) out.push(`${at}: ${check.days}d/${check.day} vs the card's ${card.days}d/${card.day}`);
          if (check.dateClass === "none" || check.dateClass === "feed_date_moves_on_edit") out.push(`${at}: class ${check.dateClass} for a dated card`);
        }
      }
    }
  }
  return out;
}

describe("date classes match the listing rule", () => {
  it("the systems whose date moves on edit are the listing's, exactly", () => {
    expect([...FEED_DATE_MOVES_ON_EDIT].sort()).toEqual([...REDATING_SOURCES].sort());
    expect(REDATING_SOURCES.length).toBeGreaterThan(0);
  });

  it("the check's age agrees with the card's at every point of the corpus", () => {
    expect(SOURCES.length * STAMPS.length * CLOCKS.length).toBeGreaterThan(1000);
    expect(disagreements(postingAge)).toEqual([]);
  });

  it("the five classes, each with its note, and the systems named for each", () => {
    expect([...DATE_CLASSES]).toEqual(["employer", "employer_relative", "feed_date_moves_on_edit", "republish_moves_date", "none"]);
    for (const c of DATE_CLASSES) expect(DATE_CLASS_NOTE[c].length, c).toBeGreaterThan(20);
    expect(EMPLOYER_RELATIVE).toEqual(["workday"]);
    expect(REPUBLISH_MOVES_DATE).toEqual(["ashby"]);
    expect(dateClassOf("workday", "2026-12-01")).toBe("employer_relative");
    expect(dateClassOf("ashby", "2026-12-01")).toBe("republish_moves_date");
    expect(dateClassOf("greenhouse", "2026-12-01")).toBe("employer");
    expect(dateClassOf("paylocity", "2026-12-01")).toBe("feed_date_moves_on_edit");
    expect(dateClassOf("greenhouse", null)).toBe("none");
  });

  it("an undated posting keeps no stamp at all, so nothing downstream can age it", () => {
    expect(postingAge("greenhouse", "not a date", CLOCKS[1])).toMatchObject({ postedAt: null, day: null, days: null, dateClass: "none" });
  });
});

describe("teeth", () => {
  it("a copy that forgot one date-moving system disagrees with the card", () => {
    const forgetsUkg: Compare = (source, stamp, now) => {
      const a = postingAge(source, stamp, now);
      return source.trim().toLowerCase() === "ukg" && a.dateClass === "feed_date_moves_on_edit"
        ? { ...a, dateClass: "employer", days: 3 }
        : a;
    };
    expect(disagreements(forgetsUkg).some((d) => d.includes("the card prints a feed date, the check an age"))).toBe(true);
  });

  it("a copy that counts from the timestamp, not the employer's day, disagrees with the card", () => {
    const byTheHour: Compare = (source, stamp, now) => {
      const a = postingAge(source, stamp, now);
      return a.days === null || !stamp ? a : { ...a, days: Math.floor((now.getTime() - Date.parse(stamp)) / 86_400_000) };
    };
    expect(disagreements(byTheHour).length).toBeGreaterThan(0);
  });
});
