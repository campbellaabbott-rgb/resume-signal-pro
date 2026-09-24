import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BOARD_FRESH_WINDOW_DAYS,
  isPostingLive,
  postingJsonLd,
  postingPageDescription,
  postingPageTitle,
  postingValidThrough,
  type PostingRow,
} from "@/components/jobs/posting-page";

/**
 * A POSTING PAGE MAY STATE ONLY WHAT THE EMPLOYER STATED, AND MAY NOT BE
 * PUBLISHED AT ALL FOR A POSTING THAT IS GONE.
 *
 * WHY THIS IS THE WHOLE FEATURE AND NOT A DETAIL. Structured data is read by
 * machines that cannot tell a measurement from a guess. Google's reference
 * requires the job title, the description, the posted date and the hiring
 * organisation; requires a location unless applicant location requirements are
 * given, and requires the location to carry its own country; requires an expiry
 * date for a posting that has one; says expired postings are not allowed and
 * that one sanctioned way to withdraw a posting is to take its markup off the
 * page; and says pay is the employer's own figure and not an estimate. Emitting
 * a partial or a padded entity is worse than emitting none, because none is
 * merely absent while a padded one is a claim.
 *
 * THE TWO SHAPES THIS REPOSITORY KEEPS PRODUCING, both guarded here:
 *   - a figure derived by us and published under a noun that reads as the
 *     employer's. The board hands us an ANNUALISED pay figure; an hourly wage
 *     multiplied by a working-year and printed as a yearly salary would be our
 *     arithmetic wearing the employer's name, so pay is emitted only where the
 *     employer stated the period as a year.
 *   - a true sentence that went false when the thing it described moved to
 *     another runtime. The number of days a dated posting is served is declared
 *     in a Deno edge function this bundle cannot import; the expiry date on
 *     every posting page is computed from a copy of it. The copy is checked
 *     against the original here, by reading that file, because nothing else
 *     can see across that boundary.
 */

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";

/** A posting with every required field, so each case below can remove exactly one. */
const complete = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: "workday:acme~wd3~Careers:JR1",
  title: "Staff Nurse",
  company: "Acme Health",
  location: "Leeds",
  country: "GB",
  workMode: null,
  postedAt: "2026-09-20T00:00:00+00:00",
  missingSince: null,
  applyUrl: "https://acme.example/jobs/JR1",
  token: "acme~wd3~Careers",
  ...over,
});
const DESC = "A".repeat(400);
const NOW = new Date("2026-09-23T12:00:00Z");
const ld = (job: PostingRow, desc: string | null = DESC) =>
  postingJsonLd(job, desc, { site: SITE, now: NOW });

