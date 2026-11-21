// @vitest-environment node
/**
 * A JOB TITLE NAMES ONLY THE JOB (SEO audit 2026-11-18, STRUCTURED-5).
 *
 * Google's JobPosting title guidance asks for no job codes, addresses, dates,
 * salaries or company names in the title, and 20 of the 492 served titles
 * carried one: Domino's "General Manager (05867) - 602 11th Avenue NW",
 * Regal's "$15.50/hr ... - Regal King of Prussia", a ZIP, the row's own
 * requisition key. Its policy also says "Publishers may solicit resume
 * collections for open positions only", and santander Req0843024
 * "Candidatura Spontanea per Internship" was served with a JobPosting. And the
 * baked heading printed a title typed in capitals as typed ("MFG PEE PH PR
 * TECH") while its markup title-cased it.
 *
 * The markup's title is now postingMarkupTitle (the job, nothing else); an
 * open application gets no markup on any board, so a carried page of one
 * becomes the bake's noindex stub as an internal-only posting does; and the
 * bake's heading prints postingTitleText. The corpus is the 492 served
 * JobPosting titles (fixtures/served-postings-2026-11-18.json.gz), each read
 * by hand: the 18 below change, as labelled, and no other title does.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";
import type { PostingRow } from "@/components/jobs/posting-page";
import { bakePostingPage } from "../../scripts/prerender-seo.mjs";

type Served = { path: string; id: string; source: string; token: string; title: string; company: string; location: string | null; country: string | null; postedAt: string; description: string; jp: { title: string } | null };
const SERVED: Served[] = JSON.parse(gunzipSync(readFileSync(resolve(__dirname, "fixtures/served-postings-2026-11-18.json.gz"))).toString("utf8"));
const SITE = "https://resumebooster.work";
const D = { ...companyDisplay, ...postingPage };
const byPath = (p: string) => {
  const r = SERVED.find((x) => x.path === `/jobs/posting/${p}`);
  if (!r) throw new Error(`no served page ${p}`);
  return r;
};
/** The row as the board served it, posted yesterday so every rule that reads the date passes. */
const DAY = 86_400_000;
const rowOf = (r: Served): PostingRow => ({
  id: r.id, source: r.source, token: r.token, title: r.title, company: r.company,
  location: r.location, country: r.country, postedAt: new Date(Date.now() - DAY).toISOString(),
  applyUrl: null, salary: null, agency: false, workMode: null, missingSince: null,
} as unknown as PostingRow);
const markup = (r: Served) => postingPage.postingJsonLdShape(rowOf(r), r.description, { site: SITE });
/** What the markup names; read through the namespace so this file fails, not breaks, on a main without it. */
const markupTitle = (r: Served): string => {
  const f = (postingPage as unknown as { postingMarkupTitle?: (j: unknown) => string }).postingMarkupTitle;
  return typeof f === "function" ? f(rowOf(r)) : postingPage.postingTitleText(r.title);
};

