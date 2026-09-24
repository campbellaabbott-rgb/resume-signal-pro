/**
 * WHAT THIS GUARDS
 * ----------------
 * The Workday branch of fetchVendorDetail downloads the vendor's CXS
 * job-detail payload for every posting the description and structured sweeps
 * touch. That payload states where the job is. Until BUILD_VERSION .73 we
 * parsed remoteType and startDate out of it and dropped the place, so 43.6% of
 * live Workday rows carried no country and 18.4% carried a location string
 * naming nowhere ("2 Locations", "3 sites", empty).
 *
 * This guard pins the FIELD PATH that carries the country, and it pins it by
 * walking real captured payloads rather than by asserting on source text.
 *
 * WHY IT HAS TO BE THIS SHAPE
 * ---------------------------
 * The path is one level shallower than it looks. The build proposal specified
 * `jobPostingInfo.jobRequisitionLocation.country.country.alpha2Code`; the live
 * shape is `jobPostingInfo.jobRequisitionLocation.country.alpha2Code`. Measured
 * 2026-09-23 across 367 live unplaced Workday postings, the shallow path is
 * present on 367/367 and the deep path on 0/367. Coded as proposed, the reader
 * would have returned undefined on every posting in production while tsc, the
 * deno gate and every existing test stayed green — a silent no-op behind a
 * BUILD_VERSION note claiming a six-figure fill.
 *
 * So a guard that merely asserted the identifier appears in the file would
 * pass over dead code. This one runs the parser over payloads captured live
 * from five Workday tenants (src/test/fixtures/workday-cxs-place.json) and
 * checks the VALUES it returns.
 *
 * EVERY FIXTURE IS A CAPTURE, and one of them was not. The Beth Israel entry
 * was keyed `bilh~wd1~BILH:__bethisrael` — a site that is not in the catalogue
 * and a hand-written requisition id, with a hand-written location descriptor
 * to match. Its content happened to be consistent with reality, which is
 * exactly why it could sit here unnoticed in a file whose whole purpose is to
 * walk real payloads instead of trusting a description of them. It has been
 * replaced by a genuine capture: bilh's real Workday site is
 * `bilh~wd1~External`, and JR103173 (Surgical Technologist Cardiovascular OR)
 * returns location "Beth Israel Deaconess Medical Center" with requisition
 * descriptor "Boston - 330 Brookline Ave" and alpha2Code US — fetched from the
 * vendor's own CXS endpoint, HTTP 200, 2026-09-23.
 *
 * It also pins the disagreement rule. One of the five fixtures is a real
 * posting whose display location reads "Germany - Munich" and whose
 * descriptor says Germany, while the requisition's own country code says IE.
 * We store the display location, so writing IE beside it would file a
 * Munich-labelled row in the Ireland bucket. The reader refuses instead — and
 * it refuses on the DISPLAY LOCATION as well as on the descriptor, because the
 * descriptor is the field that can be missing: across 253 live payloads the
 * code is present on 252 and the descriptor on 251, and on that one payload
 * the refusal could not fire at all.
 *
 * TEETH: proven to fail by (a) switching the reader to the deep path,
 * (b) dropping the disagreement refusal, (c) checking only the descriptor and
 * not the display location, and (d) dropping the further-site country refusal.
 * Each turns an assertion below red. All restored.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { workdayDetailPlace } from "../../supabase/functions/job-board/normalize";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(join(HERE, "fixtures", "workday-cxs-place.json"), "utf8"),
) as Record<string, unknown>;

const WESTERN_UNION = "workday:westernunion~wd5~WesternUnionJobs:JR0131247-1";
const BETH_ISRAEL = "workday:bilh~wd1~External:JR103173";
const MUNICH_BUT_IRISH = "workday:salesforce~wd12~External_Career_Site:JR361184-1";
const BANGALORE = "workday:mavenir~wd1~Mavenir_Careers:R0016189-1";
const NEW_YORK = "workday:armaninollp~wd1~armanino:JR104376";

describe("the country the employer stated is the country we read", () => {
  it("reads a well-formed ISO code out of every captured payload that agrees with itself", () => {
    const agreeing = [WESTERN_UNION, BETH_ISRAEL, BANGALORE, NEW_YORK];
    for (const id of agreeing) {
      const place = workdayDetailPlace(FIXTURES[id]);
      expect(place.country, `${id} must yield a country`).toBeTruthy();
      expect(place.country, `${id} must be an uppercase alpha-2`).toMatch(/^[A-Z]{2}$/);
    }
    // The specific answers, so a reader that starts returning a constant, or
    // the wrong field, cannot pass by being well-formed.
    expect(workdayDetailPlace(FIXTURES[WESTERN_UNION]).country).toBe("US");
    expect(workdayDetailPlace(FIXTURES[BANGALORE]).country).toBe("IN");
    expect(workdayDetailPlace(FIXTURES[NEW_YORK]).country).toBe("US");
  });

  it("refuses when the payload states the country twice and the two disagree", () => {
    // Live posting: location "Germany - Munich", descriptor "Germany",
    // requisition country code IE. Storing the display location beside IE
    // would be the right number under the wrong noun.
    const place = workdayDetailPlace(FIXTURES[MUNICH_BUT_IRISH]);
    expect(place.location).toBe("Germany - Munich");
    expect(place.country).toBeNull();
  });

  it("refuses when the descriptor is ABSENT and only the display location contradicts the code", () => {
    // THE HOLE THE REFUSAL HAD. It compared the code with a SIBLING field —
    // jobPostingInfo.country.descriptor — rather than with the value it is
    // protecting, which is the display location we store. One live payload in
    // 253 carries the code with no descriptor, and on that shape the check
    // could not run at all. Reproduced here on the build's own load-bearing
    // fixture with its descriptor deleted: it used to answer IE beside the
    // location "Germany - Munich", a Munich row in the Ireland bucket, which
    // is the exact failure the docblock says the rule prevents.
    const withoutDescriptor = JSON.parse(JSON.stringify(FIXTURES[MUNICH_BUT_IRISH])) as
      { jobPostingInfo: Record<string, unknown> };
    delete withoutDescriptor.jobPostingInfo.country;
    const place = workdayDetailPlace(withoutDescriptor);
    expect(place.location).toBe("Germany - Munich");
    expect(place.country, "a Munich-labelled row was filed in the Ireland bucket").toBeNull();
  });

  it("refuses the country when another site of the same requisition is in another country", () => {
    // A requisition listing sites in several countries does not have ONE
    // country, and the vendor still hands us a single code for its primary
    // site. Four of the 68 rows a detail sweep would fill gained a country
    // that another of their own sites contradicts — a US row with a Canadian
    // site, an MX row with US, BE, IN and FR sites, a PE row with a Chilean
    // site, a DK row with a London site.
    const spread = {
      jobPostingInfo: {
        location: "Toronto, Ontario",
        additionalLocations: ["Buffalo, NY", "Toronto, Ontario"],
        country: { descriptor: "Canada" },
        jobRequisitionLocation: { country: { alpha2Code: "CA" } },
      },
    };
    expect(workdayDetailPlace(spread).country).toBeNull();
    // And it does NOT refuse where the further sites agree: the mavenir
    // fixture lists Mumbai beside Bangalore, both India.
    expect(workdayDetailPlace(FIXTURES[BANGALORE]).country).toBe("IN");
    expect(workdayDetailPlace(FIXTURES[BANGALORE]).additionalCount).toBe(1);
  });

  it("returns the employer's display location, not the requisition's primary site", () => {
    // On this posting the two differ: the display location is Denver and the
    // requisition's own location descriptor is an Atlanta street address. We
    // show the seeker the display string, so that is what we store.
    const place = workdayDetailPlace(FIXTURES[WESTERN_UNION]);
    expect(place.location).toBe("USA - CO - Denver");
    expect(place.additionalCount).toBeGreaterThan(0);
  });

  it("answers null rather than guessing when the payload carries no place", () => {
    expect(workdayDetailPlace(null)).toEqual({ country: null, location: null, additionalCount: 0 });
    expect(workdayDetailPlace({})).toEqual({ country: null, location: null, additionalCount: 0 });
    expect(workdayDetailPlace({ jobPostingInfo: {} }).country).toBeNull();
    // A malformed code is not a code.
    expect(workdayDetailPlace({
      jobPostingInfo: { jobRequisitionLocation: { country: { alpha2Code: "USA" } } },
    }).country).toBeNull();
    expect(workdayDetailPlace({
      jobPostingInfo: { jobRequisitionLocation: { country: { alpha2Code: 7 } } },
    }).country).toBeNull();
  });

  it("falls back to the spelled-out country name when no code is present", () => {
    // Not observed in 367 live fetches — every one carried a code — but the
    // arm exists because a payload without jobRequisitionLocation has been
    // reported, and an untested fallback is a fallback that does not work.
    // The name is resolved through detectCountry, the board's single country
    // vocabulary, so this arm cannot drift from every other surface.
    const place = workdayDetailPlace({
      jobPostingInfo: { location: "Somewhere", country: { descriptor: "United States of America" } },
    });
    expect(place.country).toBe("US");
    // A name that vocabulary does not carry stays null rather than guessed.
    expect(workdayDetailPlace({
      jobPostingInfo: { country: { descriptor: "Kiribati" } },
    }).country).toBeNull();
  });

  it("answers from the code alone, with no spelled-out name to fall back to", () => {
    // WITHOUT THIS THE GUARD HAS A HOLE. If the code path breaks, the
    // descriptor fallback still answers on every real payload, so the
    // fixture assertions above stay green while the field this build is
    // about is never read. Strip the descriptor and only the code can answer.
    const codeOnly = {
      jobPostingInfo: {
        location: "Bangalore, India",
        jobRequisitionLocation: { country: { alpha2Code: "IN" } },
      },
    };
    expect(workdayDetailPlace(codeOnly).country).toBe("IN");
    // And a code the name vocabulary could never produce, so the fallback
    // cannot coincidentally supply the same answer.
    const unmappable = {
      jobPostingInfo: { jobRequisitionLocation: { country: { alpha2Code: "BA" } } },
    };
    expect(workdayDetailPlace(unmappable).country).toBe("BA");
  });

  it("does not read the country from the path the proposal specified", () => {
    // The deep path, present on 0 of 367 live postings. A payload shaped the
    // way the proposal imagined must NOT be the thing that makes this work —
    // if a future edit moves the reader down a level, the live payloads above
    // go null and this states why.
    const deepOnly = {
      jobPostingInfo: { jobRequisitionLocation: { country: { country: { alpha2Code: "US" } } } },
    };
    expect(workdayDetailPlace(deepOnly).country).toBeNull();
  });
});