describe("the job markup carries every required property or is not emitted", () => {
  it("emits a complete entity for a posting that has everything", () => {
    const d = ld(complete())!;
    expect(d, "a complete posting produced no markup — every case below would then pass vacuously").toBeTruthy();
    for (const key of ["title", "description", "datePosted", "validThrough", "hiringOrganization", "jobLocation", "url"]) {
      expect(d[key], `complete posting is missing ${key}`).toBeTruthy();
    }
    expect((d.jobLocation as any).address.addressCountry).toBe("GB");
  });

  it("emits nothing when any single required field is missing", () => {
    const missing: Record<string, Partial<PostingRow>> = {
      "job title": { title: null },
      "hiring organisation": { company: null },
      "posted date": { postedAt: null },
      "the country of the place": { country: null },
      "the place": { location: null },
    };
    for (const [what, over] of Object.entries(missing)) {
      expect(ld(complete(over)), `markup was emitted with no ${what}`).toBeNull();
    }
    expect(ld(complete(), null), "markup was emitted with no description").toBeNull();
    expect(ld(complete(), "too short"), "markup was emitted on a stub description").toBeNull();
  });

  it("emits nothing for a posting the employer's feed stopped serving", () => {
    // Not a softer signal, not a flag on the entity: no entity. A retracted
    // posting whose markup is still on the page is an expired posting served
    // as live, which the reference does not allow.
    expect(ld(complete({ missingSince: "2026-09-22T00:00:00+00:00" }))).toBeNull();
    expect(isPostingLive(complete({ missingSince: "2026-09-22T00:00:00+00:00" }), NOW)).toBe(false);
  });

  it("emits nothing for a posting the board's own window has closed on", () => {
    const stale = complete({ postedAt: "2026-07-01T00:00:00+00:00" });
    expect(isPostingLive(stale, NOW)).toBe(false);
    expect(ld(stale)).toBeNull();
  });

  it("dates the expiry by whichever of the two rules ends the posting first", () => {
    // The window alone.
    expect(postingValidThrough(complete())).toBe("2026-10-20");
    // Gone from the employer's feed before the window closed: that day wins.
    expect(postingValidThrough(complete({ missingSince: "2026-09-25T09:00:00+00:00" }))).toBe("2026-09-25");
    // Gone after the window would have closed anyway: the window still wins,
    // so the date can never be pushed OUT by a late stamp.
    expect(postingValidThrough(complete({ missingSince: "2026-12-01T00:00:00+00:00" }))).toBe("2026-10-20");
  });

  it("never dates a posting in the future, however the vendor stamped it", () => {
    // A date-only stamp parses as a future UTC midnight west of Greenwich, and
    // a future posted date is rejected outright.
    const d = ld(complete({ postedAt: "2026-09-24T00:00:00+00:00" }))!;
    expect(d.datePosted).toBe("2026-09-23");
    // The expiry is still measured from the employer's RAW date, so clamping
    // the one cannot silently extend the other.
    expect(d.validThrough).toBe("2026-10-24T23:59:59+00:00");
  });

  it("expires the posting at the END of its last day, not the start of it", () => {
    // A DATE WITH NO TIME IS READ AS MIDNIGHT AT THE BEGINNING OF THAT DAY. So
    // a page served on the last day of the board's window shipped markup
    // claiming the posting was live and an expiry saying it had already gone —
    // the file contradicting itself, on the one day the contradiction is
    // guaranteed to happen. The helper still answers with a calendar day,
    // because that is what the board's rule is stated in; the markup spells
    // the instant it means.
    const lastDay = complete({ postedAt: "2026-08-24T00:00:00+00:00" });
    expect(postingValidThrough(lastDay), "the window closes on the day this test runs against").toBe("2026-09-23");
    expect(isPostingLive(lastDay, NOW), "still served on the last day").toBe(true);
    expect(ld(lastDay)!.validThrough).toBe("2026-09-23T23:59:59+00:00");
    // And the day after is gone, with no markup at all.
    expect(isPostingLive(complete({ postedAt: "2026-08-23T00:00:00+00:00" }), NOW)).toBe(false);
  });
});

