/**
 * A POSTING IN LAGOS IS FILED IN NIGERIA, AND ONE IN NEW JERSEY IN THE US.
 *
 * Two of the six pages the SEO round's name gate listed under owner decision
 * D7 (docs/company-profiles/name-gate-dry-run.md, table 1) withheld their
 * JobPosting because the stored country contradicted the location the page
 * printed. Both stored countries were the reader's mistake, not the
 * employer's, and the owner's decision of 2026-10-25 is to fix the reading so
 * the country rule passes honestly, never to loosen the rule.
 *
 *   - smartrecruiters/ThePlace1/744000154839819, "Lagos, LA, Nigeria", filed
 *     US: SmartRecruiters states the country ("ng"), the coordinates and the
 *     city, and normalizeSmartRecruiters dropped all three, so the location
 *     string was read alone and "LA" matched as Louisiana. 47 live rows on 15
 *     boards had that fault (40 Nigeria, 3 Nicaragua, 2 Iraq, 1 Kazakhstan,
 *     1 North Macedonia filed CA).
 *   - workday/bristolmyerssquibb~wd5~BMS/R1607072-1, "New Brunswick - NJ - US",
 *     filed CA: the dash form has no comma, so the Canadian province name won
 *     before the trailing US was read, and the Workday detail reader then
 *     refused the vendor's own alpha2Code US as a contradiction. 10 live rows,
 *     8 of them with their pay stored as CAD.
 *
 * Every case below is a capture (src/test/fixtures/trust-pages-country/):
 * the SmartRecruiters postings as the vendor's API answered them on
 * 2026-10-25, the BMS Workday payload, and every distinct location string of
 * the live rows the country investigation read that day. The corpus pins the
 * reader at origin/oh/integration 8a65d88a for every string, except the ones
 * named in CHANGED, each checked against the vendor's own country field. So
 * the fix is never worse than the reader it replaces on anything measured.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COUNTRY_MAP_VERSION,
  detectCountry,
  normalizeSmartRecruiters,
  payToReparse,
  statedCountry,
  workdayDetailPlace,
} from "../../supabase/functions/job-board/normalize";
import { parseSalaryStructured } from "../../supabase/functions/_shared/salary-extract";

const FX = resolve(__dirname, "fixtures/trust-pages-country");
const read = <T>(f: string): T => JSON.parse(readFileSync(resolve(FX, f), "utf8")) as T;

type SrLoc = { city?: string; region?: string; country?: string; latitude?: string; longitude?: string; fullLocation?: string };
type SrRow = { token: string; id: string; url: string; location: SrLoc; main: string | null };
const SR = (() => {
  const seen = new Set<string>();
  return read<SrRow[]>("smartrecruiters-postings.json").filter((r) => {
    const k = `${r.token}:${r.id}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
})();
const srCountry = (r: SrRow) =>
  normalizeSmartRecruiters({ content: [{ id: r.id, name: "Captured posting", location: r.location }] }, "Captured", r.token)[0]?.country ?? null;

/**
 * Where each captured posting is, by the vendor's own record, and why when the
 * vendor's country field is not the answer: Dominos' Biloxi row carries a US
 * street, ZIP and coordinates beside a stray "dz"; TechVedika's carries
 * Hyderabad, Telangana and an Indian postal code beside "dz". Gcore's lists
 * four countries and has no single answer, so it is not judged.
 */
const TRUTH = (r: SrRow): string | null | "skip" => {
  if (r.token === "Gcore") return "skip";
  if (r.token === "Dominos" || r.token === "dominos") return "US";
  if (r.token === "TechVedika") return "IN";
  if (r.location.country === "mq") return "MQ";
  return String(r.location.country ?? "").toUpperCase() || null;
};
/** A Martinique row filed FR is filed in the state it belongs to: right either way. */
const right = (got: string | null, truth: string | null) => got === truth || (truth === "MQ" && got === "FR");

