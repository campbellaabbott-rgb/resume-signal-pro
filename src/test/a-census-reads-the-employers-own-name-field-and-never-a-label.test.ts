// @vitest-environment node
/**
 * THE CENSUS TOOLS WROTE NAMES NO EMPLOYER USES (trusted-pages round,
 * 2026-10-25), and each came from a field that was not the employer's name:
 *
 *   - UKG: the most frequent image alt text on the board page, which is the
 *     brand asset's admin label. "Axia Logo Horizontal" and "US - LLC
 *     Recruiting" went into the catalogue while the same page embeds the
 *     board's own Name ("Axia Women's Health", "Convergint Career
 *     Opportunities") and a footer link to the employer's domain.
 *   - Oracle: SiteName of active sites only, so Honeywell's aerospace tenant,
 *     whose one live site is labelled "Aerospace", was named "Aerospace"
 *     although its inactive sites carry SeoOrganizationName "Honeywell"; and
 *     stripping a trailing "Jobs" made LCS's "All Jobs" site a board named
 *     "All".
 *   - ADP: the logo's file name ("C3 CMYK", "BTB2.png"), which also kept the
 *     board away from the posting-prose resolver.
 *   - Ashby: the hosted page's title, the bare word "Jobs" whenever the
 *     organization record is empty.
 *   - The agency screen then read "Recruiting" inside those labels as a
 *     staffing business, so Convergint (228 open roles) was labelled an
 *     agency and hidden by the hide-agencies filter.
 *
 * Every page below is a recorded read-only fetch (src/test/fixtures/
 * census-names/, each file names its URL and date). The pre-fix tools
 * produced exactly the wrong names quoted above from these recordings.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import {
  adpWelcomeName,
  agencyScreenText,
  ashbyOrganizationName,
  censusName,
  censusNameReason,
  nameAgreesWithHost,
  nameAgreesWithTenant,
  oraclePickName,
  oracleSiteName,
  pickAshbyName,
  pickUkgName,
  sameSiteRedirect,
  siteNameFromHomepage,
  ukgBoardFields,
  ukgName,
} from "../../scripts/census-names.mjs";
import { resolveBoard } from "../../scripts/resolve-adp-names.mjs";
import { unpublishableNameReason } from "../../scripts/prerender-names.mjs";
import { JOB_SOURCES } from "../../supabase/functions/job-board/sources";

const ROOT = resolve(__dirname, "../..");
const FX = resolve(__dirname, "fixtures/census-names");
const fixture = (f: string) => JSON.parse(readFileSync(join(FX, f), "utf8"));
const code = (p: string) => codeOf(readFileSync(resolve(ROOT, p), "utf8"));

/** A getter that answers from recordings by URL and fails loudly on anything unrecorded. */
const recorded = (pages: Record<string, string | null>) => async (url: string) => {
  if (!(url in pages)) throw new Error(`unrecorded fetch: ${url}`);
  return pages[url];
};

