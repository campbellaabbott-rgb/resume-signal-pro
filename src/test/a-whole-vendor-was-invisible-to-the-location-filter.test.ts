import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeTeamtailor, detectCountry } from "../../supabase/functions/job-board/normalize";

/**
 * EVERY TEAMTAILOR POSTING ON THE BOARD HAD NO LOCATION. ALL 10,858 OF THEM.
 *
 * Measured live 2026-08-25 against the servable set (missing_since IS NULL):
 *
 *   total servable            559,854
 *   location empty or null     20,710  (3.7%)
 *     teamtailor               10,858  <- 10,858 of 10,858 rows, the WHOLE vendor
 *     workday                   9,411
 *     icims                        70
 *     every other vendor            0
 *   country null              156,672  (28%)
 *     teamtailor               10,858  <- again the whole vendor
 *
 * A row with no location can never match a location filter, and country is
 * derived from location, so it could never match that either. The vendor was
 * invisible to two filters and to department.
 *
 * The parser's own comment explained why: "the feed is title/link/pubDate only
 * — location isn't structured". That was simply untrue. The feed's root element
 * declares xmlns:tt="https://teamtailor.com/locations", and on capiosverigeab,
 * 100 items sampled the same day:
 *
 *   tt:city       100/100    tt:country     100/100
 *   tt:department  98/100    remoteStatus   100/100
 *
 * The data was arriving on every single item and being dropped on the floor.
 *
 * The fixture below is REAL BYTES from that feed — three items chosen to cover
 * the remoteStatus vocabulary — not a hand-written mock. A mock would have been
 * written from the same wrong assumption as the parser.
 */
const RSS = readFileSync(resolve(__dirname, "fixtures/teamtailor-jobs.rss"), "utf8");
const jobs = normalizeTeamtailor(RSS, "Capio", "capiosverigeab");

describe("a whole vendor was invisible to the location filter", () => {
  it("parses every item in the fixture", () => {
    expect(jobs.length).toBe(3);
  });

  it("every posting now carries a location", () => {
    // The exact defect: location was the empty string on all of them.
    for (const j of jobs) {
      expect(j.location, `${j.title} has no location`).toBeTruthy();
      expect(j.location).not.toBe("");
    }
    expect(jobs.map((j) => j.location)).toEqual([
      "Båstad, Sweden",
      "Veberöd, Sweden",
      "Umeå, Sweden",
    ]);
  });

  it("the location shape is the one detectCountry already understands", () => {
    // "City, Country" is what every other vendor emits, so the country falls
    // out downstream with no teamtailor-specific branch. If this drifts, the
    // rows get a location and STILL never match a country filter.
    for (const j of jobs) expect(detectCountry(j.location)).toBe("SE");
  });

  it("department comes from the feed instead of being nulled", () => {
    expect(jobs.map((j) => j.department)).toEqual(["Läkare", "Psykosocialt", "Rehabilitering"]);
  });

  it("a stated work mode is believed; an unstated one is NOT invented", () => {
    // remoteStatus in this sample: none 80, hybrid 13, onsite 5, temporary 1.
    // "hybrid" and "onsite" are unambiguous. "none" is 80% of the vendor and
    // means "no remote status" as readily as it means onsite — and "onsite"
    // appears separately in the same feed, which is the tell. Claiming onsite
    // for four fifths of a vendor on that inference would be an invented field.
    const byStatus = Object.fromEntries(jobs.map((j) => [j.location.split(",")[0], j.workMode]));
    expect(byStatus["Veberöd"]).toBe("hybrid");
    expect(byStatus["Umeå"]).toBe("onsite");
    expect(byStatus["Båstad"], "remoteStatus=none must not be read as onsite").toBeNull();
  });

  it("remote is derived from the work mode, never set independently", () => {
    for (const j of jobs) expect(j.remote).toBe(j.workMode === "remote");
  });

  it("a feed without the tt namespace still parses, just without location", () => {
    // Older or trimmed feeds exist. Losing location is acceptable; throwing is
    // not, because this runs inside the ingest for every board.
    const bare = `<rss><channel><item>
      <title>Sjuksköterska</title>
      <link>https://x.teamtailor.com/jobs/12345-sjukskoterska</link>
      <pubDate>Tue, 25 Aug 2026 10:48:06 +0200</pubDate>
    </item></channel></rss>`;
    const out = normalizeTeamtailor(bare, "X", "x");
    expect(out.length).toBe(1);
    expect(out[0].location).toBe("");
    expect(out[0].department).toBeNull();
  });
});