describe("SmartRecruiters: the employer's own country overrules a region code read as a US state or a Canadian province", () => {
  it("every captured posting the reader filed wrongly in the US or Canada is now filed where the vendor places it, and none it filed rightly moves", () => {
    const fixed: string[] = [];
    for (const r of SR) {
      const truth = TRUTH(r);
      if (truth === "skip") continue;
      const now = srCountry(r);
      if (right(r.main, truth)) expect(now, `${r.token}/${r.id} "${r.location.fullLocation}" was right (${r.main}) and must stay right`).toSatisfy((g: string | null) => right(g, truth));
      else if (right(now, truth)) fixed.push(`${r.token}:${now}`);
    }
    // 36 Nigeria (Lagos, Ikeja, Lekki; the four StandardBankGroup captures whose location is a bare ","
    // stay unplaced, as they are today), 3 Nicaragua, 2 Iraq, 1 North Macedonia and 1 Kazakhstan.
    const by = (c: string) => fixed.filter((x) => x.endsWith(`:${c}`)).length;
    expect({ NG: by("NG"), NI: by("NI"), IQ: by("IQ"), MK: by("MK"), KZ: by("KZ"), all: fixed.length }).toEqual({ NG: 36, NI: 3, IQ: 2, MK: 1, KZ: 1, all: 43 });
  });

  it("the four StandardBankGroup captures whose detail answer says \",\" read \"Lagos, LA, Nigeria\" in the list the board reads, and are filed NG with it", () => {
    const sb = SR.filter((x) => x.token === "StandardBankGroup" && x.location.fullLocation === ", ");
    expect(sb.length).toBe(4);
    for (const r of sb) {
      expect(r.main).toBeNull();
      expect(srCountry({ ...r, location: { ...r.location, fullLocation: "Lagos, LA, Nigeria" } }), r.id).toBe("NG");
    }
  });

  it("the D7 page's own posting, ThePlace1 744000154839819, is filed NG", () => {
    const r = SR.find((x) => x.token === "ThePlace1" && x.id === "744000154839819")!;
    expect(r.main).toBe("US");
    expect(srCountry(r)).toBe("NG");
  });

  it("coordinates in North America keep the reading: Dominos' Biloxi row stays US beside the vendor's stray dz", () => {
    const r = SR.find((x) => /^dominos$/i.test(x.token))!;
    expect(r.location).toMatchObject({ city: "Biloxi", region: "MS", country: "dz" });
    expect(srCountry(r)).toBe("US");
  });

  it("a reading that is not the US or Canada is never overruled: TechVedika's Hyderabad stays IN beside dz", () => {
    const r = SR.find((x) => x.token === "TechVedika")!;
    expect(srCountry(r)).toBe("IN");
  });

  it("without coordinates the vendor wins only where the city table already places the city there", () => {
    const myrtle = SR.find((x) => x.token === "MyrtleManagementConsultants")!;
    expect(myrtle.location.latitude).toBeUndefined();
    expect(srCountry(myrtle)).toBe("NG"); // lagos is NG in the city table
    const wabtec = SR.find((x) => x.token === "Wabtec")!;
    expect(wabtec.location).toMatchObject({ city: "Astana", region: "AK", country: "kz" });
    expect(wabtec.location.latitude).toBeUndefined();
    expect(srCountry(wabtec)).toBe("KZ"); // astana joined the city table with this fix
    // A made-up row: no coordinates, a city the table does not know, a two-letter region: the reading stays.
    expect(srCountry({ token: "x", id: "1", url: "", main: null, location: { city: "Nowhereville", region: "LA", country: "ng", fullLocation: "Nowhereville, LA, Nigeria" } })).toBe("US");
  });

  it("the rows this fix does not reach keep today's answer (a region written in words, not a two-letter code)", () => {
    const keep = (token: string) => SR.filter((x) => x.token === token).map((x) => [x.main, srCountry(x)]);
    expect(keep("SGS")).toEqual([["US", "US"]]); // "Senai, Non United States Or Canada, Malaysia"
    expect(keep("TurnerTownsend")).toEqual([["AU", "AU"], ["AU", "AU"]]); // "Auckland, Australia & New Zealand, New Zealand"
    expect(keep("JobsForHumanity")).toEqual([["AU", "AU"]]); // "Australia, Matanzas, Cuba"
  });

  it("a stated country that agrees, or no stated country at all, changes nothing", () => {
    expect(srCountry({ token: "x", id: "1", url: "", main: null, location: { city: "Austin", region: "TX", country: "us", fullLocation: "Austin, TX, United States" } })).toBe("US");
    expect(srCountry({ token: "x", id: "2", url: "", main: null, location: { city: "Austin", region: "TX", fullLocation: "Austin, TX" } })).toBe("US");
    expect(srCountry({ token: "x", id: "3", url: "", main: null, location: { city: "Berlin", country: "de", fullLocation: "Berlin, Germany" } })).toBe("DE");
  });
});

describe("Workday: a state code before a closing US is the US, before any province name", () => {
  it("the D7 page's own location reads US, by both readers", () => {
    expect(detectCountry("New Brunswick - NJ - US")).toBe("US");
    expect(statedCountry("New Brunswick - NJ - US")).toBe("US");
  });

  it("the captured BMS payload is placed in the US: the detail reader no longer refuses its own alpha2Code", () => {
    const pay = read<unknown>("workday-bms-R1607072-1.json");
    expect(workdayDetailPlace(pay)).toEqual({ country: "US", location: "New Brunswick - NJ - US", additionalCount: 0 });
  });

  it("a province or country word before the state code does not win; a list of countries and a Canadian dash form are untouched", () => {
    for (const s of ["Ontario - CA - US", "Newfoundland - NJ - US", "Greece - NY - US", "Brazil, IN, US", "Norway, ME, US", "Mexico, IN, US"]) expect(detectCountry(s), s).toBe("US");
    expect(detectCountry("Remote - US & Canada")).toBe("CA");
    expect(detectCountry("Remote - Canada · Remote - US")).toBe("CA");
    expect(statedCountry("Moncton - NB - CA")).toBeNull(); // as at 8a65d88a: the rule needs a closing US
    expect(detectCountry("Saint John, New Brunswick, Canada")).toBe("CA");
  });
});

