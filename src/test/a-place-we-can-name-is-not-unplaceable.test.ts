import { describe, expect, it } from "vitest";
import { COUNTRY_MAP_VERSION, detectCountry } from "../../supabase/functions/job-board/normalize";

/**
 * 168,557 POSTINGS CARRY LOCATION TEXT AND NO PARSED COUNTRY.
 *
 * Measured 2026-08-22 against the live board: 28.9% of servable postings vanish
 * the moment a visitor picks a country, and NOT ONE of them has an empty
 * location column at the source — zero postings lack location text entirely.
 * The place is written down; we just could not read it.
 *
 * SAMPLING 5,000 OF THEM SPLIT THE GAP INTO CLASSES, and most of it is honestly
 * unreadable rather than badly parsed:
 *   17.5%  Workday's "2 Locations" multi-site placeholder — the list endpoint
 *          genuinely does not carry the sites, and the normalizer already says so
 *   12.5%  empty string
 *   40.4%  one bare segment: real cities, but also "Main Campus", "Property -
 *          Aria", "Memorial Hospital West" — facility names with no place in them
 *    3.7%  the text NAMES the place and we failed to read it. That is this file.
 *
 * WHAT WAS DELIBERATELY NOT BUILT, because measuring it is what showed it was
 * wrong: inferring a posting's country from its employer's OTHER postings. It
 * sounds safe and it is not — of 60 sampled employers only 28% resolve to a
 * single country, while 48% span several, so the rule would mislabel at scale.
 * And the country control promises, in words, that "postings we can't place are
 * excluded while this is on, never guessed". A filter that quietly guesses is
 * worse than one that admits a gap.
 *
 * So everything below is the text naming the place. Nothing is inferred.
 */
describe("a place we can name is not unplaceable", () => {
  it("a location that IS a country name resolves to it", () => {
    // Thirty-eight of the 5,000 sampled said outright where they were and were
    // still filed as unplaceable — roughly 1,280 postings board-wide.
    const cases: Array<[string, string]> = [
      ["China", "CN"], ["Pakistan", "PK"], ["Taiwan", "TW"], ["Bulgaria", "BG"],
      ["Croatia", "HR"], ["Slovakia", "SK"], ["Serbia", "RS"], ["Slovenia", "SI"],
      ["Egypt", "EG"], ["Morocco", "MA"], ["Tunisia", "TN"], ["Kenya", "KE"],
      ["Ecuador", "EC"], ["Uruguay", "UY"],
    ];
    for (const [loc, code] of cases) {
      expect(detectCountry(loc), `"${loc}" should resolve to ${code}`).toBe(code);
    }
  });

  it("reads a state code that comes FIRST, which some feeds do", () => {
    // The established pattern requires a comma before the code — "Austin, TX" —
    // so state-first strings were invisible. Largest recoverable class in the
    // gap: 146 of 5,000 sampled, roughly 4,900 postings.
    expect(detectCountry("AR Hot Springs")).toBe("US");
    expect(detectCountry("NC - Raleigh")).toBe("US");
    expect(detectCountry("TX Dallas")).toBe("US");
    expect(detectCountry("MN – Minneapolis")).toBe("US");
  });

  it("refuses the two-letter tokens that are also ordinary words", () => {
    // A LEADING code is much weaker evidence than a trailing one, so the list is
    // deliberately shorter than fifty. Each of these would be a mislabel, and a
    // mislabel breaks a promise the country control makes in words.
    expect(detectCountry("OR Tambo"), "an airport in Johannesburg, not Oregon").not.toBe("US");
    expect(detectCountry("IN Person Interviewer"), "'in' is a word").not.toBe("US");
    expect(detectCountry("ME Office"), "'me' is a word").not.toBe("US");
    expect(detectCountry("OK Corral"), "'ok' is a word").not.toBe("US");
    expect(detectCountry("HI Team"), "'hi' is a word").not.toBe("US");
    expect(detectCountry("DE Haan"), "a Belgian town; 'de' opens names in several languages").not.toBe("US");
    expect(detectCountry("LA Defense"), "La Défense is in Paris").not.toBe("US");
  });

  it("still refuses Georgia, for the reason the state-name list already did", () => {
    // Georgia is a US state AND a country, so it is absent from the state-name
    // pattern on purpose. The additions here must not quietly undo that.
    expect(detectCountry("Georgia")).not.toBe("US");
  });

  it("leaves the honestly unreadable alone rather than guessing", () => {
    for (const loc of ["2 Locations", "3 Locations", "Main Campus", "Property - Aria", "Memorial Hospital West", "Remote", ""]) {
      expect(detectCountry(loc), `"${loc}" names no place and must stay unplaced`).toBeNull();
    }
  });

  it("does not disturb what already worked", () => {
    expect(detectCountry("Austin, TX")).toBe("US");
    expect(detectCountry("Toronto, ON")).toBe("CA");
    expect(detectCountry("London, UK")).toBe("GB");
    expect(detectCountry("Kuala Lumpur")).toBe("MY");
  });

  it("bumps the map version, or the backfill never re-reads the old rows", () => {
    // The table is versioned precisely so a parser change re-runs over postings
    // already stored. Adding rules without bumping it fixes only what arrives
    // after the deploy, and the 168,557 already on the board stay unplaced.
    expect(COUNTRY_MAP_VERSION).toBeGreaterThanOrEqual(3);
  });
});
