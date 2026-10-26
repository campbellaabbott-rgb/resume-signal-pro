/**
 * THE JOB MARKUP STATES A PLACE, A DATE AND A WORK MODE ONLY AS THE EMPLOYER
 * STATED THEM (SEO round, 2026-10-18).
 *
 * Every case below is a row the 2026-10-18 bake actually published:
 *   - SEO-003: four Dyson in-store sales jobs labelled "Germany - Bayern Remote"
 *     went out as TELECOMMUTE, and eleven pages put junk in addressLocality
 *     ("Bangalore ONLY)", "Utah | Hybrid", "FXE_APAC/VNM/VNHANHQ/Hanoi Rep
 *     Office", "Remote Worker France", "PARSIPPANY (NJPAR)", "Poland").
 *   - SEO-004: all 500 pages carried validThrough = posted + 30 exactly; an
 *     employer's own end date, when the board carries one, must shorten it.
 *   - SEO-016: 18 pages carried baseSalary against the owner's decision that
 *     the markup carries none; "Full time" with a space mapped to nothing.
 *   - SEO-035: a location ending in another country's name ("City, LA,
 *     Nigeria") is not a US job.
 *   - SEO-034: a Spanish description is not lang="en".
 *   - OBS-1: one UKG requisition under two career sites was two indexable
 *     pages with one title.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  countryCodeOfName,
  countryNameTable,
  isPostingLive,
  postingCountryMismatch,
  postingIdentity,
  postingJsonLd,
  postingLanguage,
  postingPageTitle,
  postingPostalAddress,
  postingRemoteBasis,
  postingRequisitionIdentity,
  postingValidThrough,
  type PostingRow,
} from "@/components/jobs/posting-page";

const SITE = "https://resumebooster.work";
const NOW = new Date("2026-10-18T12:00:00Z");
const DESC = "We are hiring for this role and you will work with our team on the work that matters to the people we serve. ".repeat(6);
const row = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: "workday:dyson~wd3~dyson_careers:JR36558",
  title: "Retail Sales Advisor",
  company: "Dyson",
  location: "Germany - Bayern Remote",
  country: "DE",
  workMode: "remote",
  remote: true,
  postedAt: "2026-10-10T00:00:00+00:00",
  missingSince: null,
  token: "dyson~wd3~dyson_careers",
  ...over,
});
const ld = (job: PostingRow) => postingJsonLd(job, DESC, { site: SITE, now: NOW });
/** The guard the bake applies to what it writes: a locality nobody would call a town. */
const JUNK_LOCALITY = /[/_()|]|\bonly\b|\b(?:remote|hybrid|on-?site)\b/i;