const REGAL = "ukg/recruiting~REG1000REGAL~1bbca4e6-7b2d-4f4f-bb34-681fc9385364";
const SANTANDER = "workday/santander~wd3~SantanderCareers/Req0843024";
const CHERRY_HILL = "ukg/recruiting~CHE1023CRRY~f99546c8-1543-437d-b13b-ac58c6e27205";
/** Every served title the markup no longer names as served, and what it names. */
const CLEANED: Record<string, string> = {
  "workday/fivebelow~wd1~fivebelowcareers/JR96028": "Seasonal Sales Associate",
  [`${REGAL}/dd775738-7b97-4c89-b299-7c8ed30344ba`]: "Maintenance Technicians - Part Time",
  [`${REGAL}/238dd752-8d54-416c-a391-6aaf841ded37`]: "SEASONAL Floor Staff",
  [`${REGAL}/961f55df-275d-401b-8129-8cbf0ed3621a`]: "Part Time Floor Staff Positions Available (Closing Staff - Must have availability to stay later than 2AM)",
  [`${REGAL}/bbe5f5f3-9dc1-4680-9f51-0be297192371`]: "Part Time Floor Staff Positions Available (Opening Staff - Need to be Available as Early as 7am)",
  "smartrecruiters/dominos/744000160477039": "Delivery Driver",
  "smartrecruiters/dominos/744000160476989": "Assistant Manager",
  "smartrecruiters/dominos/744000160476849": "Assistant Manager",
  "smartrecruiters/dominos/744000160476799": "Delivery Driver",
  "smartrecruiters/dominos/744000160471762": "General Manager",
  "smartrecruiters/dominos/744000160476296": "General Manager",
  "smartrecruiters/dominos/744000161667519": "Delivery Driver",
  "oracle/ekeq~em2~CX_1/N134928": "Joules Short-term Temporary Sales Assistant - Wells Beach",
  [SANTANDER]: "Candidatura Spontanea per Internship",
  "workday/jeffersonhealth~wd5~ThomasJeffersonExternal/REQ-0025769-1": "Per Diem Anesthesiologist",
  "icims/careers.heb.com/253831": "Certified Medical Assistant",
  "workday/jj~wd5~JJ/R-108845-1": "Sales Associate, Trauma - Dallas, TX",
  "workday/jj~wd5~JJ/R-108850-1": "Regional Clinical Sales Specialist, Trauma – Dallas, TX",
  // The residual shapes (STRUCTURED-B5), each read by hand.
  "oracle/ibmwjb~ocs~CX_1/25033733": "Cook",
  "greenhouse/coupang/8287891": "물류부동산 개발 및 투자 전문가 채용",
  "workday/jdgroupnam~wd1~JDFL_Store_Careers/JR120879": "Macy's Store Management",
  "smartrecruiters/LeCollectionist/744000160225984": "Senior Product Manager (H/F/X) - Ops Squad",
  "smartrecruiters/LeCollectionist/744000160223801": "Senior Product Manager (H/F/X) - Supply Squad",
  "smartrecruiters/LeCollectionist/744000160226909": "Senior Web & Mobile Developer (H/F/X) - Squad XP",
  "smartrecruiters/BoschGroup/744000160437899": "Executive Assistant",
  [`${CHERRY_HILL}/ad9a6ceb-9739-45f6-ba97-074f62f25c31`]: "Seasonal Holiday Retail Manager",
  [`${CHERRY_HILL}/b6d07358-aef5-49ad-9f7e-5140133a64a0`]: "Seasonal Holiday Retail Manager",
};

describe("the titles the audit names", () => {
  it("Domino's store code and street, Regal's pay and cinema, Five Below's ZIP and Next's own key are off the markup title", () => {
    for (const [p, want] of [
      ["smartrecruiters/dominos/744000160471762", "General Manager"],
      ["smartrecruiters/dominos/744000160476849", "Assistant Manager"],
      [`${REGAL}/961f55df-275d-401b-8129-8cbf0ed3621a`, CLEANED[`${REGAL}/961f55df-275d-401b-8129-8cbf0ed3621a`]],
      [`${REGAL}/238dd752-8d54-416c-a391-6aaf841ded37`, "SEASONAL Floor Staff"],
      ["workday/fivebelow~wd1~fivebelowcareers/JR96028", "Seasonal Sales Associate"],
      ["oracle/ekeq~em2~CX_1/N134928", "Joules Short-term Temporary Sales Assistant - Wells Beach"],
    ] as const) {
      const ld = markup(byPath(p));
      expect(ld, p).not.toBeNull();
      expect(ld!.title, p).toBe(want);
    }
  });

  it("the page keeps the employer's words: the cleaned title is part of what the heading prints", () => {
    for (const p of Object.keys(CLEANED)) {
      const r = byPath(p);
      expect(postingPage.postingTitleText(r.title), p).toContain(CLEANED[p].replace(/ - .*$/, ""));
    }
  });

  it("santander's spontaneous application has no JobPosting, and its carried page is the bake's noindex stub", () => {
    const r = byPath(SANTANDER);
    expect(markup(r)).toBeNull();
    expect(postingPage.postingJsonLd(rowOf(r), r.description, { site: SITE })).toBeNull();
    const baked = bakePostingPage(rowOf(r), r.description, { D, SITE, carried: true });
    expect(baked).toMatchObject({ live: false, ld: null });
    // A job at the same employer, same board, keeps its page and its markup.
    const job = { ...r, title: "Internship Credit Risk Analyst" };
    expect(bakePostingPage(rowOf(job), r.description, { D, SITE, carried: true })).toMatchObject({ live: true });
  });

  it("micron JR110958-1: the baked heading prints the title as the markup names it", () => {
    const r = byPath("workday/micron~wd1~external/JR110958-1");
    expect(r.title).toBe("MFG PEE PH PR TECH");
    expect(markup(r)?.title).toBe("Mfg PEE PH PR Tech");
    const bake = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    // The posting page's heading, breadcrumb and ledger title are this one value.
    expect(bake).toMatch(/const title = D\.postingTitleText\(job\.title\);\n\s+const place = /);
    expect(bake).toMatch(/<h1>\$\{esc\(title\)\}<\/h1>/);
    expect(bake).toMatch(/export \{[^}]*\bpostingTitleText\b[^}]*\} from "\.\.\/src\/components\/jobs\/posting-page";/);
  });
});

