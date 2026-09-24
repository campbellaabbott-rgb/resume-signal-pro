/**
 * WHAT THIS GUARDS
 * ----------------
 * No code path may take a country out of an ORGANISATION's name.
 *
 * Many feeds put a facility name in the location column instead of a town.
 * `detectCountry` ran a bare word-boundary test for the country word, so
 * "Beth Israel Deaconess Medical Center" — a Boston hospital — was filed under
 * Israel, and so was every other site in that health system.
 *
 * MEASURED LIVE 2026-09-23, anon key, walking the country=IL bucket (stated
 * total 725, 682 rows walked): 100 rows = 14.7% of the bucket are the
 * Boston-area Beth Israel Lahey system. Every one is Workday and every one is
 * a single employer token. A seeker filtering for jobs in Israel was handed a
 * per-diem CT technologist in Massachusetts.
 *
 * The same 14 of those rows fetched from the vendor's own CXS detail return
 * country US on 14/14, so this is not a case where the truth is unknowable —
 * it is a case where we invented an answer over an employer's own name.
 *
 * WHY THE TEST IS SHAPED THIS WAY
 * -------------------------------
 * It asserts the PROPERTY over the real strings the board serves, not the
 * spelling of a regex. A guard that pinned the pattern text would pass while
 * the pattern was bypassed, and would block a correct rewrite. The strings
 * below were copied out of the live country=IL walk.
 *
 * It also fixes the rule in both directions: a genuine mention of the country
 * must still resolve, or "conservative" becomes "broken". Both halves are
 * asserted, because a fix that only stopped answering would pass a one-sided
 * test and quietly cost the board every real posting in that country.
 *
 * TEETH: proven to fail by restoring the unguarded pattern — the first
 * assertion block then reports the organisation names resolving to IL again.
 * Restored immediately after.
 */
import { describe, expect, it } from "vitest";
import { COUNTRY_MAP_VERSION, detectCountry, detectPlace } from "../../supabase/functions/job-board/normalize";

/** Location strings taken verbatim from the live country=IL walk, 2026-09-23.
 *  Each is an organisation or facility name, and none of them is a place in
 *  the country its words name. */
const ORGANISATION_NAMES_IN_THE_LOCATION_COLUMN = [
  "Beth Israel Deaconess Medical Center",
  "Beth Israel Deaconess Hospital Plymouth",
  "Beth Israel Deaconess Hospital Milton",
  "Beth Israel Deaconess Hospital Needham",
  "Beth Israel Lahey Health",
  "Beth Israel Lahey Health Primary Care",
  "Beth Israel Lahey Health at Home",
  "Beth Israel Lahey Health Specialty Care",
  "Beth Israel Lahey Health Performance Network",
];

/** The same word, genuinely naming the place. Also verbatim from that walk. */
const REAL_PLACES_IN_THAT_COUNTRY = [
  "Tel Aviv, Israel",
  "Israel",
  "Office - Israel - Tel Aviv",
  "Tel Aviv, , Israel",
  "Jerusalem, Israel",
  "Ramat Gan, Israel",
  "Herzliya, Israel",
  "Migdal Ha'emek, Israel",
  "Tel Aviv District, Israel",
  "Office - Israel - CyberArk Petach Tikva",
];

describe("a country is never read out of an organisation's name", () => {
  it("does not place a hospital in the country its name happens to contain", () => {
    for (const name of ORGANISATION_NAMES_IN_THE_LOCATION_COLUMN) {
      expect(detectCountry(name), `${name} must not resolve to a country`).toBeNull();
    }
  });

  it("still places the country when the string genuinely names it", () => {
    for (const place of REAL_PLACES_IN_THAT_COUNTRY) {
      expect(detectCountry(place), `${place} must still resolve`).toBe("IL");
    }
  });

  it("applies to the whole place resolution, not only the country helper", () => {
    // detectPlace is what the ingest calls. A fix that landed in one entry
    // point and not the other would leave the defect live on the path that
    // matters.
    for (const name of ORGANISATION_NAMES_IN_THE_LOCATION_COLUMN) {
      expect(detectPlace(name).country, `${name} via detectPlace`).toBeNull();
    }
    expect(detectPlace("Tel Aviv, Israel").country).toBe("IL");
  });

  it("still resolves the country when an organisation name is followed by a real place", () => {
    // The guard is a narrow exception, not a blanket ban on the word appearing
    // near a proper noun: a second, genuine mention still answers.
    expect(detectCountry("Beth Israel Synagogue, Tel Aviv, Israel")).toBe("IL");
  });

  it("does not file a US town abroad because its name is a country's", () => {
    // THE CLASS IS NOT CLOSED BY ONE EMPLOYER, and the comment beside the
    // pattern used to say it was ("the word genuinely is the country
    // everywhere else"). The structural cause is the same: COUNTRY_PATTERNS
    // runs before the comma-prefixed US state code, which detectRegion's own
    // docblock calls the most certain form there is. Walked live with the anon
    // key 2026-09-23: the PE bucket (667 rows read) holds "Peru, IN" twice and
    // "Peru, IL" once; the TR bucket (504 rows) holds "Turkey, TX" twice.
    expect(detectCountry("Peru, IN")).toBe("US");
    expect(detectCountry("Peru, IL")).toBe("US");
    expect(detectCountry("Turkey, TX")).toBe("US");
    // And the subdivision follows, because the country is what gates it.
    expect(detectPlace("Peru, IN").country).toBe("US");
    expect(detectPlace("Peru, IN").region).toBe("US-IN");
  });

  it("still answers with the country where the country is what the string names", () => {
    // The other half, or "conservative" becomes "broken" again.
    expect(detectCountry("Lima, Peru")).toBe("PE");
    expect(detectCountry("Peru")).toBe("PE");
    expect(detectCountry("Istanbul, Turkey")).toBe("TR");
    expect(detectCountry("Turkey")).toBe("TR");
    // A lowercase trailing token is not a state code, it is a word.
    expect(detectCountry("Lima, Peru, in the south")).toBe("PE");
  });

  it("does not generalise the rule into the counterexample the same walk produced", () => {
    // WHY THIS IS A NAMED PAIR AND NOT A REORDERING. The obvious general fix —
    // run the comma-prefixed state code ahead of the ambiguous country words —
    // was refuted by the same live walk: the CN bucket holds "Shanghai, SD,
    // China" and "Weihai City, SD", where SD is SHANDONG. A trailing two-letter
    // code is only unambiguous once you already know the country is the US,
    // which is the question being decided.
    expect(detectCountry("Shanghai, SD, China")).toBe("CN");
    // NOT ASSERTED, AND SAID OUT LOUD RATHER THAN LEFT FOR THE NEXT READER TO
    // DISCOVER: the other row from that bucket, "Weihai City, SD", names no
    // country at all and today resolves to the United States through the state
    // code alone. That is a pre-existing mis-read this build neither introduced
    // nor fixes — fixing it needs a rule about bare two-letter codes, not a
    // word list — but it is the reason the reordering above is refused rather
    // than merely unnecessary: the reordering would turn the Shanghai row into
    // this one.
  });

  it("names the rule version that produced the stored answers", () => {
    // Stored country values are only interpretable against the vocabulary that
    // wrote them, and this change invalidates rows written under version 5.
    // Bumping is not optional when the table's ANSWERS change, not just its
    // entries. The backfill sweep only fills nulls, so the rows already
    // holding the old answer are repaired by the vendor's structured country,
    // not by this bump — see the constant's own comment.
    expect(COUNTRY_MAP_VERSION).toBeGreaterThanOrEqual(6);
  });
});
