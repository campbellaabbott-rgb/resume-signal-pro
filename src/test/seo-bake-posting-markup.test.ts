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
import { describe, expect, it } from "vitest";
import {
  countryCodeOfName,
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

  it("keeps TELECOMMUTE for a remote row whose location names no place below its country", () => {
    for (const location of ["Remote - US", "United States (Remote)", "Remote", "", "USA", "Anywhere in the US"]) {
      const d = ld(row({ id: "greenhouse:acme:1", token: "acme", company: "Acme", country: "US", location }))!;
      expect(d, location).toBeTruthy();
      expect(d.jobLocationType, location).toBe("TELECOMMUTE");
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
  });
  it("leaves a row whose last segment is its own country, a state, or a US territory alone", () => {
    expect(postingCountryMismatch({ location: "Atlanta, Georgia", country: "US" })).toBe(false);
    expect(postingCountryMismatch({ location: "Paris, France", country: "FR" })).toBe(false);
    expect(postingCountryMismatch({ location: "Austin, TX, United States of America", country: "US" })).toBe(false);
    expect(postingCountryMismatch({ location: "San Juan, Puerto Rico", country: "US" })).toBe(false);
    expect(postingCountryMismatch({ location: "Lebanon", country: "US" }), "one segment is not enough to say").toBe(false);
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