describe("the residual shapes the 2026-11-18 audit names (STRUCTURED-B5)", () => {
  const title = (t: string, company: string, location: string | null = null, id = "workday:acme~wd1~Careers:R-1") =>
    (postingPage as unknown as { postingMarkupTitle: (j: unknown) => string }).postingMarkupTitle({ id, title: t, company, location });
  it("takes off a site named by the brand, a leading bracket tag, a mall, a brand lead, a contract code and a list of places", () => {
    expect(title("Cook - Brookdale Memorial Oaks", "Brookdale Senior Living")).toBe("Cook");
    expect(title("[쿠팡] 물류부동산 개발 및 투자 전문가 채용", "Coupang")).toBe("물류부동산 개발 및 투자 전문가 채용");
    expect(title("Seasonal Holiday Sales Associate - Wenatchee Valley Mall", "Cherry Hill Programs")).toBe("Seasonal Holiday Sales Associate");
    expect(title("Finish Line Macy's Store Management - Micronesia, Dededo, GU", "JD Finish Line", "FM: 02468 Dededo, Guam (Microneisa)")).toBe("Macy's Store Management");
    expect(title("Senior Product Manager (H/F/X) - Ops Squad - CDI - Marseille / Paris / Remote", "Le Collectionist", "Paris, Région Île-de-France, France")).toBe("Senior Product Manager (H/F/X) - Ops Squad");
  });
  it("leaves a whole employer name that opens a title, a job's own place words and a service center alone", () => {
    expect(title("Cineplex Strawberry Hill - Cast Member", "Cineplex")).toBe("Cineplex Strawberry Hill - Cast Member");
    expect(title("Tencent Cloud – Senior Strategic Sales Executive", "Tencent")).toBe("Tencent Cloud – Senior Strategic Sales Executive");
    expect(title("U-Haul Moving Center General Manager", "U-Haul")).toBe("U-Haul Moving Center General Manager");
    expect(title("Customer Service Representative - Call Center", "Acme")).toBe("Customer Service Representative - Call Center");
    expect(title("Principal, Real Estate [L6-II] (CREF_Development & Investment)", "Coupang Internal")).toBe("Principal, Real Estate [L6-II] (CREF_Development & Investment)");
    expect(title("Sales Associate, Trauma - Dallas, TX", "Acme", "Dallas, TX")).toBe("Sales Associate, Trauma - Dallas, TX");
  });
});

describe("the 492 served JobPosting titles", () => {
  const withMarkup = SERVED.filter((r) => r.jp);
  it("is the corpus the audit read", () => {
    expect(withMarkup).toHaveLength(492);
  });

  it("changes exactly the 27 read by hand, as labelled, and no other title (never worse)", () => {
    const changed: Record<string, string> = {};
    for (const r of withMarkup) {
      const t = markupTitle(r);
      if (t !== postingPage.postingTitleText(r.title)) changed[r.path.replace("/jobs/posting/", "")] = t;
    }
    expect(changed).toEqual(CLEANED);
  });

  it("refuses markup for one title as an open application, santander's", () => {
    const f = (postingPage as unknown as { openApplicationTitle?: (t: string) => boolean }).openApplicationTitle;
    expect(typeof f).toBe("function");
    expect(withMarkup.filter((r) => f!(r.title)).map((r) => r.path)).toEqual([`/jobs/posting/${SANTANDER}`]);
    for (const t of ["Spontaneous Application - Engineering", "Initiativbewerbung (m/w/d)", "Candidature spontanée", "Talent Pool: Nurses", "Open Application"]) expect(f!(t), t).toBe(true);
    for (const t of ["Application Engineer", "Open Systems Analyst", "Sr. Technical Professional-Pipeline", "Talent Acquisition Partner"]) expect(f!(t), t).toBe(false);
  });

  it("leaves a company name inside the job's own words, and a year", () => {
    const keep = (title: string, company: string, id = "workday:acme~wd1~Careers:R-1") => (postingPage as unknown as { postingMarkupTitle: (j: unknown) => string }).postingMarkupTitle({ id, title, company });
    expect(keep("Becas Alcoa", "Alcoa")).toBe("Becas Alcoa");
    expect(keep("PRODEJNÍ ASISTENT V PRODEJNĚ JYSK OLOMOUC", "JYSK")).toBe("Prodejní Asistent v Prodejně JYSK Olomouc");
    expect(keep("Summer Intern (2026)", "Acme")).toBe("Summer Intern (2026)");
    expect(keep("Engineering Co-op Student, NY 10001", "Acme")).toBe("Engineering Co-op Student, NY 10001");
    expect(keep("Acme", "Acme")).toBe("Acme");
  });
});