describe("SEO-003: a remote label that names a place is that place, never TELECOMMUTE", () => {
  it("marks the Dyson Bavaria store jobs up as a place in Bavaria", () => {
    const d = ld(row())!;
    expect(d, "the row produced no markup at all — every assertion below would pass vacuously").toBeTruthy();
    expect(d.jobLocationType).toBeUndefined();
    expect(d.applicantLocationRequirements).toBeUndefined();
    const address = (d.jobLocation as { address: Record<string, unknown> }).address;
    expect(address).toMatchObject({ addressCountry: "DE", addressRegion: "Bayern" });
    expect(address.addressLocality).toBeUndefined();
  });

  it("marks a remote row whose location names no place below its country up as that country, not TELECOMMUTE (no vendor flag)", () => {
    for (const location of ["Remote - US", "United States (Remote)", "Remote", "", "USA", "Anywhere in the US"]) {
      const d = ld(row({ id: "greenhouse:acme:1", token: "acme", company: "Acme", country: "US", location }))!;
      expect(d, location).toBeTruthy();
      expect(d.jobLocationType, location).toBeUndefined();
      expect((d.jobLocation as { address: Record<string, unknown> }).address, location).toEqual({ "@type": "PostalAddress", addressCountry: "US" });
      expect(postingRemoteBasis(row({ country: "US", location })), location).toBe("place-free");
    }
    // "Remote Worker France": the work-mode word and the country come out and nothing is left.
    expect(postingRemoteBasis(row({ country: "FR", location: "Remote Worker France" }))).toBe("place-free");
  });

  it("keeps TELECOMMUTE beside a named place only when the hiring system's own field said remote", () => {
    expect(postingRemoteBasis(row({ workModeSource: "vendor" }))).toBe("vendor");
    expect(ld(row({ workModeSource: "vendor" }))!.jobLocationType).toBe("TELECOMMUTE");
    // A town plus "Remote" with no vendor flag is the town.
    const chicago = ld(row({ id: "workday:motorolasolutions~wd5~Careers:R69578", token: "motorolasolutions~wd5~Careers", company: "Motorola Solutions", country: "US", location: "Chicago, IL" }))!;
    expect(chicago.jobLocationType).toBeUndefined();
    expect((chicago.jobLocation as { address: Record<string, unknown> }).address).toMatchObject({ addressLocality: "Chicago", addressRegion: "IL" });
  });

  it("never puts a site code, a bracketed note, a work mode, 'only', a country or the employer into the town slot", () => {
    const addr = (location: string, country: string, company = "Acme") =>
      postingPostalAddress(row({ location, country, company, workMode: null })) as Record<string, unknown>;
    const cases: Array<[string, string, string?]> = [
      ["Bangalore ONLY)", "IN"],
      ["Remote (Bangalore ONLY)", "IN"],
      ["FXE_APAC/VNM/VNHANHQ/Hanoi Rep Office", "VN", "FedEx"],
      ["FXE_APAC/VNM/VNSGNHQ/Headquarter", "VN", "FedEx"],
      ["Remote Worker France", "FR"],
      ["PARSIPPANY (NJPAR)", "US"],
      ["Houston (Corporate Office)", "US"],
      ["Ottawa (Kanata)", "CA"],
      ["Poland", "PL"],
      ["Utah | Hybrid", "US"],
      ["Germany - Bayern Remote", "DE"],
      ["Dyson Store Munich", "DE", "Dyson"],
    ];
    for (const [location, country, company] of cases) {
      const a = addr(location, country, company);
      const loc = a.addressLocality as string | undefined;
      expect(loc === undefined || !JUNK_LOCALITY.test(loc), `${location} -> ${loc}`).toBe(true);
      expect(loc === undefined || !countryCodeOfName(loc), `${location} -> ${loc}`).toBe(true);
      expect(loc === undefined || !loc.toLowerCase().includes(String(company ?? "acme").toLowerCase()), `${location} -> ${loc}`).toBe(true);
    }
    // A hyphenated region stays whole (the bake first gave "Pfalz" and "Württemberg").
    expect(addr("Germany - Rheinland-Pfalz Remote", "DE")).toEqual({ "@type": "PostalAddress", addressCountry: "DE", addressRegion: "Rheinland-Pfalz" });
    expect(addr("Germany - Baden-Württemberg Remote", "DE")).toEqual({ "@type": "PostalAddress", addressCountry: "DE", addressRegion: "Baden-Württemberg" });
    // A facility is not a town.
    expect(addr("China - Shenzhen Office", "CN").addressLocality).toBeUndefined();
    // What survives is the region and the country.
    expect(addr("Utah | Hybrid", "US")).toEqual({ "@type": "PostalAddress", addressCountry: "US", addressRegion: "UT" });
    expect(addr("Houston (Corporate Office)", "US")).toEqual({ "@type": "PostalAddress", addressCountry: "US" });
  });

  it("still reads the ordinary towns it always read", () => {
    const addr = (location: string, country: string) => postingPostalAddress(row({ location, country, workMode: null, company: "Acme" })) as Record<string, unknown>;
    expect(addr("Leeds", "GB")).toEqual({ "@type": "PostalAddress", addressCountry: "GB", addressLocality: "Leeds" });
    expect(addr("Germany - Munich", "DE")).toMatchObject({ addressLocality: "Munich" });
    expect(addr("USA - CO - Denver", "US")).toMatchObject({ addressLocality: "Denver", addressRegion: "CO" });
    expect(addr("New York City, New York (Madison Ave.)", "US")).toMatchObject({ addressLocality: "New York City" });
    expect(addr("Panama City, FL", "US")).toMatchObject({ addressLocality: "Panama City", addressRegion: "FL" });
  });
});

describe("SEO-004: the expiry never runs past the employer's own end date", () => {
  const base = row({ location: "Munich", workMode: null });
  it("is posted + 30 when the employer states no end", () => {
    expect(postingValidThrough(base)).toBe("2026-11-09");
  });
  it("is the employer's end date when that comes first", () => {
    expect(postingValidThrough({ ...base, employerValidThrough: "2026-10-25" })).toBe("2026-10-25");
    expect(ld({ ...base, employerValidThrough: "2026-10-25" })!.validThrough).toBe("2026-10-25T23:59:59+00:00");
    // A later employer date never lengthens the window.
    expect(postingValidThrough({ ...base, employerValidThrough: "2026-12-31" })).toBe("2026-11-09");
  });
  it("takes a posting whose employer end date has passed off the markup", () => {
    expect(isPostingLive({ ...base, employerValidThrough: "2026-10-17" }, NOW)).toBe(false);
    expect(ld({ ...base, employerValidThrough: "2026-10-17" })).toBeNull();
  });
});