describe("the corpus: every distinct live location string answers what the reader at 8a65d88a answered, except the measured fixes", () => {
  const CORPUS = read<{ basis: string; rows: Array<[string, string | null]> }>("location-corpus.json");
  /** Each string this fix changes, with the country the vendor's own field states. */
  const CHANGED: Record<string, string> = {
    "New Brunswick - NJ - US": "US", // Bristol Myers Squibb, Workday alpha2Code US (10 rows filed CA, 1 with none)
    "Brazil, IN, US": "US", // ADP, stored US already through adpCountry
    "Norway, ME, US": "US",
    "Mexico, IN, US": "US",
    "CHINA GROVE, San Antonio, TX, US": "US",
    // astana joined the city table for Wabtec's SmartRecruiters row ("Astana, AK, Kazakhstan", vendor "kz",
    // placed by smartRecruitersCountry); the string alone still reads US, and these, unplaced until now, read KZ.
    "Astana, Astana, Kazakhstan": "KZ",
    "Astana, Kazakhstan": "KZ",
    "Astana, Kazakhstan, Kazakhstan": "KZ",
    // Trust round 3 (COUNTRY_MAP_VERSION 12, n1396): US towns named after countries, each measured
    // against the vendor's own country and the 19,064-row corpus in
    // a-us-town-named-after-a-country-is-filed-in-the-us.test.ts.
    "606371 Lake Wales, FL - US Highway 27": "US",
    "FL - Lake Wales": "US",
    "FL-Lake Wales": "US",
    "IL - Peru": "US",
    "IN - Peru": "US",
    "Lake Wales, FL (Job Posting Location)": "US",
    "Lake Wales, FL - 1900 Old Bartow Rd": "US",
    "NY - Greece": "US",
    "Store 2706993 Lake Wales FL": "US",
    "Store0006 Greece NY": "US",
  };
  /** Strings the fix takes from a wrong country to none, where the vendor's own field says US. */
  const UNPLACED: Record<string, null> = { "Lake Wales (1250)": null };

  it(`holds a real corpus (${"5,596"} strings) and pins it`, () => {
    expect(CORPUS.rows.length).toBeGreaterThanOrEqual(5_000);
    const drift: string[] = [];
    for (const [loc, main] of CORPUS.rows) {
      const want = Object.prototype.hasOwnProperty.call(CHANGED, loc) ? CHANGED[loc] : Object.prototype.hasOwnProperty.call(UNPLACED, loc) ? null : main;
      const got = detectCountry(loc);
      if (got !== want) drift.push(`${JSON.stringify(loc)}: ${main} at 8a65d88a, want ${want}, got ${got}`);
    }
    expect(drift).toEqual([]);
  });

  it("every CHANGED string is in the corpus and really did read otherwise at 8a65d88a", () => {
    const main = new Map(CORPUS.rows);
    for (const [loc, want] of Object.entries({ ...CHANGED, ...UNPLACED })) {
      expect(main.has(loc), loc).toBe(true);
      expect(main.get(loc), loc).not.toBe(want);
    }
  });

  it("the map version moved, so the backfill sweep re-reads the rows stored with no country", () => {
    // 11 for this fix; 12 since trust round 3 (US towns named after countries).
    expect(COUNTRY_MAP_VERSION).toBe(12);
  });
});

describe("a list visit re-reads stored pay when the country under it moves", () => {
  it("the BMS hourly rate reads CAD under CA and USD under US, so a country fix must re-parse it", () => {
    expect(parseSalaryStructured("$42.04 per hour", "CA", null)?.currency).toBe("CAD");
    expect(parseSalaryStructured("$42.04 per hour", "US", null)?.currency).toBe("USD");
  });

  it("payToReparse: a changed text is parsed as before; the same text under a moved country is parsed again; nothing else is", () => {
    // The pay text moved: the row's text, as the list visit always did.
    expect(payToReparse({ salary: "$50,000", country: undefined }, "$50,000", "$45,000")).toBe("$50,000");
    expect(payToReparse({ salary: null }, null, "$45,000")).toBeNull();
    // Only the country moved: the stored text (the Workday list carries none; the detail sweep wrote it).
    expect(payToReparse({ country: "US" }, null, "$42.04 per hour")).toBe("$42.04 per hour");
    expect(payToReparse({ country: "US" }, "$42.04 per hour", "$42.04 per hour")).toBe("$42.04 per hour");
    // The country moved on a row with no pay, or nothing moved: no parse.
    expect(payToReparse({ country: "US" }, null, null)).toBeUndefined();
    expect(payToReparse({}, "$42.04 per hour", "$42.04 per hour")).toBeUndefined();
  });

  it("the list upsert asks payToReparse, so the eight BMS rows stored as CAD are re-parsed when their country flips", () => {
    const src = readFileSync(resolve(__dirname, "../../supabase/functions/job-board/index.ts"), "utf8");
    expect(src).toMatch(/const reparse = payToReparse\(patch, row\.salary, prev\.salary\);\s*\n\s*if \(reparse !== undefined\) \{\s*\n\s*const rp = parseSalaryStructured\(\s*\n\s*reparse,/);
  });
});
