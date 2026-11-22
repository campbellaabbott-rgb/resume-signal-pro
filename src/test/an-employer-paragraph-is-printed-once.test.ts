// @vitest-environment node
/**
 * AN EMPLOYER'S PARAGRAPH IS PRINTED ONCE (SEO audit 2026-11-18,
 * STRUCTURED-3).
 *
 * Some feeds hand the board one body twice. keo 12843 (iCIMS) served its
 * paragraphs 6-30 again as 40-63, and Mobileye 0d17f0b5 (Lever) its whole
 * body twice, on the page and in the JobPosting's description alike: 25 of the
 * 500 served descriptions were a tenth or more repeated text. jdTextOnce drops
 * a later copy of a line of 80 characters or more, and jdParagraphs (the
 * page) and postingJsonLdShape (the markup) both read it.
 *
 * The corpus is the 500 posting pages served on 18 Nov
 * (fixtures/served-postings-2026-11-18.json.gz: each page's description as
 * its markup or, with none, its paragraphs printed it). Every description
 * jdTextOnce leaves alone is main's text byte for byte, and the 35 it changes
 * are listed below, each read by hand: a section or a body pasted twice, or a
 * boilerplate line printed at the top and again at the end.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { resolve } from "node:path";
import * as postingPage from "@/components/jobs/posting-page";
import type { PostingRow } from "@/components/jobs/posting-page";

type Served = { path: string; id: string; source: string; token: string; title: string; company: string; location: string | null; country: string | null; postedAt: string; description: string };
const SERVED: Served[] = JSON.parse(gunzipSync(readFileSync(resolve(__dirname, "fixtures/served-postings-2026-11-18.json.gz"))).toString("utf8"));
const byPath = (p: string) => {
  const r = SERVED.find((x) => x.path === p);
  if (!r) throw new Error(`no served page ${p}`);
  return r;
};
const { jdText, jdParagraphs, postingJsonLdShape } = postingPage;
// Read through the namespace so this file runs (and fails) on a main that has none.
const jdTextOnce = (d: string): string => {
  const f = (postingPage as unknown as { jdTextOnce?: (d: string) => string }).jdTextOnce;
  if (typeof f !== "function") throw new Error("posting-page exports no jdTextOnce");
  return f(d);
};

const KEO = "/jobs/posting/icims/careers.keo.com/12843";
const MOBILEYE = "/jobs/posting/lever/eu~mobileye/0d17f0b5-29db-4e7e-8688-08f69d91ad0f";

const rowOf = (r: Served): PostingRow => ({
  id: r.id, source: r.source, token: r.token, title: r.title, company: r.company,
  location: r.location, country: r.country, postedAt: `${r.postedAt}T00:00:00Z`,
  applyUrl: null, salary: null, agency: false, workMode: null, missingSince: null,
} as unknown as PostingRow);
const markupOf = (r: Served) => {
  const ld = postingJsonLdShape(rowOf(r), r.description, { site: "https://resumebooster.work", now: new Date(`${r.postedAt}T12:00:00Z`) });
  expect(ld, `${r.path} has markup`).not.toBeNull();
  return String(ld!.description);
};
const times = (text: string, needle: string) => text.split(needle).length - 1;

describe("the two pages the audit names", () => {
  it("keo 12843 prints its procurement paragraphs once, on the page and in the markup", () => {
    const r = byPath(KEO);
    const needle = "Developing and implementing procurement strategies, policies, and procedures";
    expect(times(jdText(r.description), needle), "the served text has two copies").toBe(2);
    expect(times(jdParagraphs(r.description).join("\n\n"), needle)).toBe(1);
    expect(times(markupOf(r), needle)).toBe(1);
    // iCIMS's second copy spells the apostrophe straight; it is still a copy.
    expect(times(jdParagraphs(r.description).join("\n\n"), "procurement and supply chain operations, ensuring cost efficienc")).toBe(1);
    // Nothing the employer said only once is lost.
    expect(jdParagraphs(r.description).join("\n")).toContain("Professional certifications such as CPP, CPPM, CISCP, CISCM");
  });

  it("Mobileye 0d17f0b5 prints its body once", () => {
    const r = byPath(MOBILEYE);
    for (const needle of ["Join PUMA, the team developing", "We are looking for an ML Data Engineer"]) {
      expect(times(jdText(r.description), needle)).toBe(2);
      expect(times(jdParagraphs(r.description).join("\n\n"), needle), needle).toBe(1);
      expect(times(markupOf(r), needle), needle).toBe(1);
    }
    expect(jdParagraphs(r.description)).toHaveLength(2);
  });
});

describe("a line repeated legitimately stays", () => {
  it("a short heading or bullet, a rule of underscores, and an item a list repeats under three headings", () => {
    const rule = "_".repeat(84);
    const bullets = `Requirements:\n• Python\n\nNice to have:\n• Python\n${rule}\nText\n${rule}`;
    expect(jdTextOnce(bullets)).toBe(bullets);
    const item = "Required competencies to include demonstration of regularly being a charge nurse and/or precepting new staff";
    const levels = `Level 3\n${item}\nLevel 4\n${item}\nLevel 5\n${item}`;
    expect(jdTextOnce(levels)).toBe(levels);
  });
});

describe("the 500 served descriptions", () => {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  /** The audit's measure: the share of the text in lines of 80+ characters that repeat an earlier one. */
  const repeatedShare = (t: string) => {
    const seen = new Set<string>();
    let rep = 0;
    for (const l of t.split("\n")) {
      const k = norm(l);
      if (k.length < 80) continue;
      if (seen.has(k)) rep += k.length;
      else seen.add(k);
    }
    return rep / Math.max(1, norm(t).length);
  };
  const mainParagraphs = (d: string) => jdText(d).split(/\n\s*\n/).map((p) => p.replace(/[ \t]+\n/g, "\n").trim()).filter((p) => p.length > 0);
  const CHANGED = [
    "/jobs/posting/workday/gfs~wd5~usjobs-gen-gfs/R-58554",
    KEO,
    "/jobs/posting/icims/careers.acentra.com/5584",
    "/jobs/posting/icims/careers.giraffe.ie/31681",
    "/jobs/posting/icims/careers.giraffe.ie/31676",
    "/jobs/posting/icims/careers.giraffe.ie/31636",
    "/jobs/posting/lever/cscgeneration-2/6ba84940-1aeb-43f7-98f5-b85255d07b85",
    "/jobs/posting/lever/cscgeneration-2/56772d99-044f-4631-9bec-db3390ef53ae",
    "/jobs/posting/lever/cscgeneration-2/75feabb7-9945-45e1-bd92-439a28bb33e5",
    "/jobs/posting/lever/cscgeneration-2/513ef679-c7f3-40ef-95dc-57136b29a7ad",
    "/jobs/posting/lever/cscgeneration-2/3913da2b-c9ef-4adb-9e16-f4db7dfdcc36",
    "/jobs/posting/lever/cscgeneration-2/ba809fc6-425f-4b55-853e-ce1cda60f25d",
    "/jobs/posting/workday/clearchanneloutdoor~wd5~CCO/Req24129",
    "/jobs/posting/workday/clearchanneloutdoor~wd5~CCO/Req24134",
    MOBILEYE,
    "/jobs/posting/lever/eu~mobileye/8b04e895-56c8-453d-a810-7311ed7f823f",
    "/jobs/posting/workday/zrsmanagement~wd5~ZRS_Careers/R-108666",
    "/jobs/posting/workday/wf~wd1~wellsfargojobs/R-583779",
    "/jobs/posting/workday/adobe~wd5~external_experienced/R173021",
    "/jobs/posting/icims/careers.ulta.com/561886",
    "/jobs/posting/icims/careers.primehealthcare.com/284056",
    "/jobs/posting/oracle/eiqg~us2~CX_1/173813",
    "/jobs/posting/icims/www.genesiscareers.jobs/57988",
    "/jobs/posting/smartrecruiters/AbbVie/3743990016864056",
    "/jobs/posting/icims/careers.matrixmedicalnetwork.com/32045",
    "/jobs/posting/icims/jobs.trilogyhs.com/216221",
    "/jobs/posting/icims/careers.callnorthwest.com/56011",
    "/jobs/posting/icims/jobs.ynhhs.org/92685",
    "/jobs/posting/icims/talent.urbn.com/40972",
    "/jobs/posting/icims/talent.brightspringhealth.com/202021",
    "/jobs/posting/icims/careers.amd.com/96252",
    "/jobs/posting/icims/jobs.ardenthealth.com/142961",
    "/jobs/posting/icims/jobs.ardenthealth.com/143414",
    "/jobs/posting/workday/jj~wd5~JJ/R-107893-1",
    "/jobs/posting/icims/jobs.ufhealth.org/69062",
  ];

  it("is 500 pages, 25 of them a tenth or more repeated text as served", () => {
    expect(SERVED).toHaveLength(500);
    expect(SERVED.filter((r) => repeatedShare(jdText(r.description)) >= 0.1)).toHaveLength(25);
  });

  it("none is a tenth repeated once printed, on the page or in the markup's text", () => {
    expect(SERVED.filter((r) => repeatedShare(jdParagraphs(r.description).join("\n\n")) >= 0.1).map((r) => r.path)).toEqual([]);
    expect(SERVED.filter((r) => repeatedShare(jdTextOnce(r.description)) >= 0.1).map((r) => r.path)).toEqual([]);
  });

  it("changes exactly the 35 read by hand, and every other description is main's, byte for byte (never worse)", () => {
    const changed = SERVED.filter((r) => jdTextOnce(r.description) !== jdText(r.description)).map((r) => r.path);
    expect(changed).toEqual(CHANGED);
    for (const r of SERVED) {
      if (CHANGED.includes(r.path)) continue;
      expect(jdParagraphs(r.description), r.path).toEqual(mainParagraphs(r.description));
    }
  });

  it("loses no line the employer wrote: every distinct line of the served text is still printed", () => {
    const fold = (s: string) => norm(s).replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"');
    for (const path of CHANGED) {
      const r = byPath(path);
      const before = new Set(jdText(r.description).split("\n").map(fold).filter(Boolean));
      const after = new Set(jdParagraphs(r.description).join("\n").split("\n").map(fold).filter(Boolean));
      expect([...before].filter((k) => !after.has(k)), path).toEqual([]);
    }
  });
});