describe("SEO-016: no pay in the markup, and a spaced employment type is read", () => {
  it("never emits baseSalary, whatever the row carries", () => {
    const d = ld(row({ location: "Munich", workMode: null, salary: "€50,000 - €60,000 a year", salaryMinAnnual: 50000, salaryMaxAnnual: 60000, salaryCurrency: "EUR", salaryPeriod: "year" }))!;
    expect(d).toBeTruthy();
    expect(d.baseSalary).toBeUndefined();
    expect(JSON.stringify(d)).not.toContain("baseSalary");
  });
  it("maps Workday's 'Full time' and 'Part time'", () => {
    expect(ld(row({ location: "Munich", workMode: null, employmentType: "Full time" }))!.employmentType).toBe("FULL_TIME");
    expect(ld(row({ location: "Munich", workMode: null, employmentType: "Part  time" }))!.employmentType).toBe("PART_TIME");
    expect(ld(row({ location: "Munich", workMode: null, employmentType: "seasonal-ish" }))!.employmentType).toBeUndefined();
  });
});

describe("SEO-035: a location that ends in another country's name is not the row's country", () => {
  it("withholds the markup for 'City, LA, Nigeria' and 'City, GA, Ghana' filed as US", () => {
    expect(postingCountryMismatch({ location: "Lagos, LA, Nigeria", country: "US" })).toBe(true);
    expect(postingCountryMismatch({ location: "Accra, GA, Ghana", country: "US" })).toBe(true);
    expect(ld(row({ location: "Lagos, LA, Nigeria", country: "US", workMode: null }))).toBeNull();
    // The bake may ask whether the country is the only thing in the way (a carried page then keeps
    // its page with no markup, D7); the answer is never emitted as markup.
    expect(postingJsonLd(row({ location: "Lagos, LA, Nigeria", country: "US", workMode: null }), DESC, { site: SITE, now: NOW, ignoreCountryMismatch: true })).toBeTruthy();
    const bake = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toMatch(/if \(!path \|\| \(!ld && !\(\(mismatchOnly \|\| nameOnly\) && carried\)\)\) \{/);
    expect(bake).toMatch(/jsonLd: \[\.\.\.\(ld \? \[ld\] : \[\]\), \{/);
  });
  it("leaves a row whose last segment is its own country, a state, or a US territory alone", () => {
    expect(postingCountryMismatch({ location: "Atlanta, Georgia", country: "US" })).toBe(false);
    expect(postingCountryMismatch({ location: "Paris, France", country: "FR" })).toBe(false);
    expect(postingCountryMismatch({ location: "Austin, TX, United States of America", country: "US" })).toBe(false);
    expect(postingCountryMismatch({ location: "San Juan, Puerto Rico", country: "US" })).toBe(false);
    expect(postingCountryMismatch({ location: "Lebanon", country: "US" }), "one segment is not enough to say").toBe(false);
  });

  // Intl names the withdrawn codes after the country that holds the current
  // code (Vietnam for VD as well as VN), and an A-Z walk met the withdrawn one
  // first, so a Vietnam row filed VN read as "another country" and lost its
  // markup (Unilever R-1189545, Ho Chi Minh City; every Zimbabwe row on the board).
  it("reads Vietnam, Zimbabwe, Vanuatu, Benin and Burkina Faso as the codes in use", () => {
    const cases: Array<[string, string]> = [
      ["Ho Chi Minh City, Vietnam", "VN"],
      ["Harare, Zimbabwe", "ZW"],
      ["Port Vila, Vanuatu", "VU"],
      ["Cotonou, Benin", "BJ"],
      ["Ouagadougou, Burkina Faso", "BF"],
    ];
    for (const [location, country] of cases) {
      const last = location.split(", ").pop()!;
      expect(countryCodeOfName(last), last).toBe(country);
      expect(postingCountryMismatch({ location, country }), location).toBe(false);
      expect(ld(row({ id: "greenhouse:acme:1", token: "acme", company: "Acme", location, country, workMode: null })), location).toBeTruthy();
    }
    // A Vietnam location on a row filed under another country is still another country.
    expect(postingCountryMismatch({ location: "Hanoi, Vietnam", country: "US" })).toBe(true);
  });

  // The 2026-10-25 recheck: the rule read the last segment as the country
  // whatever order the place was written in, so a US town that shares a
  // country's name lost its markup (101 Globalfoundries rows in Malta, New
  // York; every "MI - Holland" and "PA - Lebanon" row), and so did a list of
  // places that names the row's country before another one.
  it("leaves a town that shares a country's name alone when the place is written state first or country first", () => {
    const cases: Array<[string, string, string]> = [
      ["USA - New York - Malta", "US", "Globalfoundries"],
      ["United States, Ohio, Holland", "US", "Clarios"],
      ["United States, Michigan, Holland", "US", "Clarios"],
      ["MI - Holland", "US", "Millerknoll"],
      ["PA - Lebanon", "US", "CVS Health"],
      ["IN - Lebanon", "US", "PNC"],
      ["NY - Jamaica", "US", "CVS Health"],
      ["NY - Malta", "US", "CVS Health"],
      ["MS - Grenada", "US", "CVS Health"],
      ["ENTEK - Lebanon", "US", "ENTEK"],
      ["Costa Rica - Liberia", "CR", "Coke"],
    ];
    for (const [location, country, company] of cases) {
      expect(postingCountryMismatch({ location, country, company }), location).toBe(false);
      const d = ld(row({ id: "greenhouse:acme:1", token: "acme", company, location, country, workMode: null }));
      expect(d, location).toBeTruthy();
      expect((d!.jobLocation as { address: Record<string, unknown> }).address.addressCountry, location).toBe(country);
    }
    expect((ld(row({ id: "greenhouse:acme:1", token: "acme", company: "Globalfoundries", location: "USA - New York - Malta", country: "US", workMode: null }))!.jobLocation as { address: Record<string, unknown> }).address).toMatchObject({ addressCountry: "US", addressRegion: "NY" });
    // The employer's name opens only a place of two segments: after a town the country still counts.
    expect(postingCountryMismatch({ location: "ENTEK - Tokyo - Japan", country: "US", company: "ENTEK" })).toBe(true);
  });

  it("reads the row's own country, one of its states, or the country that governs it anywhere in the location", () => {
    const cases: Array<[string, string]> = [
      ["Hong Kong, China", "HK"],
      ["Kowloon, China", "HK"],
      ["Charlotte Amalie, Virgin Islands, U.S.", "VI"],
      ["Fort-de-France, Fort-de-France, Martinique", "FR"],
      ["Munich, Germany; London, United Kingdom; Paris, France; The Hague, Netherlands", "GB"],
      ["London, UK or Zurich, Switzerland", "GB"],
      ["Remote USA · Berlin, Germany · Raleigh, United States · London, United Kingdom", "US"],
      ["Remote • UK, France, Spain, Germany or Canada", "GB"],
      ["Toronto, Canada; Denver, Colorado", "US"],
      ["United States and Ontario, Canada", "US"],
      ["Central, Hong Kong; Chuo-ku, Japan", "HK"],
    ];
    for (const [location, country] of cases) {
      expect(postingCountryMismatch({ location, country }), location).toBe(false);
    }
  });

  it("still withholds a place written town first that ends in another country", () => {
    const cases: Array<[string, string]> = [
      ["Lagos, LA, Nigeria", "US"],
      ["Accra, GA, Ghana", "US"],
      ["New Brunswick - NJ - US", "CA"],
      ["Warsaw, Poland", "US"],
      ["Gent, Belgium", "US"],
      ["Kwajalein, Marshall Islands", "HK"],
      ["Malta International Airport, Malta", "US"],
      ["Edmonton, Canada", "US"],
      ["Ramstein, Germany", "US"],
      ["Tokyo - Japan", "US"],
      ["New York Mets Complex – Dominican Republic", "US"],
      ["Senai, Non United States Or Canada, Malaysia", "US"],
      ["9 Av Du Canada, 91940 Les Ulis, France", "CA"],
      ["Lagos, Nigeria; Accra, Ghana", "US"],
    ];
    for (const [location, country] of cases) {
      expect(postingCountryMismatch({ location, country }), location).toBe(true);
    }
  });


  it("maps every name in the table to a current ISO 3166-1 code, never one Intl files under another", () => {
    const table = countryNameTable();
    expect(table.size, "the table is empty — the loop below would pass vacuously").toBeGreaterThan(200);
    const offenders: string[] = [];
    for (const [name, code] of table) {
      if (!ISO_3166_1_CURRENT.has(code) && code !== "XK") offenders.push(`${name} -> ${code} (not a current ISO 3166-1 code)`);
      let canonical = code;
      try { canonical = Intl.getCanonicalLocales(`und-${code}`)[0].split("-")[1] ?? code; } catch { /* runtime without it */ }
      if (canonical !== code) offenders.push(`${name} -> ${code} (Intl files it under ${canonical})`);
    }
    expect(offenders).toEqual([]);
    // Every region name the runtime prints reads back to a current code too.
    const dn = new Intl.DisplayNames(["en"], { type: "region" });
    for (let a = 65; a < 91; a++) {
      for (let b = 65; b < 91; b++) {
        const code = String.fromCharCode(a, b);
        let name: string | undefined;
        try { name = dn.of(code); } catch { name = undefined; }
        if (!name || name === code) continue;
        const read = countryCodeOfName(name);
        if (read !== null) expect(ISO_3166_1_CURRENT.has(read) || read === "XK", `${code} ${name} -> ${read}`).toBe(true);
      }
    }
  });

  // A browser whose Intl does not canonicalise region subtags must still read
  // Vietnam as VN: the reader's own list of withdrawn codes carries it then.
  it("reads the codes in use on a runtime that files no region under another", async () => {
    vi.resetModules();
    const spy = vi.spyOn(Intl, "getCanonicalLocales").mockImplementation((l) => (Array.isArray(l) ? l.map(String) : [String(l)]));
    try {
      const fresh = await import("@/components/jobs/posting-page");
      expect(Intl.getCanonicalLocales("und-VD"), "the stub must leave VD as VD").toEqual(["und-VD"]);
      for (const [name, code] of [["Vietnam", "VN"], ["Zimbabwe", "ZW"], ["Vanuatu", "VU"], ["Benin", "BJ"], ["Burkina Faso", "BF"], ["Serbia", "RS"], ["Curaçao", "CW"], ["Myanmar (Burma)", "MM"], ["United Kingdom", "GB"]] as const) {
        expect(fresh.countryCodeOfName(name), name).toBe(code);
      }
      const offenders = [...fresh.countryNameTable()].filter(([, code]) => !ISO_3166_1_CURRENT.has(code) && code !== "XK").map(([n, c]) => `${n} -> ${c}`);
      expect(offenders).toEqual([]);
    } finally {
      spy.mockRestore();
      vi.resetModules();
    }
  });
});

/**
 * SEO-035 MEASURED ON THE LIVE BOARD (2026-10-25). A reviewer's examples are a
 * sample, so the rule is held to a corpus read from the board itself: every
 * location string the rule at d1d5aa12 or now withholds, every string that
 * names another country and is withheld by neither, and every recheck input,
 * each labelled by hand (src/test/fixtures/posting-country-corpus-2026-10-25.json).
 * Main publishes markup for every row, so withholding a correct row is worse
 * than main and withholding a misfiled one is better.
 */
describe("SEO-035 against a corpus of live rows", () => {
  type Case = { location: string; country: string; company: string | null; rows: number; label: "correct" | "mismatch" | "unclear"; src: string; before: boolean; note?: string };
  const corpus = JSON.parse(readFileSync(resolve(__dirname, "fixtures/posting-country-corpus-2026-10-25.json"), "utf8")) as { cases: Case[] };
  const key = (c: Case) => `${c.location} | ${c.country}`;
  const now = (c: Case) => postingCountryMismatch({ location: c.location, country: c.country, company: c.company });

  it("holds at least 300 labelled cases, read from the live board, with the recheck's inputs", () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(300);
    expect(corpus.cases.filter((c) => c.label === "correct").length).toBeGreaterThan(300);
    expect(corpus.cases.filter((c) => c.label === "mismatch").length).toBeGreaterThan(50);
    expect(corpus.cases.filter((c) => c.src === "recheck").length).toBeGreaterThanOrEqual(8);
    expect(new Set(corpus.cases.map(key)).size, "a case is listed twice").toBe(corpus.cases.length);
  });

  it("withholds no correct row but the three a list of towns would be needed to tell from a misfiled one", () => {
    const worseThanMain = corpus.cases.filter((c) => c.label === "correct" && now(c)).map(key);
    expect(worseThanMain).toEqual([
      "Biloxi, MS, Algeria | US",
      "Hyderabad, Telangana, Algeria | IN",
      "UMMC Family Clinic - Grenada | US",
    ]);
    // The rule at d1d5aa12 withheld far more of them.
    expect(corpus.cases.filter((c) => c.label === "correct" && c.before).length).toBeGreaterThan(80);
  });

  it("still withholds every misfiled row it withheld before but one, and withholds no new kind", () => {
    const lost = corpus.cases.filter((c) => c.label === "mismatch" && c.before && !now(c)).map(key);
    expect(lost).toEqual(["Auckland, Australia & New Zealand, New Zealand | AU"]);
    const gained = corpus.cases.filter((c) => !c.before && now(c)).map(key);
    expect(gained).toEqual([]);
    const caught = corpus.cases.filter((c) => c.label === "mismatch" && now(c));
    expect(caught.length).toBeGreaterThanOrEqual(70);
  });
});

/** ISO 3166-1 alpha-2, the 249 codes assigned today (Kosovo's XK is user-assigned and checked apart). */
const ISO_3166_1_CURRENT = new Set((
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ " +
  "CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR " +
  "GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP " +
  "KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT " +
  "MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW " +
  "SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ " +
  "UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" "));

describe("the ISO 3166-1 list the table is checked against", () => {
  it("holds the 249 assigned codes and none of the withdrawn ones", () => {
    expect(ISO_3166_1_CURRENT.size).toBe(249);
    for (const old of ["AN", "BU", "CS", "DD", "DY", "FX", "HV", "NH", "RH", "SU", "TP", "UK", "VD", "YD", "YU", "ZR"]) {
      expect(ISO_3166_1_CURRENT.has(old), old).toBe(false);
    }
  });
});

describe("SEO-034: the page says which language the employer wrote in", () => {
  it("reads a Spanish description as Spanish and an English one as English", () => {
    const es = "Buscamos una persona para el equipo de ventas con experiencia en la atención al cliente. Las funciones del puesto son para trabajar con los clientes y por la mañana. ".repeat(5);
    expect(postingLanguage(es)).toBe("es");
    expect(postingLanguage(DESC)).toBe("en");
  });
  it("answers nothing for a short or mixed text rather than guess", () => {
    expect(postingLanguage("Short text.")).toBeNull();
    // A bilingual posting (an English half, a French half) is judged on all of it, and is neither.
    const fr = "Vous rejoindrez une équipe pour les clients et nous offrons des avantages dans un environnement sur mesure avec votre équipe. ".repeat(6);
    expect(postingLanguage(DESC + fr)).toBeNull();
    expect(postingLanguage(fr)).toBe("fr");
  });
});

describe("OBS-1: one requisition under two career sites is one posting", () => {
  const a = row({ id: "ukg:recruiting~ONE1006ONEAL~48993e46-6446-4916-acc8-4f68e04dd764:68926f4c-a068-4998-81c6-0b152c34ced4", token: "recruiting~ONE1006ONEAL~48993e46-6446-4916-acc8-4f68e04dd764", company: "O'Neal Manufacturing Services", title: "Quality  (QA) Technician - Manufacturing", location: "Cedar Falls, IA", country: "US", workMode: null });
  const b = row({ id: "ukg:recruiting~ONE1006ONEAL~7ffaba33-6238-4f0d-90b3-8215b183667d:68926f4c-a068-4998-81c6-0b152c34ced4", token: "recruiting~ONE1006ONEAL~7ffaba33-6238-4f0d-90b3-8215b183667d", company: "O'Neal Industries", title: "Quality (QA) Technician - Manufacturing", location: "Cedar Falls, IA", country: "US", workMode: null });
  it("shares a requisition identity although the printed company names differ", () => {
    expect(postingIdentity(a)).not.toBe(postingIdentity(b));
    expect(postingRequisitionIdentity(a)).toBe(postingRequisitionIdentity(b));
    // Two tenants never share one.
    expect(postingRequisitionIdentity({ id: "workday:acme~wd5~Careers:R1" })).not.toBe(postingRequisitionIdentity({ id: "workday:other~wd5~Careers:R1" }));
    // Two Workday sites of one tenant do.
    expect(postingRequisitionIdentity({ id: "workday:pwc~wd3~Global:R1" })).toBe(postingRequisitionIdentity({ id: "workday:pwc~wd3~Campus:R1" }));
  });
  it("collapses the employer's double space in the title and the markup", () => {
    expect(postingPageTitle(a)).not.toContain("  ");
    expect(ld(a)!.title).toBe("Quality (QA) Technician - Manufacturing");
  });
});