describe("nothing optional is guessed", () => {
  it("omits pay entirely when the employer stated none", () => {
    expect(ld(complete())!.baseSalary).toBeUndefined();
  });

  it("omits pay when the employer stated no period, so our annualisation stays ours", () => {
    // Both of these carry a number and a currency. Neither carries an employer
    // statement of the period, so the annual figure is our arithmetic.
    expect(ld(complete({ salaryMinAnnual: 62000, salaryCurrency: "GBP", salaryPeriod: null }))!.baseSalary).toBeUndefined();
    expect(ld(complete({ salaryMinAnnual: 62400, salaryCurrency: "GBP", salaryPeriod: "hour" }))!.baseSalary).toBeUndefined();
  });

  it("states pay only where the employer stated the figure and the year it is for", () => {
    const d = ld(complete({ salaryMinAnnual: 62000, salaryMaxAnnual: 71000, salaryCurrency: "GBP", salaryPeriod: "year" }))!;
    expect(d.baseSalary).toEqual({
      "@type": "MonetaryAmount",
      currency: "GBP",
      value: { "@type": "QuantitativeValue", minValue: 62000, maxValue: 71000, unitText: "YEAR" },
    });
  });

  it("publishes the whole description, because that is what the property is for", () => {
    // IT WAS CUT AT 4,000 CHARACTERS, on 300 of the 399 pages in the last bake
    // (75.2%), while the visible page under it rendered a median 7,273 and a
    // maximum 14,106 — cut mid-word, e.g. "…ment or Project Management\nAbility
    // to ob". Google's reference asks for "a complete representation of the
    // job, including job responsibilities, qualifications, skills, working
    // hours, education requirements, and experience requirements", and those
    // sit at the END of a job description, so the cut removed exactly what it
    // names. It also made the markup disagree with the page, which is what the
    // general guidelines call out. There is no documented 4,000 limit, and the
    // board already caps what it stores.
    const long = "Responsibilities. ".repeat(600) + "Qualifications: a registered nursing qualification.";
    const d = ld(complete(), long)!;
    expect((d.description as string).length).toBe(long.length);
    expect(d.description, "the tail Google names by name was cut off").toContain("registered nursing qualification");
  });

  it("decodes the employer's entities, which is why the bake has to escape what it writes", () => {
    // decodeJdEntities deliberately turns &lt; back into <, so an ordinary
    // engineering JD mentioning a closing script tag arrives in the markup as
    // real angle brackets. Nothing here may stop doing that — the visible page
    // needs the decoded text — so the escaping belongs at the point the JSON is
    // written into the element, and the generator is asserted to do it in
    // the-sitemap-never-advertises-a-posting-url-with-no-page.test.ts.
    const jd = "We use templating. Close the block with &lt;/script&gt; and redeploy. ".repeat(4);
    const d = ld(complete(), jd)!;
    expect(d.description).toContain("</script>");
    // Which is exactly why a bare JSON.stringify into a script element is not
    // safe: the serialised form carries the literal sequence.
    expect(JSON.stringify(d)).toContain("</script>");
  });

  it("never writes a zero or a placeholder in place of an absent figure", () => {
    const d = ld(complete({ salary: null, salaryMinAnnual: null, salaryMaxAnnual: null }))!;
    expect(JSON.stringify(d)).not.toMatch(/"(minValue|maxValue)":\s*0/);
    expect(JSON.stringify(d)).not.toMatch(/null/);
  });

  it("uses the schema's own employment types and drops anything outside them", () => {
    expect(ld(complete({ employmentType: "full_time" }))!.employmentType).toBe("FULL_TIME");
    expect(ld(complete({ employmentType: "contract" }))!.employmentType).toBe("CONTRACTOR");
    // A value we do not recognise is not translated into a plausible one.
    expect(ld(complete({ employmentType: "seasonal-ish" }))!.employmentType).toBeUndefined();
    expect(ld(complete({ employmentType: null }))!.employmentType).toBeUndefined();
  });

  it("marks a posting as worked-from-anywhere only when the board says it is fully remote", () => {
    const remote = ld(complete({ workMode: "remote", location: null }))!;
    expect(remote.jobLocationType).toBe("TELECOMMUTE");
    expect(remote.applicantLocationRequirements).toEqual({ "@type": "Country", name: "GB" });
    // Hybrid is not remote, and an on-site posting claims nothing about remote.
    expect(ld(complete({ workMode: "hybrid" }))!.jobLocationType).toBeUndefined();
    expect(ld(complete())!.jobLocationType).toBeUndefined();
    // A fully remote posting with no country has no applicant requirement to
    // state and no place to state, so it gets no markup rather than a guess.
    expect(ld(complete({ workMode: "remote", location: null, country: null }))).toBeNull();
  });

  it("never gives a remote posting a physical place whose city is the word Remote", () => {
    // IT USED TO EMIT ALL THREE AND LET THEM CONTRADICT EACH OTHER. Two of the
    // five remote pages in the last bake shipped jobLocationType TELECOMMUTE,
    // an applicant-country requirement, AND a Place whose addressLocality read
    // "Remote, Arizona, United States of America". That is neither a place nor
    // a telecommute signal. A remote posting keeps a place only where the
    // string genuinely decomposes to a town.
    const arizona = ld(complete({ workMode: "remote", country: "US", location: "Remote, Arizona, United States of America" }))!;
    expect(arizona.jobLocationType).toBe("TELECOMMUTE");
    expect(arizona.jobLocation, "a remote posting was given a place called Remote").toBeUndefined();
    // A remote posting whose location IS a town keeps it, because that is a
    // fact about the job and not a placeholder.
    const munich = ld(complete({ workMode: "remote", country: "DE", location: "Munich, Germany" }))!;
    expect((munich.jobLocation as { address: Record<string, unknown> }).address.addressLocality).toBe("Munich");
  });
});

