// @vitest-environment node
/**
 * A US TOWN NAMED AFTER A COUNTRY IS FILED IN THE US.
 *
 * Trust round 3 (owner decision: pages carry true countries). Workday rows at
 * Lake Wales FL, Greece NY and Peru IN/IL were filed in Great Britain, Greece
 * and Peru whenever the state was not written as ", XX": 13 rows "Lake Wales"
 * GB, 8 "Greece, NY #0185" or "NY - Greece" GR, 2 "IN/IL - Peru" PE and Dick's
 * "Store0006 Greece NY" GR, live 2026-10-26, each a wrong country on a posting
 * page and in the country filter. COUNTRY_MAP_VERSION 12 (normalize.ts
 * P_COUNTRY_WORD_US_TOWN and the GB pattern, n1396).
 *
 * CORPUS-FIRST. The fixture holds every distinct location string of 19,064
 * real rows (src/test/fixtures/trust-round3-country/town-corpus.json, with the
 * reading of both readers at origin/trust/pages 4b62fb7a), 737 of which name
 * Wales, Greece, Peru or Turkey. Every string must read as it did there,
 * except the measured fixes below, each checked against the vendor's own
 * country (Workday's alpha2Code where it was read, the state the string
 * itself names otherwise). So the rule is never worse than the reader it
 * replaces on anything measured.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { COUNTRY_MAP_VERSION, detectCountry, statedCountry } from "../../supabase/functions/job-board/normalize";

const CORPUS = JSON.parse(readFileSync(resolve(__dirname, "fixtures/trust-round3-country/town-corpus.json"), "utf8")) as {
  basis: string;
  rows: Array<[string, string | null, string | null]>;
};

/** Each string the rule changes, with the country it now reads and why that is right. */
const CHANGED: Record<string, { want: string | null; why: string }> = {
  "Store 2706993 Lake Wales FL": { want: "US", why: "Circle K R630769-1, Workday alpha2Code US" },
  "FL - Lake Wales": { want: "US", why: "CVS Health, the string names Florida" },
  "FL-Lake Wales": { want: "US", why: "Dollar Tree, the string names Florida" },
  "Lake Wales, FL - 1900 Old Bartow Rd": { want: "US", why: "J.B. Hunt, the string names Florida" },
  "606371 Lake Wales, FL - US Highway 27": { want: "US", why: "Panera Bread, the string names Florida" },
  "Lake Wales, FL (Job Posting Location)": { want: "US", why: "Lennar, the string names Florida (stored US already)" },
  "Lake Wales (1250)": { want: null, why: "Kohl's R504030, Workday alpha2Code US: no state in the string, so no country rather than Wales" },
  "Store0006 Greece NY": { want: "US", why: "Dick's Sporting Goods 202641368, Workday alpha2Code US" },
  "NY - Greece": { want: "US", why: "CVS Health, the string names New York" },
  "Greece, NY #0185": { want: "US", why: "BJ's Wholesale Club, the string names New York" },
  "601095 Greece, NY - West Ridge Road": { want: "US", why: "Panera Bread, the string names New York" },
  "IN - Peru": { want: "US", why: "CVS Health, the string names Indiana" },
  "IL - Peru": { want: "US", why: "CVS Health, the string names Illinois" },
};

describe("the corpus: every distinct live location string reads as it did at 4b62fb7a, except the measured fixes", () => {
  it("holds the real corpus the rule was measured on", () => {
    expect(CORPUS.rows.length).toBeGreaterThanOrEqual(5_000);
    expect(CORPUS.basis).toMatch(/19,064/);
    const named = CORPUS.rows.filter(([l]) => /\b(?:wales|greece|peru|turkey)\b/i.test(l)).length;
    expect(named, "the corpus no longer holds the strings this rule is about").toBeGreaterThan(80);
  });

  it("both readers: no string moves but the measured ones, and those move to the vendor's answer", () => {
    const drift: string[] = [];
    for (const [loc, d0, s0] of CORPUS.rows) {
      const c = Object.prototype.hasOwnProperty.call(CHANGED, loc) ? CHANGED[loc] : null;
      const wantD = c ? c.want : d0;
      const wantS = c ? c.want : s0;
      const d = detectCountry(loc), s = statedCountry(loc);
      if (d !== wantD) drift.push(`detectCountry(${JSON.stringify(loc)}) = ${d}, want ${wantD} (was ${d0})`);
      if (s !== wantS) drift.push(`statedCountry(${JSON.stringify(loc)}) = ${s}, want ${wantS} (was ${s0})`);
    }
    expect(drift).toEqual([]);
  });

  it("every measured fix is in the corpus and really read a country the vendor contradicts", () => {
    const at = new Map(CORPUS.rows.map(([l, d]) => [l, d]));
    for (const [loc, c] of Object.entries(CHANGED)) {
      expect(at.has(loc), loc).toBe(true);
      expect(["GB", "GR", "PE"], `${loc} read ${at.get(loc)} at 4b62fb7a`).toContain(at.get(loc));
      expect(c.want === "US" || c.want === null, loc).toBe(true);
    }
  });
});

describe("the rule needs a state the string names, upper case and one of the fifty-one", () => {
  it("each form places the town in the US", () => {
    for (const s of ["Peru, IN", "Turkey, TX", "Greece, NY", "NY - Greece", "TX - Turkey", "IN, Peru", "Store0006 Greece NY", "Greece NY", "Lake Wales FL"]) {
      expect(detectCountry(s), s).toBe("US");
      expect(statedCountry(s), s).toBe("US");
    }
  });

  it("the countries keep their names: Wales, Greece, Peru and Turkey written as countries", () => {
    expect(detectCountry("Cardiff, Wales")).toBe("GB");
    expect(detectCountry("Swansea, Wales, United Kingdom")).toBe("GB");
    expect(detectCountry("Sydney, New South Wales")).toBe("AU");
    expect(detectCountry("Athens Greece GR")).toBe("GR");
    expect(detectCountry("GR - Greece")).toBe("GR");
    expect(detectCountry("Athens, Greece")).toBe("GR");
    expect(detectCountry("Lima Peru PE")).toBe("PE");
    expect(detectCountry("Lima, Peru")).toBe("PE");
    expect(detectCountry("Turkey, Istanbul")).toBe("TR");
    expect(detectCountry("Istanbul, Turkey")).toBe("TR");
  });

  it("a lower-case or unknown code is not a state", () => {
    expect(detectCountry("Greece ny")).toBe("GR");
    expect(detectCountry("Peru ZZ")).toBe("PE");
    expect(detectCountry("Turkey - Istanbul")).toBe("TR");
  });

  it("a row with no state is not guessed: the seven residual rows keep today's reading for a later round", () => {
    // Workday's alpha2Code says US for each (read 2026-10-26); no string rule can.
    for (const s of ["SCHI - Greece", "Chemical Dependency - Greece Clinic", "Allergy & Rheumatology - Greece", "WNY - Reed Eye - Greece"]) expect(detectCountry(s), s).toBe("GR");
    expect(detectCountry("US TX Turkey 1 DC1")).toBe("TR");
  });

  it("the map version moved, so the backfill sweep re-reads the rows stored with no country", () => {
    expect(COUNTRY_MAP_VERSION).toBe(12);
  });
});