describe("UKG: the board's own Name, checked against the employer's footer domain, never the image text", () => {
  const axia = fixture("ukg-board-axia.json");
  const convergint = fixture("ukg-board-convergint.json");

  it("reads the jobBoard record and the footer link the employer set", () => {
    expect(ukgBoardFields(axia.html)).toEqual({ boardName: "Axia Women's Health", footerUrl: "http://www.axiawh.com" });
    expect(ukgBoardFields(convergint.html).footerUrl).toBe("https://www.convergint.com/culture/convergint-culture/");
  });

  it("names Axia Women's Health, not its logo's label", async () => {
    const base = "https://recruiting.ultipro.com/REG1001RWHM/JobBoard/3f9058a6-91f2-4cf1-bf33-bc76cb9f0522";
    const r = await ukgName(base, recorded({ [base]: axia.html }));
    expect(r?.name).toBe("Axia Women's Health");
    expect(r?.name).not.toMatch(/logo|horizontal/i);
  });

  it("names Convergint, not the 'US - LLC Recruiting' label that made it an agency", async () => {
    const base = "https://recruiting2.ultipro.com/CON1074CVTG/JobBoard/1831b61a-1945-44fa-afd8-624795c9b30d";
    const r = await ukgName(base, recorded({ [base]: convergint.html }));
    expect(r?.name).toBe("Convergint");
  });

  it("a board Name that is a label falls to the employer's own homepage, and to nothing when that is a label too", () => {
    expect(pickUkgName({ boardName: "Retail and Dining Positions", footerUrl: "http://paradieslagardere.com/", siteName: "Paradies Lagardère" }).name)
      .toBe("Paradies Lagardère");
    expect(pickUkgName({ boardName: "Craft", footerUrl: "", siteName: "" }).name).toBe("");
    expect(pickUkgName({ boardName: "ALL STORES", footerUrl: "http://www.careersatbig5.com", siteName: "big5careersite" }).name).toBe("");
  });

  // Recorded on the 2026-10-25 population read (board Name, footer link, homepage name).
  it("the tenant code the vendor built from the legal name can vouch for a board Name the footer does not show", () => {
    // The abbreviation after the digits is what the vendor built from the
    // legal name (CONPC: Continental Properties Company); the three letters
    // in front are only the name's first syllable, which any name can share.
    expect(pickUkgName({ boardName: "Continental Properties Careers", footerUrl: "https://www.cproperties.com/you-belong-here", siteName: "", tenant: "CON1051CONPC" }).name)
      .toBe("Continental Properties");
    expect(pickUkgName({ boardName: "Continental Careers", footerUrl: "https://www.cproperties.com/you-belong-here", siteName: "", tenant: "CON1051CONPC" }).name)
      .toBe("");
    expect(pickUkgName({ boardName: "Craft", footerUrl: "https://www.austin-ind.com", siteName: "", tenant: "AUS1003AUIN" }).name).toBe("");
  });

  it("a footer that points at a video, a CDN or a compliance site is not the employer's domain", () => {
    // With no employer domain, the tenant code must vouch for the board Name
    // (RMI: Redner's Markets Inc), and "Redner's" alone does not spell it.
    expect(pickUkgName({ boardName: "Redner's Jobs", footerUrl: "https://youtu.be/lRu3qfpYPsI", siteName: "", tenant: "RED1001RMI" }).name).toBe("");
    expect(pickUkgName({ boardName: "Redner's Markets Jobs", footerUrl: "https://youtu.be/lRu3qfpYPsI", siteName: "", tenant: "RED1001RMI" }).name).toBe("Redner's Markets");
    expect(pickUkgName({ boardName: "Career Opportunities", footerUrl: "https://www.e-verify.gov/", siteName: "E-Verify" }).name).toBe("");
  });

  it("a homepage name in segments gives the segment its domain spells", () => {
    expect(pickUkgName({
      boardName: "Career Opportunities", footerUrl: "https://rremcrestaurants.com",
      siteName: "RREMC Restaurants | American Restaurant in FL, VA, GA, IN, & IL",
    }).name).toBe("RREMC Restaurants");
  });

  it("a board Name that is a name and a homepage that names another organisation leave the board for a person", () => {
    // The franchisee's board is named for the brand it runs (Denny's), and a
    // winery's footer points at its parent's site: the two shapes are the
    // same, and they point opposite ways (the review, 2026-10-26).
    const franchise = pickUkgName({
      boardName: "Denny's Career Opportunities", footerUrl: "https://rremcrestaurants.com",
      siteName: "RREMC Restaurants | American Restaurant in FL, VA, GA, IN, & IL",
    });
    expect(franchise.name).toBe("");
    expect(franchise.evidence).toMatch(/review/);
    expect(pickUkgName({ boardName: "CedarCreek Estate Winery Careers", footerUrl: "https://www.markanthony.com", siteName: "The Mark Anthony Group of Companies" }).name).toBe("");
    // the two agree: the homepage's fuller name is the employer's
    expect(pickUkgName({ boardName: "Snell & Wilmer Business Professionals", footerUrl: "https://www.swlaw.com", siteName: "Law Offices of Snell & Wilmer" }).name)
      .toBe("Law Offices of Snell & Wilmer");
  });

  it("a board Name that disagrees with the employer's domain is not trusted on its own", () => {
    expect(nameAgreesWithHost("Craft", "www.austin-ind.com")).toBe(false);
    expect(nameAgreesWithHost("Hilltop Community Resources", "htop.org")).toBe(true);
    expect(nameAgreesWithHost("Genesee & Wyoming", "www.gwrr.com")).toBe(true);
    expect(pickUkgName({ boardName: "Craft", footerUrl: "https://www.austin-ind.com", siteName: "" }).name).toBe("");
  });

  it("the homepage's own name comes from og:site_name or its Organization record, never the <title>", () => {
    expect(siteNameFromHomepage('<title>Home | Acme</title><meta content="Acme Widgets" property="og:site_name">')).toBe("Acme Widgets");
    expect(siteNameFromHomepage('<title>Home | Acme</title><script type="application/ld+json">{"@type":"Organization","name":"Acme Widgets &amp; Co"}</script>'))
      .toBe("Acme Widgets & Co");
    expect(siteNameFromHomepage("<title>Acme Widgets</title>")).toBe("");
  });

  it("verify-all's ukg verifier reads ukgName and no image alt attribute", () => {
    const verify = code("scripts/verify-all.mjs");
    const ukg = verify.slice(verify.indexOf("  ukg: async (t) =>"), verify.indexOf("  paylocity: async (t) =>"));
    expect(ukg).toMatch(/await ukgName\(base, /);
    expect(ukg).not.toMatch(/alt=/i);
    expect(ukg).not.toMatch(/matchAll/);
  });
});

describe("Oracle: SeoOrganizationName first, from any site; a site label is refused whole", () => {
  const icfcjb = fixture("oracle-sites-icfcjb.json").items;
  const eexs = fixture("oracle-sites-eexs.json").items;

  it("Honeywell's aerospace tenant is not named 'Aerospace', and a name only its inactive sites carry waits for a person", () => {
    // The inactive sites still carry the pre-spin-off SeoOrganizationName
    // "Honeywell", which is another tenant's name in the catalogue
    // (ibqbjb~ocs~CX_1, the remaining Honeywell). This tenant is Honeywell
    // Aerospace (the trusted-pages round, 2026-10-25), so a name read only
    // from retired sites is a lead for review, never a resolution.
    const pick = oraclePickName(icfcjb);
    expect(pick.name).not.toBe("Aerospace");
    expect(pick.status).toBe("review");
    expect(pick.evidence).toMatch(/inactive/);
    const others = new Set(JOB_SOURCES.filter((b) => !b.token.startsWith("icfcjb~")).map((b) => b.name));
    expect(others.has("Honeywell"), "the catalogue's other Honeywell tenant").toBe(true);
    if (others.has(String(pick.name))) expect(pick.status, "another tenant's name is never resolved onto this one").not.toBe("resolved");
  });

  it("LCS's 'All Jobs' site never becomes a board named 'All', and its other labels name no one", () => {
    const site = (n: string) => eexs.find((s: { SiteNumber: string }) => s.SiteNumber === n);
    expect(site("CX_3001").SiteName).toBe("All Jobs");
    expect(oracleSiteName(site("CX_3001"))).toBeNull();
    expect(oracleSiteName(site("CX_11009"))).toBeNull(); // All Community Jobs
    expect(oracleSiteName(site("CX_8001"))).toBeNull(); // Community Template
    expect(oracleSiteName(site("CX_18005"))).toBeNull(); // Training Community
    expect(oracleSiteName(site("CX_1"))).toBe("LCS");
    expect(oracleSiteName(site("CX_2001"))).toBe("The Village at White River Junction");
    // 159 sites with many names: the per-site split decides, the tenant gets no one name
    expect(eexs.length).toBe(159);
    expect(oraclePickName(eexs).status).toBe("ambiguous");
  });

  it("an admin screen's tags come off a site name and the rest is judged; a label site names no one", () => {
    // Site names recorded from the 2026-10-25 read of every catalogue tenant.
    expect(oracleSiteName({ SiteName: "CareOne Group NEW", StatusCode: "ORA_ACTIVE" })).toBe("CareOne Group");
    expect(oracleSiteName({ SiteName: "Trabaje con nosotros | Copa Airlines - NEW", StatusCode: "ORA_ACTIVE" })).toBe("Copa Airlines");
    expect(oracleSiteName({ SiteName: "Silver Fern Farms External Careers Site - 2022", StatusCode: "ORA_ACTIVE" })).toBe("Silver Fern Farms");
    expect(oracleSiteName({ SiteName: "Career Site  - New Applicants", StatusCode: "ORA_ACTIVE" })).toBeNull();
    expect(oracleSiteName({ SiteName: "Contingent Workers", StatusCode: "ORA_ACTIVE" })).toBeNull();
    expect(oracleSiteName({ SiteName: "Cornwall Career Site", SeoOrganizationName: "Cornwall Council Jobs and Careers", StatusCode: "ORA_ACTIVE" }))
      .toBe("Cornwall Council");
  });

  it("both resolvers take their rule from the census module and read the whole site list", () => {
    const names = code("scripts/resolve-oracle-names.mjs");
    expect(names).toMatch(/const pickName = oraclePickName;/);
    expect(names, "a name for review is listed, never resolved").toMatch(/else if \(pick\.status === "review"\) review\.push\(/);
    expect(names).toMatch(/writeFileSync\(OUT, JSON\.stringify\(\{ resolved, review, ambiguous, unresolved \}/);
    expect(names).toMatch(/limit=200&offset=\$\{offset\}/);
    expect(names).not.toMatch(/limit=50\b/);
    expect(names).not.toMatch(/DEFAULT_NAMES/);
    const sites = code("scripts/resolve-oracle-sites.mjs");
    expect(sites).toMatch(/const brandName = oracleSiteName;/);
    expect(sites).not.toMatch(/Careers\?\|Jobs\?/);
    expect(sites).not.toMatch(/DEFAULT_NAMES/);
  });

  it("merge-oracle holds a label its own suffix strip turned into a word", () => {
    const merge = code("scripts/merge-oracle.mjs");
    expect(merge).toMatch(/censusNameReason\(name, \{ fromLabel: true \}\)/);
    expect(merge).toMatch(/dropped\.labelName\.push/);
    expect(censusNameReason("All", { fromLabel: true })).not.toBeNull();
  });
});

describe("ADP: welcome prose or the employer's posting prose, never the logo's file name", () => {
  it("a career centre whose only branding is a logo file is left unnamed by verify-all", () => {
    expect(adpWelcomeName(fixture("adp-links-c3.json").response.contentLinks)).toBe("");
    expect(adpWelcomeName(fixture("adp-links-bricktown.json").response.contentLinks)).toBe("");
  });

  it("welcome prose with no closing punctuation is still read", () => {
    expect(adpWelcomeName(fixture("adp-links-hudson.json").response.contentLinks)).toBe("Hudson Regional Hospital");
  });

  it("welcome prose that runs on past the name stops at the name", () => {
    const links = (t: string) => [{ linkTypeCode: { codeValue: "WELCOME-TXT", longName: t } }];
    expect(adpWelcomeName(links("Welcome to Taco Bell and be part of a team that supports your success!"))).toBe("Taco Bell");
    expect(adpWelcomeName(links("Welcome to our Career Center."))).toBe("");
    expect(adpWelcomeName(links("Welcome to the City of Boston Career Center."))).toBe("City of Boston");
    // recorded on the 2026-10-25 read of every ADP career centre in the catalogue
    expect(adpWelcomeName(links("Welcome to Wagoner Community Hospital, We are Glad You&#39;re Here! Our Mission:"))).toBe("Wagoner Community Hospital");
    expect(adpWelcomeName(links("Welcome to Outdoor Cap &amp; JUNK Brands Careers We're glad you are here! Established in 1977"))).toBe("Outdoor Cap & JUNK Brands");
    expect(adpWelcomeName(links("Welcome to the Career Center of Landhope Farms! &nbsp; We are excited"))).toBe("Landhope Farms");
    expect(adpWelcomeName(links("Welcome to Jiffy Lube, Start tomorrow! No resume required."))).toBe("Jiffy Lube");
  });

  it("the unnamed board then gets its name from its own postings: Community Care Cooperative", async () => {
    const list = fixture("adp-list-c3.json").response;
    const links = fixture("adp-links-c3.json").response;
    const details = Object.fromEntries(
      ["9201176446413_1", "9201197936155_1", "9201197946549_1", "9201197819459_1"]
        .map((id) => [id, fixture(`adp-detail-c3-${id}.json`).response]),
    );
    const get = async (url: string) => {
      if (url.includes("/content-links/career-center?")) return links;
      const id = /job-requisitions\/([^?]+)\?/.exec(url)?.[1];
      if (id) return details[id] ?? null;
      if (url.includes("/job-requisitions?")) return list;
      throw new Error(`unrecorded fetch: ${url}`);
    };
    const r = await resolveBoard({ token: "149c7964-ca14-4211-b982-ef50dfb8b504~9200868940886_2", count: 16 }, get);
    expect(r.status).toBe("resolved");
    expect(r.name).toBe("Community Care Cooperative");
  });

  it("verify-all's adp verifier no longer reads the logo content link", () => {
    const verify = code("scripts/verify-all.mjs");
    const adp = verify.slice(verify.indexOf("  adp: async (t) =>"), verify.indexOf("  ukg: async (t) =>"));
    expect(adp).toMatch(/adpWelcomeName\(links\?\.contentLinks\)/);
    expect(adp).not.toMatch(/IMG_LOGO/);
    expect(adp).not.toMatch(/shortName/);
  });
});

describe("Ashby: the organization record's name, never the page title", () => {
  it("a page with no organization record yields no name, and its title is refused", () => {
    const page = fixture("ashby-page-lemonade.json").html;
    expect(page).toMatch(/<title>Jobs<\/title>/);
    expect(ashbyOrganizationName(page)).toBe("");
    expect(censusName("Jobs").name).toBe("");
  });

  it("a page with an organization record yields its name", () => {
    expect(ashbyOrganizationName(fixture("ashby-page-vanta.json").html)).toBe("Vanta");
    expect(pickAshbyName("Vanta", "vanta")).toMatchObject({ name: "Vanta", from: "organization.name" });
  });

  it("an organization name that does not match the board's slug is not overwritten by the slug", () => {
    // Which of the two is the employer's name cannot be told from the page:
    // "OnePay" on oneapp and "ChipAgents" on alpha-design-ai-inc are the
    // brands, "Armitage Labs" on creem is the legal entity. The catalogue's
    // name stands where there is one, and a new board waits for a person.
    expect(pickAshbyName("Armitage Labs", "creem").name).toBe("");
    expect(pickAshbyName("Armitage Labs", "creem").from).toMatch(/review/);
    expect(pickAshbyName("Armitage Labs", "creem", "Creem").name).toBe("Creem");
    // The eleven catalogue names the review found replaced (ashby-final.json,
    // recorded 2026-10-25): eight whose organization record disagrees with
    // the slug, and three with no record at all.
    for (const [org, slug, known] of [
      ["OnePay", "oneapp", "OnePay"], ["ChipAgents", "alpha-design-ai-inc", "ChipAgents"], ["Multibank Group", "mexdigital", "Multibank Group"],
      ["9amHealth", "join9am", "9amHealth"], ["The Generalist Company Ltd", "tgc", "The Generalist Company Ltd"],
      ["Agresta, Storms & O\u2019Leary, PC", "aso-careers", "Agresta, Storms & O\u2019Leary, PC"], ["Jinba.io", "carnot-ai", "Jinba.io"],
      ["Cubic\u00b3", "cubic3", "Cubic\u00b3"],
      ["", "savvyinsurance-trellis", "Trellis Technologies"], ["", "workweave", "Weave"], ["", "phare-r1-r37", "R37 Lab, R1 RCM"],
    ]) {
      expect(pickAshbyName(org, slug, known).name, slug).toBe(known);
      if (org) expect(pickAshbyName(org, slug).name, `${slug}, a new board`).toBe("");
    }
    // A catalogue label is not kept over the slug: the boards named "Jobs".
    expect(pickAshbyName("", "lemonade", "Jobs").name).toBe("Lemonade");
    // A slug that names no one is no evidence against the record.
    expect(pickAshbyName("The L Suite", "jobs-page-4dc2685b-eb82-46d1-a3f9-1f0764dba814", "Jobs Page 4dc2685b Eb82 46d1 A3f9 1f0764dba814").name).toBe("The L Suite");
    // A slug made readable that keeps a label word is not a name.
    expect(pickAshbyName("", "aso-careers").name).toBe("");
    expect(pickAshbyName("", "acme-jobs").name).toBe("");
    expect(pickAshbyName("Teleport", "goteleport").name).toBe("Teleport");
    expect(pickAshbyName("Binance.US", "binance.us").name).toBe("Binance.US");
    expect(pickAshbyName("", "lemonade").name).toBe("Lemonade");
    // a shared common word is not a match: the fira-health board's record names
    // another company, so the record is not taken (and a new board waits)
    expect(pickAshbyName("Adaptive Home Health", "fira-health").name).toBe("");
    expect(pickAshbyName("Adaptive Home Health", "fira-health", "Fira Health").name).toBe("Fira Health");
    expect(nameAgreesWithHost("Bourne Manor Extended Care", "integritushealthcare.com")).toBe(false);
  });

  it("verify-all reads the hosted page's organization record", () => {
    const verify = code("scripts/verify-all.mjs");
    const ashby = verify.slice(verify.indexOf("  ashby: async (t) =>"), verify.indexOf("  smartrecruiters: async (t) =>"));
    expect(ashby).toMatch(/pickAshbyName\(ashbyOrganizationName\(page\), t\)/);
    expect(ashby).not.toMatch(/<title>/);
    // The hosted page is a second host, read at most once a second.
    expect(ashby).toMatch(/await politeText\(`https:\/\/jobs\.ashbyhq\.com\/\$\{encodeURIComponent\(t\)\}`\)/);
  });

  it("an employer's homepage is read once a second per host, and a redirect is followed only within its own site", () => {
    const verify = code("scripts/verify-all.mjs");
    expect(verify).toMatch(/const POLITE_SPACING_MS = 1100;/);
    const ukg = verify.slice(verify.indexOf("  ukg: async (t) =>"), verify.indexOf("  paylocity: async (t) =>"));
    expect(ukg).toMatch(/url === base \? probe\(url, true, 2\) : politeText\(url, \{ sameSiteRedirects: true \}\)/);
    expect(verify, "no census read follows a redirect to any host").not.toMatch(/"-L"/);
    expect(sameSiteRedirect("https://axiawh.com/", "https://www.axiawh.com/")).toBe(true);
    expect(sameSiteRedirect("http://www.signalenergy.com/", "https://covolt.com/")).toBe(false);
    expect(sameSiteRedirect("https://acme.co.uk/", "https://careers.acme.co.uk/home")).toBe(true);
    expect(sameSiteRedirect("https://acme.com/", "/home")).toBe(true);
    expect(sameSiteRedirect("https://acme.com/", "javascript:alert(1)")).toBe(false);
  });
});

describe("the census rule: the bake's rule, plus the label shapes a census meets", () => {
  // Each was written into the catalogue by a census tool (the trusted-pages
  // investigation and the catalogue sweep of 2026-10-25).
  const LABELS = [
    "Axia Logo Horizontal", "US - LLC Recruiting", "Westminster Brand 051816", "SCF New Branding 2018",
    "Welltower Refresh 2025", "PM New", "2024 New", "KemperSports - New", "Envision Header", "Farmers Logo 2022",
    "Corporate", "Career Site", "White Logo Color Background", "Aviation", "All Jobs", "All Community Jobs",
    "Community Template", "Training Community", "Student", "Staff and Faculty", "Internships", "Career Portal",
    "Global", "Default", "Tiffany - SR Testing", "ADMN Training Career Site V2",
    "Aerospace", "Jobs", "Opportunities", "Opportunities to Join Our Team",
    "C3 CMYK", "BTB2.png", "HRH Secaucus University Transparent", "Recruiting 2025", "Recruiting - L148 Template",
    "Linamar Career Site - New", "(OLD) EMEA copy", "QSAC 01/13/2023", "All Locations", "156436",
  ];
  // Real employers whose names share words with those labels.
  const NAMES = [
    "Axia Women's Health", "HUB International", "Work & Co", "The Company Store", "Logo Brands", "Lion Brand Yarn",
    "New Balance", "Global Payments", "Abt Global", "Booking.com", "Intertek Testing Services", "Center for Employment Opportunities",
    "New Opportunities Inc", "Opportunity 180", "Branding Brand", "Version 1", "84.51°", "5.11", "East-West Center",
    "Team Health", "Century 21", "Sub-Zero Group, Inc.", "LCS", "Honeywell", "당근마켓",
  ];

  it("refuses every census label, read from a label field", () => {
    for (const n of LABELS) expect(censusNameReason(n, { fromLabel: true }), n).not.toBeNull();
  });

  // An admin screen's version, date and brand tags come off the name they
  // were appended to; what remains is the employer's own word.
  const TAGGED: Record<string, string> = {
    "Westminster Brand 051816": "Westminster", "SCF New Branding 2018": "SCF", "Welltower Refresh 2025": "Welltower",
    "PM New": "PM", "KemperSports - New": "KemperSports", "Linamar Career Site - New": "Linamar", "QSAC 01/13/2023": "QSAC",
  };
  it("and cleaning a label never turns it into a name: what the tools write is censusName's output", () => {
    // The review (2026-10-26) found the gap this closes: the list above was
    // only ever judged raw, while every tool writes censusName's cleaned text.
    for (const n of LABELS) expect(censusName(n, { fromLabel: true }).name, n).toBe(TAGGED[n] ?? "");
  });

  // An admin screen's template tags come off a name that is there (the
  // review, 2026-10-26): these were refused whole and counted as label sites.
  const CLEANED: Array<[string, string]> = [
    ["Rice University Minimal Template External", "Rice University"],
    ["Pittsburg State University Career Site Minimal", "Pittsburg State University"],
    ["PCC External Site Minimal Template", "PCC"],
  ];
  it("a template tag comes off a name and the name is kept", () => {
    for (const [raw, name] of CLEANED) expect(censusName(raw, { fromLabel: true }).name, raw).toBe(name);
    expect(censusName("Recruiting - L148 Template", { fromLabel: true }).name, "a code is not a name").toBe("");
  });

  // Real names read from label fields on 2026-10-25 (board Names, site names, welcome prose).
  const LABEL_FIELD_NAMES = [
    "Axia Women's Health", "LCS", "Honeywell", "Rice University", "The Village at White River Junction",
    "Hudson Regional Hospital", "Convergint", "Butler University", "City of Boston", "Paradies Lagard\u00e8re",
    "Make-A-Wish Michigan", "Build-A-Bear Workshop", "Our Lady of the Lake",
  ];

  it("keeps every real name", () => {
    for (const n of NAMES) expect(censusNameReason(n), n).toBeNull();
    for (const n of LABEL_FIELD_NAMES) expect(censusNameReason(n, { fromLabel: true }), n).toBeNull();
  });

  it("is never looser than the bake: whatever the bake refuses, the census refuses", () => {
    const corpus = [...LABELS, ...NAMES, "Only External Postings", "careers.example.com", "Screenshot at 10.29.38 AM", "Chubb External"];
    for (const n of corpus) {
      if (unpublishableNameReason(n)) expect(censusNameReason(n), n).not.toBeNull();
    }
  });

  it("dates, versions and brand words are labels only in a label field: a company may be 'V7' or 'Horl 1993'", () => {
    for (const n of ["V7", "Horl 1993", "The Normal Brand", "Altius Test Prep", "Faculty", "Campus"]) {
      expect(censusNameReason(n), n).toBeNull();
    }
    for (const n of ["V7 Career Site V2", "Penn Mar 2021", "Goldenwest Branding", "Student"]) {
      expect(censusNameReason(n, { fromLabel: true }), n).not.toBeNull();
    }
  });

  it("scaffolding comes off a name, never off a label", () => {
    expect(censusName("Convergint Career Opportunities ").name).toBe("Convergint");
    expect(censusName("Careers At Butler").name).toBe("Butler");
    expect(censusName("Quest Diagnostics Careers").name).toBe("Quest Diagnostics");
    expect(censusName("All Jobs")).toMatchObject({ name: "", reason: expect.any(String) });
    expect(censusName("our Career Center").name).toBe("");
  });

  it("every census writer applies it: verify-all to every vendor, merge-all as the backstop", () => {
    const verify = code("scripts/verify-all.mjs");
    expect(verify).toMatch(/const r = refuseLabelName\(vendor, await verifiers\[vendor\]\(t\)/);
    expect(verify).toMatch(/censusNameReason\(hit\.name, \{ fromLabel: LABEL_NAMED_VENDORS\.has\(vendor\) \}\)/);
    const merge = code("scripts/merge-all.mjs");
    expect(merge).toMatch(/if \(censusNameReason\(name, \{ fromLabel: LABEL_NAMED_VENDORS\.has\(vendor\) \}\)\) \{/);
    const adp = code("scripts/resolve-adp-names.mjs");
    expect(adp).toMatch(/if \(censusNameReason\(n, \{ fromLabel: true \}\)\) return false;/);
  });
});

describe("agency: no word of a label is evidence of a staffing business", () => {
  it("only what a label field adds is taken out; the name inside is still screened, and an employer's own recruiting portal is a department", () => {
    // A catalogue name of a label-named vendor was mined from a label by the
    // old tools: its board-label scaffolding ("... Recruiting", "...
    // Recruitment Team") comes off, and the rest IS screened.
    expect(agencyScreenText("ukg", "US - LLC Recruiting")).toBe("");
    expect(agencyScreenText("ukg", "Calamos Recruiting")).toBe("Calamos");
    expect(agencyScreenText("oracle", "ENBD Recruitment Team")).toBe("ENBD");
    expect(agencyScreenText("adp", "The Barkan Companies recruitment page")).toBe("The Barkan Companies");
    // The review (2026-10-26): exempting three vendors wholesale let these through.
    expect(agencyScreenText("oracle", "Acme Staffing Services")).toBe("Acme Staffing Services");
    expect(agencyScreenText("adp", "Acme Staffing")).toBe("Acme Staffing");
    expect(agencyScreenText("ukg", "Avant Staffing Professionals")).toMatch(/Staffing/);
    // A hit says where its name came from: a homepage's own name, or welcome
    // prose, is a company-name field, so nothing is taken out of it.
    expect(agencyScreenText("ukg", "Acme Recruiting", { nameFrom: "www.acmerecruiting.com names itself" })).toBe("Acme Recruiting");
    expect(agencyScreenText("ukg", "Acme Recruiting", { nameFrom: "jobBoard.Name, agrees with www.acme.com" })).toBe("Acme");
    expect(agencyScreenText("greenhouse", "mthree Recruiting Portal")).toBe("mthree");
    expect(agencyScreenText("greenhouse", "AlphaSights Campus Recruiting")).toBe("AlphaSights");
    expect(agencyScreenText("recruitee", "Recruitment")).toBe("");
    expect(agencyScreenText("lever", "Robbins Recruiting")).toBe("Robbins Recruiting");
    expect(agencyScreenText("smartrecruiters", "Rylem Staffing LLC")).toBe("Rylem Staffing LLC");
  });

  // Real catalogue entries, run through the tagger itself in a scratch
  // directory laid out like the repository.
  const CATALOG = [
    "export const JOB_SOURCES: JobSource[] = [",
    '  { name: "US - LLC Recruiting", source: "ukg", token: "recruiting2~CON1074CVTG~1831b61a-1945-44fa-afd8-624795c9b30d" },',
    '  { name: "Calamos Recruiting", source: "ukg", token: "recruiting2~CAL1001CALA~46b96419-fba6-4dd0-a5fa-715bdfcf845b" },',
    '  { name: "Avant Staffing Professionals", source: "ukg", token: "recruiting~AVA1000AVSP~11111111-2222-3333-4444-555555555555" },',
    '  { name: "ENBD Recruitment Team", source: "oracle", token: "fa-evlo-saasfaprod1~ocs~CX_1" },',
    '  { name: "mthree Recruiting Portal", source: "greenhouse", token: "mthreerecruitingportal" },',
    '  { name: "Robbins Recruiting", source: "lever", token: "robbinsrecruiting" },',
    '  { name: "Rylem Staffing LLC", source: "smartrecruiters", token: "rylemstaffingllc" },',
    '  { name: "Collabera", source: "smartrecruiters", token: "Collabera2" },',
    "];",
    "",
  ].join("\n");

  const inScratch = (fn: (dir: string) => void) => {
    const dir = mkdtempSync(join(tmpdir(), "census-names-"));
    try {
      mkdirSync(join(dir, "supabase/functions/job-board"), { recursive: true });
      writeFileSync(join(dir, "supabase/functions/job-board/sources.ts"), CATALOG);
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  it("tag-agencies flags the agencies and none of the employers whose labels say Recruiting", () => {
    inScratch((dir) => {
      execFileSync(process.execPath, [resolve(ROOT, "scripts/tag-agencies.mjs")], { cwd: dir, stdio: "pipe" });
      const out = readFileSync(join(dir, "supabase/functions/job-board/sources.ts"), "utf8");
      const flagged = out.split("\n").filter((l) => l.includes("agency: true")).map((l) => /name: "([^"]+)"/.exec(l)?.[1]);
      expect(flagged.sort()).toEqual(["Avant Staffing Professionals", "Collabera", "Robbins Recruiting", "Rylem Staffing LLC"]);
    });
  });

  it("merge-all holds label names and flags no label-named board as an agency", () => {
    inScratch((dir) => {
      const verified = {
        ukg: [
          { token: "recruiting~REG1001RWHM~3f9058a6-91f2-4cf1-bf33-bc76cb9f0522", name: "Axia Logo Horizontal", count: 44 },
          { token: "recruiting2~SAP1000SPID~5e557a61-9707-4f47-8f76-9c11b2bfbf9e", name: "SCN Recruiting", count: 5 },
          { token: "recruiting~ACM1000ACST~11111111-2222-3333-4444-555555555555", name: "Acme Staffing", count: 6, nameFrom: "www.acmestaffing.com names itself" },
        ],
        greenhouse: [{ token: "alphasightsresumedrop", name: "AlphaSights Campus Recruiting", count: 7 }],
        workable: [{ token: "erg-recruiting", name: "Executive Recruiting Group", count: 9 }],
      };
      writeFileSync(join(dir, "verified.json"), JSON.stringify(verified));
      const log = execFileSync(process.execPath, [resolve(ROOT, "scripts/merge-all.mjs"), "verified.json", "--apply"], { cwd: dir, stdio: "pipe" }).toString();
      expect(log).toMatch(/"labelName":1/);
      const out = readFileSync(join(dir, "supabase/functions/job-board/sources.ts"), "utf8");
      const line = (n: string) => out.split("\n").find((l) => l.includes(`name: "${n}"`)) ?? "";
      expect(line("Axia Logo Horizontal")).toBe("");
      expect(line("SCN Recruiting")).not.toBe("");
      expect(line("SCN Recruiting")).not.toMatch(/agency: true/);
      expect(line("AlphaSights Campus Recruiting")).not.toMatch(/agency: true/);
      expect(line("Executive Recruiting Group")).toMatch(/agency: true/);
      expect(line("Acme Staffing"), "a UKG homepage's own name is screened").toMatch(/agency: true/);
    });
  });

  it("both writers screen agencyScreenText, keeping the vocabulary literal the other guards pin", () => {
    const tag = code("scripts/tag-agencies.mjs");
    expect(tag).toMatch(/AGENCY_NAME\.test\(agencyScreenText\(vendor, unesc\(name\)\)\)/);
    expect(tag).toMatch(/if \(line\.includes\("agency: true"\)\) \{/);
    const merge = code("scripts/merge-all.mjs");
    expect(merge).toMatch(/AGENCY_NAME\.test\(agencyScreenText\(vendor, b\.name, \{ nameFrom: b\.nameFrom \}\)\) \|\| agencyEvidence\.has\(/);
  });
});

/**
 * THE REVIEW OF 2026-10-26. Every input below was read on the 2026-10-25
 * population runs (the board's own Name, its footer link and its employer's
 * homepage name, as recorded in ~/.config/resumebooster/census-tools-2026-10-25/),
 * and the fixed tools wrote each one as an employer's name: another
 * organisation, a label, a domain or a sentence.
 */
describe("the review of 2026-10-26: no other organisation, label, domain or sentence is written as an employer", () => {
  const ukg = (boardName: string, footerUrl: string, siteName: string, tenant: string) => pickUkgName({ boardName, footerUrl, siteName, tenant }).name;

  it("a homepage name must agree with the employer's own domain, and a badge, league or parent site is not that domain", () => {
    expect(ukg("All Open Opportunities", "http://houston.astros.mlb.com/", "MLB.com", "HOU1000")).toBe("");
    expect(ukg("Job Opportunities", "http://losangeles.dodgers.mlb.com/mlb/help/jobs.jsp?c_id=la", "MLB.com", "LOS1000LADOD")).toBe("");
    expect(ukg("Career Opportunities", "https://www.greatplacetowork.com/certified-company/7011898", "Great Place To Work®", "DOC1001DOCM")).toBe("");
    // a homepage that names another company (signalenergy.com's page names covolt.com)
    expect(ukg("Opportunities", "http://www.signalenergy.com/who-we-are/overview", "Covolt", "SIG1007SGEN")).toBe("");
    // a homepage name that does not spell the domain is not the employer's
    expect(ukg("Diversified Careers - Maine Roots. Global Opportunities.", "https://www.divcom.com/about/", "Diversified", "DIV1004DIVHO")).toBe("");
    // positive controls
    expect(ukg("Opportunities", "http://www.goodwillky.org/about/", "Goodwill Kentucky - Goodwill Kentucky", "GOO1026")).toBe("Goodwill Kentucky");
    expect(ukg("Opportunities", "http://www.edens.com/careers/", "EDENS", "ede1001")).toBe("EDENS");
  });

  it("a board Name with no footer link needs the tenant code to vouch for it", () => {
    expect(ukg("eQuest", "", "", "OCI1001")).toBe("");
    expect(ukg("Career Opportunities in Delaware", "", "", "CHI1001CHIM")).toBe("");
    expect(ukg("International Opportunities", "", "", "WEB1004WEBIN")).toBe("");
    expect(ukg("Open Opportunities - External Candidates Only", "", "", "AME1104ANBT")).toBe("");
    expect(ukg("Federal Work Study Jobs  - For more information email FWS@BerkeleyCollege.edu", "", "", "BER1008BESNJ")).toBe("");
    // positive controls: the name's initials are the abbreviation, or it spells it
    expect(ukg("Catholic Charities of Southern Nevada", "", "", "CAT1021CCSN")).toBe("Catholic Charities of Southern Nevada");
    expect(ukg("Austin Industries Careers", "", "", "AUS1003AUIN")).toBe("Austin Industries");
  });

  it("the tenant code vouches only through its abbreviation, never its first three letters", () => {
    expect(nameAgreesWithTenant("Diversified Careers - Maine Roots. Global Opportunities.", "DIV1004DIVHO")).toBe(false);
    expect(nameAgreesWithTenant("Divine Bakery", "DIV1004DIVHO")).toBe(false);
    expect(nameAgreesWithTenant("eQuest", "OCI1001")).toBe(false);
    expect(nameAgreesWithTenant("Continental Properties", "CON1051CONPC")).toBe(true);
    expect(nameAgreesWithTenant("Catholic Charities", "CAT1004CC")).toBe(true);
  });

  it("a domain, a bare leftover qualifier, an email address, a lead-in and a tail naming another company are not names", () => {
    for (const n of ["MLB.com", "www.rseden.org", "covolt.com", "SpecialOlympics.org"]) {
      expect(censusName(n, { fromLabel: true }).name, n).toBe("");
      expect(censusName(n, { fromSite: true }).name, `${n} as a homepage's name`).toBe("");
    }
    expect(censusName("www.acme.com").name, "a leading www. is never a name").toBe("");
    for (const n of ["Current", "International", "Club", "Candidates Only"]) expect(censusName(n, { fromLabel: true }).name, n).toBe("");
    expect(censusName("Federal Work Study Jobs - For more information email FWS@BerkeleyCollege.edu", { fromLabel: true }).name).toBe("");
    expect(censusName("Career Opportunities in Delaware", { fromLabel: true }).name).toBe("");
    expect(censusName("KENT Nutrition - A member of the KENT WORLDWIDE family of companies", { fromLabel: true }).name).toBe("");
    expect(censusName("The Lodge at Sea Island - A Benchmark Resorts Property", { fromLabel: true }).name).toBe("");
    // the employer's own name comes out of a lead-in, a qualifier or a slogan
    expect(ukg("Potential Employment Opportunities with Quanex", "https://www.quanex.com/", "", "QUA1012QBPC")).toBe("Quanex");
    expect(ukg("Swisher Current Opportunities", "https://privacy.swisher.com/", "", "SWI1007SWSH")).toBe("Swisher");
    const kent = ukg("KENT WORLDWIDE™ - US Best Managed Company Award Winner", "http://www.kentww.com/careers/", "", "KEN1011KENT");
    expect(kent).toMatch(/^KENT WORLDWIDE/);
    expect(kent).not.toMatch(/award|winner|best/i);
    // Booking.com and Binance.US name themselves that way in a company-name field
    expect(censusName("Booking.com").name).toBe("Booking.com");
  });

  it("Oracle's 'Candidate Experience site' scaffolding comes off whole, joiner and all", () => {
    expect(censusName("Candidate Experience site for interns", { fromLabel: true }).name).toBe("");
    expect(censusName("Candidate Experience", { fromLabel: true }).name).toBe("");
    const edel = fixture("oracle-sites-edel.json").items;
    const pick = oraclePickName(edel);
    expect(pick.status, "Fortinet's tenant names no one from its active sites").not.toBe("resolved");
    expect(JSON.stringify(pick)).not.toMatch(/Candidate Experience/i);
    const mapei = fixture("oracle-sites-mapei.json").items;
    const named = mapei.map((x: { SiteNumber: string }) => oracleSiteName(x));
    expect(named).toEqual(["Mapei", "Vaga", "Mosaico+", "Adesital", "Polyglass", "Vinavil", "Cercol", "Profilpas"]);
  });

  it("an ADP welcome sentence gives the name without its possessive or its page words", () => {
    const welcome = (t: string) => adpWelcomeName([{ linkTypeCode: { codeValue: "WELCOME-TXT", longName: t } }]);
    expect(welcome("Welcome to Prosperity Bank's career website!")).toBe("Prosperity Bank");
    expect(welcome("Welcome to the Houston Housing Authority's Career Center Page.")).toBe("Houston Housing Authority");
    expect(welcome("Welcome to the Adara Living Career Center Page!")).toBe("Adara Living");
    expect(welcome("Welcome to the Sun Tran Job Center.")).toBe("Sun Tran");
    expect(welcome("Welcome to EDC's career site!")).toBe("EDC");
    expect(welcome("Welcome to The Doe Fund's Career Center.")).toBe("The Doe Fund");
    expect(welcome("Welcome to the Lupus Foundation of America's career page.")).toBe("Lupus Foundation of America");
    expect(welcome("Welcome to the Department of Human Resources.")).toBe("");
    expect(welcome('Welcome to Cornbread ("Cornbread" is a family of restaurants)')).toBe("");
    const concept = welcome("Welcome to Concept Careers Join the Concept family of companies.");
    expect(concept).not.toMatch(/join|careers/i);
    // a name that ends in a possessive keeps it
    expect(welcome("Welcome to Trader Joe's career site!")).toBe("Trader Joe's");
    expect(welcome("Welcome to Denny's!")).toBe("Denny's");
  });

  it("an Oracle site label is refused or cut to the name it carries, whatever its tail", () => {
    const cases: Array<[string, string]> = [
      ["Teaching", ""], ["Substitutes", ""], ["Psychologist", ""], ["Paraprofessional", ""],
      ["Penske Careers French", "Penske"], ["Chartwell Career Site English", "Chartwell"],
      ["New Courtesy Posting Site", ""], ["AICC Internal Site", "AICC"], ["Howmet Aerospace Intern Site", "Howmet Aerospace"],
      ["Scottish Government Recruitment", "Scottish Government"], ["Suffolk County Council Internal Jobs Board", "Suffolk County Council"],
      ["Yanfeng Human Resources", "Yanfeng"], ["Human Resources", ""], ["Talent Acquisition", ""],
    ];
    for (const [raw, name] of cases) expect(censusName(raw, { fromLabel: true }).name, raw).toBe(name);
    expect(censusName("Human Resources").name, "in a company-name field too").toBe("");
  });

  it("a hospital is a part of an employer only when its tenant names another site", () => {
    const site = (SiteName: string, SiteNumber: string) => ({ SiteName, SiteNumber, StatusCode: "ORA_ACTIVE" });
    for (const n of ["Community Hospital", "University Hospital", "Regional Hospital"]) {
      expect(oraclePickName([site(n, "CX_1")]), `${n} alone`).toMatchObject({ status: "resolved", name: n });
      expect(oraclePickName([site(n, "CX_1"), site("Acme Health", "CX_2")]), `${n} beside Acme Health`).toMatchObject({ status: "resolved", name: "Acme Health" });
    }
    expect(oraclePickName([site("Retail Stores", "CX_1")]).status, "a store is never the employer").not.toBe("resolved");
  });
});
