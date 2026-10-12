/**
 * LOCATIONS SPLIT OUTSIDE PARENTHESES ONLY (job-listings audit JL13).
 *
 * "San Jose (Building 5 - North)" was cut at the dash into "San Jose
 * (Building 5" and "North)": a card printed half a bracket, and the bake
 * handed "San Jose (Building 5" to addressLocality. The listing module splits
 * only at bracket depth zero, says a repeated place once, never prints an
 * unmatched bracket, and — for the posting page's structured data — drops a
 * part whose brackets do not balance.
 *
 * And it is still displayLocation: every case the board's own guard
 * (a-requisition-number-is-not-a-place) pins on Jobs.tsx's copy gives the same
 * answer here, compared directly against that copy, so moving the function
 * cannot quietly change a card.
 */
import { describe, expect, it } from "vitest";
import {
  allListingPlaces,
  countryToName,
  displayLocation,
  dropUnbalancedParenSegments,
  isLocationCodeToken,
  parensBalanced,
  splitOutsideParens,
  withoutUnmatchedBrackets,
} from "@/lib/listing/location";
import { displayLocation as boardDisplayLocation, isLocationCodeToken as boardIsCode } from "@/pages/Jobs";

const LEIDOS_RAW = "0250 36th CS Andersen Air Force Base Guam - Expat";
const CORPUS = [
  LEIDOS_RAW,
  "Austin, TX, USA", "Cambridge", "Berlin, Germany", "Remote", "Hybrid",
  "HQ Chicago, IL", "MIT Campus", "Sao Paulo, SP, Brazil", "US-VA-Reston",
  "Winston-Salem, NC", "1600 Amphitheatre Parkway, Mountain View, CA",
  "5 Locations", "Multiple Locations - Remote", "New York, NY 10001",
  "London, United Kingdom | Hybrid", "REQ-8842-0031", "R0000123", "0250",
  "", "   ", "München", "Bengaluru, KA", "CS Andersen Air Force Base Guam",
  "CA San Francisco Bay", "US Fort Meade Maryland", "HQ Chicago", "REQ-1234 Remote",
  "0250 Boston - Hybrid", "R000123 Onsite - Austin, TX", "JR-88 Multiple Locations",
  "USA - CO - Denver", "United States-Florida-Melbourne", "Toronto; Ottawa", "Paris / Lyon",
];

describe("the move changed nothing the board's guard pins", () => {
  it("gives Jobs.tsx's answer on every string of the board guard's corpus", () => {
    for (const raw of CORPUS) {
      expect(displayLocation(raw), JSON.stringify(raw)).toEqual(boardDisplayLocation(raw));
    }
  });
  it("draws the code line where Jobs.tsx draws it", () => {
    for (const [t, opens] of [["0250", false], ["10001", false], ["1600", true], ["36th", false], ["REQ-1234", false], ["5", false], ["12", false], ["Guam", false], ["München", false], ["Winston-Salem", false]] as const) {
      expect(isLocationCodeToken(t, opens), t).toBe(boardIsCode(t, opens));
    }
  });
});

describe("a separator inside brackets is not a separator", () => {
  it("splits only at depth zero", () => {
    expect(splitOutsideParens("San Jose (Building 5 - North) - Hybrid", /\s+-\s+/y)).toEqual(["San Jose (Building 5 - North)", "Hybrid"]);
    expect(splitOutsideParens("Leeds (LS1, City Centre), UK", /,/y)).toEqual(["Leeds (LS1, City Centre)", " UK"]);
  });
  it("keeps the bracket whole on the card line", () => {
    const d = displayLocation("San Jose (Building - North) - Hybrid");
    expect(d.text).toBe("San Jose (Building - North) · Hybrid");
    expect(d.text).not.toMatch(/\(Building$|^North\)/);
  });
  it("Jobs.tsx's copy is the defect this fixes", () => {
    expect(boardDisplayLocation("San Jose (Building - North) - Hybrid").text, "re-read this guard if the board's copy was fixed too").toBe("San Jose (Building · North) · Hybrid");
  });
});

describe("a place said twice is said once", () => {
  it("collapses an adjacent repeated part and an adjacent repeated segment, and says the line was reduced", () => {
    const a = displayLocation("Barrington, Barrington, IL");
    expect(a.text).toBe("Barrington, IL");
    expect(a.reduced).toBe(true);
    const b = displayLocation("Canada - Canada");
    expect(b.text).toBe("Canada");
    expect(b.reduced).toBe(true);
    expect(displayLocation("Austin,, TX").text).toBe("Austin, TX");
  });
  it("leaves a non-adjacent repeat alone (it can be a real second place)", () => {
    expect(displayLocation("Paris - Lyon - Paris").text).toBe("Paris · Lyon · Paris");
  });
});

describe("no half a bracket is ever printed", () => {
  it("removes unmatched bracket characters and keeps every word", () => {
    expect(parensBalanced("Bangalore (Electronic City")).toBe(false);
    expect(withoutUnmatchedBrackets("Bangalore (Electronic City")).toBe("Bangalore Electronic City");
    expect(withoutUnmatchedBrackets("North) Campus")).toBe("North Campus");
    const d = displayLocation("Bangalore (Electronic City");
    expect(d.text).toBe("Bangalore Electronic City");
    expect(d.reduced).toBe(true);
    for (const raw of ["Bangalore (Electronic City", "North) Campus, OH", "A (B - C", "X [Y"]) {
      const text = displayLocation(raw).text ?? "";
      expect(parensBalanced(text), `${raw} -> ${text}`).toBe(true);
    }
  });
});

describe("the posting page's structured data gets no unbalanced part at all", () => {
  it("drops the unbalanced part with its separator and keeps the rest", () => {
    expect(dropUnbalancedParenSegments("Bangalore (Electronic City, Karnataka, India")).toBe("Karnataka, India");
    expect(dropUnbalancedParenSegments("USA - CA - San Jose (Building 5")).toBe("USA - CA");
    expect(dropUnbalancedParenSegments("Austin, TX (Hybrid)"), "a balanced line is untouched").toBe("Austin, TX (Hybrid)");
    expect(dropUnbalancedParenSegments("(Remote")).toBeNull();
    expect(dropUnbalancedParenSegments(null)).toBeNull();
  });
});

describe("the country and the list of places", () => {
  it("names the country only where the line does not, in the reader's language", () => {
    expect(countryToName("Cambridge", "GB", "en")).toBe("United Kingdom");
    expect(countryToName("Cambridge, UK", "GB", "en")).toBeNull();
    expect(countryToName("Austin, TX, United States", "US", "de"), "the English name on the line counts").toBeNull();
    expect(countryToName("Cambridge", "GB", "de")).toBe("Vereinigtes Königreich");
    expect(countryToName("Cambridge", "junk", "en")).toBeNull();
  });
  it("lists every distinct place a folded posting names, tidied", () => {
    expect(allListingPlaces({ location: "Austin, TX", otherLocations: ["Austin, TX", "0250 Boston - Hybrid", "REQ-1"] }))
      .toEqual(["Austin, TX", "Boston · Hybrid"]);
  });
});