describe("the place is emitted as postal properties, not as one string in the city slot", () => {
  const address = (location: string | null, country = "US") =>
    (ld(complete({ location, country }))!.jobLocation as { address: Record<string, unknown> }).address;

  it("splits a street address into street, town, state and postcode", () => {
    // 211 of the 399 pages in the last bake (52.9%) put something that is not
    // a locality into addressLocality — street addresses, ZIP+4s, facility
    // names. Google reads that property as the city, so those postings either
    // failed location matching or matched the wrong place, and the markup was
    // untrue by this module's own standard: the property says locality and the
    // value was a street. All four strings below are verbatim from that bake.
    expect(address("1144 State Route 303, Streetsboro, OH 44241-5266")).toEqual({
      "@type": "PostalAddress",
      addressCountry: "US",
      addressRegion: "OH",
      addressLocality: "Streetsboro",
      streetAddress: "1144 State Route 303",
      postalCode: "44241-5266",
    });
    expect(address("5100 Kings Plaza, Ste 2201, Brooklyn,NY 11234-5208")).toMatchObject({
      addressLocality: "Brooklyn",
      addressRegion: "NY",
      postalCode: "11234-5208",
      streetAddress: "5100 Kings Plaza, Ste 2201",
    });
    expect(address("Atrium Health Wake Forest Baptist - Medical Center Blvd, Winston Salem, NC")).toMatchObject({
      addressLocality: "Winston Salem",
      addressRegion: "NC",
    });
  });

  it("reads Workday's dash-delimited form in BOTH orders, because it writes both", () => {
    // Live strings from the same bake: country-state-town and country-town-state.
    expect(address("USA - CO - Denver")).toMatchObject({ addressLocality: "Denver", addressRegion: "CO" });
    expect(address("US - Boston - MA")).toMatchObject({ addressLocality: "Boston", addressRegion: "MA" });
    expect(address("United States-Florida-Melbourne")).toMatchObject({ addressLocality: "Melbourne", addressRegion: "FL" });
    // Two parts and no subdivision to anchor on: the leading token is the
    // country in every form observed, so the trailing one is the town.
    expect(address("Spain - Barcelona", "ES")).toMatchObject({ addressLocality: "Barcelona" });
    expect(address("Germany - Munich", "DE")).toMatchObject({ addressLocality: "Munich" });
  });

  it("does not turn a work-mode word plus a country into a town", () => {
    // "Remote - Poland" names a country to work remotely from, not a town in
    // it, and a live remote posting whose whole location string was "US"
    // shipped addressLocality "US". A country is not a city and neither is a
    // work mode.
    expect(address("Remote - Poland", "PL").addressLocality).toBeUndefined();
    expect(address("US").addressLocality).toBeUndefined();
    expect(address("USA").addressLocality).toBeUndefined();
    expect(address("Remote - US").addressLocality).toBeUndefined();
  });

  it("leaves the locality OUT rather than filling it with a street or a hospital", () => {
    // The rule the rest of this module follows: an absent fact is said to be
    // absent. Nine pages in the last bake carried this facility name with no
    // town in it at all.
    const facility = address("Aurora St Lukes Medical Center - 2900 W Oklahoma Ave");
    expect(facility.addressLocality).toBeUndefined();
    expect(facility.addressCountry).toBe("US");
    // A placeholder count is not a place either.
    expect(address("52 Locations").addressLocality).toBeUndefined();
    // And the word "Remote" is not a town, even beside a real state.
    const remoteish = address("Remote, Arizona, United States of America");
    expect(remoteish.addressLocality).toBeUndefined();
    expect(remoteish.addressRegion).toBe("AZ");
  });

  it("keeps a plain town, in any country, exactly as the employer wrote it", () => {
    expect(address("Leeds", "GB")).toEqual({ "@type": "PostalAddress", addressCountry: "GB", addressLocality: "Leeds" });
    expect(address("Bangalore, India", "IN")).toMatchObject({ addressLocality: "Bangalore" });
    expect(address("New York City, New York (Madison Ave.)")).toMatchObject({ addressLocality: "New York City" });
    expect(address("Toronto, ON", "CA")).toMatchObject({ addressLocality: "Toronto", addressRegion: "ON" });
  });
});

