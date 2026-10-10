import { describe, expect, it } from "vitest";
import {
  postingEmployer,
  postingJsonLd,
  postingPageDescription,
  postingPageTitle,
  type PostingRow,
} from "@/components/jobs/posting-page";
import { boardName, employerName, isCodeShapedName, possessive } from "@/lib/company-display";

/**
 * WHAT WAS WRONG, measured 2026-10-08 with a Googlebot user-agent (SEO report,
 * F1): 292 of the 399 posting pages and 169 of the 487 company pages named the
 * employer by its Workday tenant code, capitalised. Morgan Stanley's postings
 * told Google for Jobs that "Ms" was hiring; the RMIT posting's JSON-LD said
 * `"hiringOrganization":{"name":"Rmit"}` over a description that opens "RMIT
 * University is seeking". The database already held the real names for some
 * of these (company_name_overrides), but the page builder printed the row's
 * stored name, and eight company pages printed "Domino's's".
 *
 * These run the functions the bake and the React posting page both call, on
 * the row the live board returns for ms~wd5~external (company "Ms").
 */

const NOW = new Date("2026-10-09T12:00:00Z");
const row = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: "workday:ms~wd5~external:JR014245",
  title: "Performance Analyst",
  company: "Ms",
  token: "ms~wd5~external",
  location: "Tempe, Arizona",
  country: "US",
  workMode: null,
  postedAt: "2026-10-05T00:00:00+00:00",
  missingSince: null,
  ...over,
});
const DESC = "The role ".repeat(40);

describe("a posting names the employer by the name it uses", () => {
  it("hiringOrganization and the identifier name Morgan Stanley, not its tenant code", () => {
    const ld = postingJsonLd(row(), DESC, { site: "https://resumebooster.work", now: NOW }) as Record<string, Record<string, unknown>>;
    expect(ld).not.toBeNull();
    expect(ld.hiringOrganization.name).toBe("Morgan Stanley");
    expect(ld.identifier.name).toBe("Morgan Stanley");
  });

  it("the page title and the meta description name it too", () => {
    expect(postingPageTitle(row())).toContain("Morgan Stanley");
    expect(postingPageTitle(row())).not.toMatch(/\bMs\b/);
    expect(postingPageDescription(row())).toContain("at Morgan Stanley");
    expect(postingPageDescription(row())).not.toMatch(/\bMs\b/);
  });

  it("an id alone is enough: the token comes out of the board id when the row carries none", () => {
    expect(postingEmployer({ id: "workday:rmit~wd3~RMIT_Careers:JR1", company: "Rmit", token: null })).toBe("RMIT University");
  });

  it("a name the overrides do not cover is printed as stored", () => {
    expect(postingEmployer(row({ id: "greenhouse:acme:1", token: "acme", company: "Acme Health" }))).toBe("Acme Health");
  });

  it("a federal posting keeps its own agency; only the whole board is called USAJOBS", () => {
    expect(employerName("usajobs", "Veterans Health Administration")).toBe("Veterans Health Administration");
    expect(boardName("usajobs", "Western Area Power Administration")).toBe("USAJOBS");
  });
});

describe("a possessive never doubles", () => {
  it("Domino's is its own possessive, Siemens takes an apostrophe, the rest take 's", () => {
    expect(possessive("Domino's")).toBe("Domino's");
    expect(possessive("Raising Cane’s")).toBe("Raising Cane’s");
    expect(possessive("Siemens")).toBe("Siemens'");
    expect(possessive("Morgan Stanley")).toBe("Morgan Stanley's");
  });

  it("the meta description of a Domino's posting says Domino's own job board", () => {
    const d = postingPageDescription(row({ id: "smartrecruiters:dominos:1", token: "dominos", company: "Domino's", title: "Driver", location: "Ann Arbor" }));
    expect(d).toContain("Domino's own job board");
    expect(d).not.toContain("Domino's's");
  });
});

describe("a name that is still a tenant code is recognisable as one", () => {
  it("flags the capitalised tenant code of a compound token", () => {
    expect(isCodeShapedName("uoflhealth~wd1~UofLHealthCareers", "Uoflhealth")).toBe(true);
    expect(isCodeShapedName("r1rcm~wd1~R1RCM", "R1rcm")).toBe(true);
  });

  it("does not flag an employer whose real name equals its tenant code, nor a board name the employer chose", () => {
    expect(isCodeShapedName("target~wd5~targetcareers", "Target")).toBe(false);
    expect(isCodeShapedName("nike~wd1~nke", "Nike")).toBe(false);
    expect(isCodeShapedName("carvana", "Carvana")).toBe(false);
    expect(isCodeShapedName("ms~wd5~external", employerName("ms~wd5~external", "Ms"))).toBe(false);
  });
});
