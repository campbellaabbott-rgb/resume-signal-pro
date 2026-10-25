/**
 * THE APPLY LINK NAMES THE SYSTEM IT OPENS (job-listings audit JL15).
 *
 * The posting is READ from the system in its `source` column; its apply link
 * can open somewhere else. The pane's "Apply link opens on …" row is read off
 * the link itself, and a host we cannot name prints as its hostname — never as
 * the source we happened to read the posting from, and never as a raw column
 * value.
 *
 * And the one URL rewrite: a trailing "/apply" comes off a Workday link
 * (myworkdayjobs.com) and off nothing else. The table below is per vendor so a
 * widened rule fails on the first host it touches.
 */
import { describe, expect, it } from "vitest";
import { applySystem, cleanApplyUrl, systemLabel } from "@/lib/listing/apply-url";
import { ALL_BOARD_SOURCES } from "@/config/ats-vendors";

describe("the system an apply link opens", () => {
  const cases: Array<[string, string, boolean]> = [
    ["https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Austin/Engineer_R123", "Workday", true],
    ["https://boards.greenhouse.io/acme/jobs/4012345", "Greenhouse", true],
    ["https://job-boards.greenhouse.io/acme/jobs/4012345", "Greenhouse", true],
    ["https://jobs.lever.co/acme/1b2c", "Lever", true],
    ["https://jobs.ashbyhq.com/acme/abc", "Ashby", true],
    ["https://jobs.smartrecruiters.com/Acme/7444", "SmartRecruiters", true],
    ["https://acme.breezy.hr/p/abc-engineer", "Breezy", true],
    ["https://ehpv.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/123", "Oracle", true],
    ["https://acme.jobs.personio.de/job/123", "Personio", true],
    ["https://acme.recruitee.com/o/engineer", "Recruitee", true],
    ["https://careers-acme.icims.com/jobs/1234/job", "iCIMS", true],
    ["https://www.usajobs.gov/job/812345600", "USAJOBS", true],
    ["https://recruiting.ultipro.com/ACM1000/JobBoard/abc/OpportunityDetail?opportunityId=1", "UKG Pro Recruiting", true],
    ["https://recruiting.paylocity.com/recruiting/jobs/Details/123", "Paylocity", true],
    ["https://acme.applytojob.com/apply/abc/Engineer", "JazzHR", true],
    ["https://acme.taleo.net/careersection/2/jobdetail.ftl?job=1", "Taleo", true],
    ["https://careers.amd.com/careers-home/jobs/1000", "careers.amd.com", false],
    ["https://www.acme-careers.example/jobs/1", "acme-careers.example", false],
  ];
  for (const [url, label, named] of cases) {
    it(`${new URL(url).hostname} → ${label}`, () => {
      expect(applySystem(url)).toEqual(expect.objectContaining({ label, named }));
    });
  }

  it("a host that only CONTAINS a vendor's name is not that vendor", () => {
    expect(applySystem("https://notgreenhouse.io.example.com/x")?.named).toBe(false);
    expect(applySystem("https://lever.co.evil.example/x")?.label).toBe("lever.co.evil.example");
  });

  it("a value that is not an http(s) URL names nothing", () => {
    for (const v of [null, undefined, "", "   ", "mailto:jobs@acme.com", "javascript:alert(1)", "not a url"]) {
      expect(applySystem(v as string | null)).toBeNull();
    }
  });

  it("every named source label is the vendor table's own spelling, and an unknown source is null, never the raw value", () => {
    for (const v of ALL_BOARD_SOURCES) expect(systemLabel(v.key)).toBe(v.label);
    expect(systemLabel("adp_wfn")).toBeNull();
    expect(systemLabel("constructor"), "an inherited object key is not a source").toBeNull();
  });
});

describe("the Workday '/apply' strip, and only there", () => {
  const table: Array<[string, string, string]> = [
    ["Workday", "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Austin/Engineer_R123/apply", "https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/Austin/Engineer_R123"],
    ["Workday, trailing slash", "https://acme.wd1.myworkdayjobs.com/External/job/Remote/Analyst_R9/apply/", "https://acme.wd1.myworkdayjobs.com/External/job/Remote/Analyst_R9"],
    ["Workday, query kept", "https://acme.wd1.myworkdayjobs.com/External/job/X/Y_R1/apply?source=LinkedIn", "https://acme.wd1.myworkdayjobs.com/External/job/X/Y_R1?source=LinkedIn"],
    ["Workday, no /apply", "https://acme.wd1.myworkdayjobs.com/External/job/X/Y_R1", "https://acme.wd1.myworkdayjobs.com/External/job/X/Y_R1"],
    ["Workday, /apply mid-path", "https://acme.wd1.myworkdayjobs.com/apply/job/X", "https://acme.wd1.myworkdayjobs.com/apply/job/X"],
    ["Greenhouse", "https://boards.greenhouse.io/acme/jobs/4012345/apply", "https://boards.greenhouse.io/acme/jobs/4012345/apply"],
    ["Lever", "https://jobs.lever.co/acme/1b2c/apply", "https://jobs.lever.co/acme/1b2c/apply"],
    ["Ashby", "https://jobs.ashbyhq.com/acme/abc/application", "https://jobs.ashbyhq.com/acme/abc/application"],
    ["SmartRecruiters", "https://jobs.smartrecruiters.com/Acme/7444/apply", "https://jobs.smartrecruiters.com/Acme/7444/apply"],
    ["Breezy", "https://acme.breezy.hr/p/abc-engineer/apply", "https://acme.breezy.hr/p/abc-engineer/apply"],
    ["JazzHR", "https://acme.applytojob.com/apply/abc/Engineer", "https://acme.applytojob.com/apply/abc/Engineer"],
    ["Workday site (myworkdaysite.com)", "https://wd3.myworkdaysite.com/recruiting/acme/External/job/X/apply", "https://wd3.myworkdaysite.com/recruiting/acme/External/job/X/apply"],
    ["Employer's own site", "https://careers.example.com/jobs/1/apply", "https://careers.example.com/jobs/1/apply"],
  ];
  for (const [vendor, input, expected] of table) {
    it(vendor, () => expect(cleanApplyUrl(input)).toBe(expected));
  }
  it("an empty link, or one that is not http(s), is no link", () => {
    expect(cleanApplyUrl(null)).toBeNull();
    expect(cleanApplyUrl("  ")).toBeNull();
    expect(cleanApplyUrl("javascript:alert(1)")).toBeNull();
    expect(cleanApplyUrl("mailto:jobs@acme.com")).toBeNull();
  });
});