describe("no two posting pages may ship the same title", () => {
  /**
   * THE PARITY GUARD CATCHES THIS ONLY AFTER A BUILD, WHICH IS TOO LATE.
   * sitemap-prerender-parity.test.ts failed on the built tree with 15 posting
   * URLs across 6 titles: five Target stores all reading "Guest Advocate
   * (Cashier), General Merchandise, Inbound (Stoc…" while their own markup
   * gave addresses in Long Beach CA and Auburn AL, and two Fresenius nursing
   * roles in Newark NJ and Tulsa OK sharing "Outpatient Licensed Practical
   * Nurse - LPN LVN". Search Console calls that "Duplicate without
   * user-selected canonical". The title builder used to drop the place first
   * to fit the budget, so for long ATS titles it erased the only
   * distinguishing token. These cases are the real rows, unbuilt.
   */
  const target = (store: string, key: string): PostingRow => complete({
    id: `workday:target~wd5~targetcareers:${key}`,
    title: "Guest Advocate (Cashier), General Merchandise, Inbound (Stocking) (T3225)",
    company: "Target",
    location: store,
    country: "US",
  });

  it("gives two postings that differ only by place two different titles", () => {
    const a = postingPageTitle(target("5760 E 7TH ST, Long Beach,CA 90803-2002", "R0000474088"));
    const b = postingPageTitle(target("129 N College St, Auburn,AL 36830-4705", "R0000474848"));
    expect(a).not.toBe(b);
    const nurseA = postingPageTitle(complete({
      id: "workday:freseniusmedicalcare~wd3~fme:R0265585",
      title: "Outpatient Licensed Practical Nurse - LPN LVN",
      company: "Fresenius Medical Care",
      location: "Newark, NJ",
    }));
    const nurseB = postingPageTitle(complete({
      id: "workday:freseniusmedicalcare~wd3~fme:R0270604",
      title: "Outpatient Licensed Practical Nurse - LPN LVN",
      company: "Fresenius Medical Care",
      location: "Tulsa, OK",
    }));
    expect(nurseA).not.toBe(nurseB);
  });

  it("keeps every title distinct across a set of rows sharing an employer and a job", () => {
    // The set-level property, which is what the sitemap needs. One page per
    // posting identity is guaranteed upstream, so two pages always differ by
    // company, title or place — and a title must differ whenever they do.
    const stores = [
      "5760 E 7TH ST, Long Beach,CA 90803-2002",
      "129 N College St, Auburn,AL 36830-4705",
      "1144 State Route 303, Streetsboro, OH 44241-5266",
      "5100 Kings Plaza, Ste 2201, Brooklyn,NY 11234-5208",
      "Aurora St Lukes Medical Center - 2900 W Oklahoma Ave",
    ];
    const titles = stores.map((s, i) => postingPageTitle(target(s, `R00004740${i}`)));
    expect(new Set(titles).size, `collided: ${JSON.stringify(titles)}`).toBe(stores.length);
  });

  it("falls back to the requisition key when no place survives the budget", () => {
    // A posting with no place at all still has to be distinguishable from the
    // next one, and the third segment of a board id is unique per URL.
    const noPlace = (key: string) => postingPageTitle(complete({
      id: `workday:acme~wd3~Careers:${key}`,
      title: "Senior Principal Clinical Research Associate, Oncology Therapeutic Area",
      company: "National Federation of Independent Business",
      location: null,
    }));
    expect(noPlace("JR1")).not.toBe(noPlace("JR2"));
    expect(noPlace("JR1")).toContain("JR1");
  });
});

describe("the head copy fits the space a search result gives it", () => {
  it("keeps the title inside the budget and the job recognisable in it", () => {
    const long = complete({
      title: "Senior Principal Clinical Research Associate, Oncology Therapeutic Area",
      company: "National Federation of Independent Business",
      location: "Greater Manchester",
    });
    const title = postingPageTitle(long);
    expect(title.length).toBeLessThanOrEqual(68);
    expect(title).toContain("Senior Principal Clinical Research Associate");
  });

  it("keeps the employer and the place whole whenever the whole job title fits", () => {
    // The readable half of the rule: nothing is cut while nothing needs to be.
    expect(postingPageTitle(complete())).toBe("Staff Nurse — Acme Health, Leeds");
    // The employer is the first thing dropped, because the place is what
    // distinguishes two postings of the same job at the same employer.
    const wideCompany = complete({ company: "The Church of Jesus Christ of Latter-day Saints", location: "Salt Lake City, Utah" });
    expect(postingPageTitle(wideCompany)).toBe("Staff Nurse — Salt Lake City, Utah");
  });

  it("never hands the bake a description the snippet clamp would cut", () => {
    // The clamp cuts at a word boundary and appends an ellipsis. Written as one
    // long sentence, 189 of 397 posting pages shipped a snippet trailing off
    // mid-clause; the description is built up to the budget instead.
    const cases = [
      complete(),
      complete({ salary: "£62,000 - £71,000 per annum plus a 12% pension contribution and private medical cover" }),
      complete({
        title: "Senior Principal Clinical Research Associate, Oncology Therapeutic Area",
        company: "The Church of Jesus Christ of Latter-day Saints",
        location: "Salt Lake City, Utah, United States",
        salary: "$146,897 - $169,387",
      }),
    ];
    for (const c of cases) {
      const d = postingPageDescription(c);
      expect(d.length, `over budget: ${d}`).toBeLessThanOrEqual(160);
      expect(d.endsWith("…"), `already truncated at the source: ${d}`).toBe(false);
      expect(d).toContain(c.title!);
    }
  });

  it("measures the budget on the bytes the file carries, not the ones we hold", () => {
    // THE BAKE ESCAPES THIS INTO AN HTML ATTRIBUTE. An employer name with an
    // `&` or a `"` in it is longer in the served file than in memory, so a
    // description built to exactly 160 characters shipped at 161 — one page in
    // the last bake did. The budget is the served length.
    const escaped = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").length;
    const ampersands = complete({
      company: 'Procter & Gamble & Partners & Co & "The Group"',
      title: "Senior Manufacturing & Quality Assurance Technician",
      location: "Cincinnati, Ohio & Northern Kentucky",
      salary: '$62,000 - $71,000 & a "retention" bonus',
    });
    expect(escaped(postingPageDescription(ampersands))).toBeLessThanOrEqual(160);
    // And nothing is lost on a plain description: the escape only bites where
    // there is something to escape.
    expect(postingPageDescription(complete())).toContain("Acme Health");
  });

  it("puts the employer's pay in the snippet in their own words, or not at all", () => {
    expect(postingPageDescription(complete({ salary: "£30 an hour" }))).toContain("£30 an hour");
    expect(postingPageDescription(complete())).not.toMatch(/pay/i);
  });
});

describe("the serving window on a posting page is the board's own, not a copy that drifted", () => {
  /**
   * THE CROSS-RUNTIME CHECK. The constant lives in a Deno edge function; the
   * expiry date on every posting page is computed from the mirror in
   * src/components/jobs/posting-page.ts. Neither tsc, vitest nor the deno gate
   * can see across that boundary, so this reads the other runtime's source.
   */
  const BOARD_SRC = resolve(ROOT, "supabase/functions/job-board/index.ts");

  it("finds the board's own declaration to compare against", () => {
    const src = readFileSync(BOARD_SRC, "utf8");
    expect(src.length, "could not read the board function").toBeGreaterThan(1000);
  });

  it("mirrors the number of days the board actually serves a dated posting for", () => {
    // MATCHED AS A DECLARATION, NOT AS A SPELLING. The board file explains this
    // constant in prose right beside it, so a bare search for the name would be
    // satisfied by the explanation. Anchoring to the head of a declaration line
    // excludes every comment line without needing a stripper at all.
    //
    // THE FIGURE THAT USED TO BE HERE WAS WRONG BY THREE ORDERS OF MAGNITUDE,
    // and the wrong number taught the wrong lesson. It said the shared stripper
    // "removes about 155KB of real code" from this file. What codeOf mis-read
    // was one 16,390-character region — a line comment in index.ts names a
    // path whose wildcard follows a slash, which the block-first pass treated
    // as a comment opener and ran to the next terminator — and all but about
    // 200 characters of that region is genuine comment prose. The real loss
    // was FOUR declaration lines: SITEMAP_DAYS, BUILD_VERSION,
    // NAME_SYNC_VERSION and this one. Small, and fatal to any guard that needs
    // one of the four.
    //
    // THE STRIPPER IS FIXED NOW, which is where that belonged: codeOf is a
    // single left-to-right, string- and regex-aware scan, so neither the
    // ordering trap nor the braced-comment backtrack it also had can arise,
    // and src/test/a-stripper-that-loses-real-code-passes-every-guard-that-
    // reads-it.test.ts holds it to that. The intermediate repair — pointing
    // the guards that need index.ts at helpers/catalog's stripTsComments
    // instead — was withdrawn: that scanner has no regex-literal awareness, so
    // it desynchronises on this same file and leaves comment prose standing in
    // what it calls code, which is the same blindness from the other side.
    //
    // The raw read below is kept because a declaration anchor needs no
    // stripper at all, not because none works.
    const src = readFileSync(BOARD_SRC, "utf8");
    const m = /^\s*(?:export\s+)?const\s+FRESH_WINDOW_DAYS\s*=\s*(\d+)\s*;/m.exec(src);
    expect(m, "the board no longer declares its serving window under that name — find it and re-point this guard").toBeTruthy();
    expect(
      Number(m![1]),
      `the board serves a dated posting for ${m![1]} days; every posting page publishes an expiry ` +
        `${BOARD_FRESH_WINDOW_DAYS} days after the employer's date. One of the two is now a lie to a crawler.`,
    ).toBe(BOARD_FRESH_WINDOW_DAYS);
  });
});
