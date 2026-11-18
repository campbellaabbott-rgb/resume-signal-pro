// @vitest-environment node
/**
 * AN EMPLOYER'S END DATE OUTLIVES A FAILED READ (SEO audit 2026-11-18,
 * STRUCTURED-M1).
 *
 * What an employer states (its end date, its time type, a fully remote flag)
 * applied only in a bake whose read of the employer succeeded; the ledger
 * kept none of it. Marriott Oracle 26110535: Oracle's ExternalPostedEndDate is
 * 2026-11-19T05:51Z (read 2026-11-15), and the 11-15 bake served validThrough
 * 11-18 and FULL_TIME. The 11-18 bake's read came back unknown, and the page
 * served validThrough 2026-12-15 (datePosted + 30) and no employmentType: from
 * 11-19 a posting past its employer's own end, with live markup.
 *
 * The live ledger entry now carries the statements (withStatedEntry), a
 * later bake whose read fails applies them (askEmployersAbout's carriedOf),
 * validThrough never moves past the carried end without a fresh read stating
 * a later one, and a bake after that end retires the page with basis
 * "employer-stated end": noindex, no JobPosting, never in the sitemap.
 *
 * Bake 1 replays Oracle's answer recorded 2026-11-15 (seo-check-2026-11-15,
 * trimmed to the fields read); the site's own list naming the requisition is
 * built for the replay, since only the finder's answer was recorded.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { readFileSync as readSource } from "node:fs";
import { askEmployersAbout, employerEndedStub, withStatedEntry } from "../../scripts/prerender-seo.mjs";
import { postingStubEntry, postingStubPage } from "../../scripts/prerender-pages.mjs";
import * as statements from "../../scripts/employer-statements.mjs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";

const D = { ...companyDisplay, ...postingPage };
// employer-statements.d.mts (outside this lane's files) declares the page's
// half of the module; the bake's helpers are read untyped.
type Stated = Record<string, unknown> | null;
const { withCarriedStatements } = statements as unknown as { withCarriedStatements: (fresh: Stated, carried: Stated, read: string) => Stated };
const FIX = resolve(__dirname, "fixtures/employer-reads");
const rec = (name: string) => readFileSync(resolve(FIX, name), "utf8");
const HOST = "ejwl.fa.us2.oraclecloud.com";
const FINDER = `https://${HOST}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=${encodeURIComponent('ById;Id="26110535",siteNumber=CX')}`;
const SITE_LIST = `https://${HOST}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=${encodeURIComponent("findReqs;siteNumber=CX,keyword=26110535,limit=25")}`;

const ROW = {
  id: "oracle:ejwl~us2~CX:26110535",
  source: "oracle",
  token: "ejwl~us2~CX",
  title: "F&B Service Expert (Executive Lounge)",
  company: "Marriott",
  location: "Doha, Qatar",
  country: "QA",
  postedAt: "2026-11-15T05:51:15+00:00",
  applyUrl: "https://ejwl.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX/job/26110535",
};
const DESCRIPTION = "POSITION SUMMARY\nOur jobs aren't just about putting food on the table that our guests will enjoy until they ask for their bill. Instead, we want to build an experience that is memorable and unique, with food and drinks on the side. Our Guest Service Experts take the initiative and deliver a wide range of services to make sure that guests enjoy their meal.";
const PATH = "/jobs/posting/oracle/ejwl~us2~CX/26110535";

type Reply = { status: number; body: string };
const replay = (table: Record<string, Reply>) => {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => {
    asked.push(url);
    const a = table[url] ?? { status: 429, body: "" };
    return { status: a.status, url, text: async () => a.body, headers: { get: () => null } };
  };
  return { fetchImpl, asked };
};
const ORACLE_OPEN = { [FINDER]: { status: 200, body: rec("oracle-marriott-26110535-200.json") }, [SITE_LIST]: { status: 200, body: rec("oracle-marriott-26110535-site-CX-built.json") } };
const UNREAD = {}; // every request answers 429, which the reader asks once more and records unknown

async function bake(today: string, table: Record<string, Reply>, carried: unknown) {
  const f = replay(table);
  const item = { job: { ...ROW }, description: DESCRIPTION, carried: true, first: "2026-11-15" };
  const out = await askEmployersAbout([item], {
    D, deadline: Date.now() + 10_000, today,
    readOpts: { fetchImpl: f.fetchImpl, retryDelayMs: 1 },
    carriedOf: (job: { id: string }) => (D.postingPagePath(job.id) === PATH ? carried : null),
  });
  return { ...out, asked: f.asked };
}
/** The live entry the bake writes (its literal, then withStatedEntry). */
const liveEntry = (job: typeof ROW, stated: unknown) => withStatedEntry({ state: "live", since: "2026-11-15", first: "2026-11-15", carried: true, title: ROW.title, company: "Marriott", token: job.token ?? null, applyUrl: job.applyUrl }, stated);
const markupOn = (job: unknown, day: string) => D.postingJsonLd(job as never, DESCRIPTION, { site: "https://resumebooster.work", now: new Date(`${day}T12:00:00Z`) }) as Record<string, unknown> | null;

describe("Marriott 26110535 across three bakes", () => {
  it("bake 1 (11-15) reads Oracle: validThrough 11-18 and FULL_TIME, and the ledger entry keeps them", async () => {
    const b1 = await bake("2026-11-15", ORACLE_OPEN, null);
    expect(b1.keep).toHaveLength(1);
    const ld = markupOn(b1.keep[0].job, "2026-11-15");
    expect(String(ld?.validThrough)).toMatch(/^2026-11-18/);
    expect(ld?.employmentType).toBe("FULL_TIME");
    const entry = liveEntry(b1.keep[0].job, b1.keep[0].stated);
    expect(entry.stated).toEqual({ employerValidThrough: "2026-11-18", employmentType: "Full time" });
    expect(entry).toMatchObject({ state: "live", applyUrl: ROW.applyUrl, token: ROW.token });
    // The bake writes its entry through withStatedEntry.
    const src = readSource(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/postingLedger\[path\] = withStatedEntry\(postingLedger\[path\], stated\);/);
  });

  it("bake 2 (11-18) cannot read Oracle and keeps validThrough 11-18 and FULL_TIME from the ledger", async () => {
    const b1 = await bake("2026-11-15", ORACLE_OPEN, null);
    const entry = liveEntry(b1.keep[0].job, b1.keep[0].stated);
    const b2 = await bake("2026-11-18", UNREAD, JSON.parse(JSON.stringify(entry)).stated);
    expect(b2.asked.length).toBeGreaterThan(0);
    expect(b2.keep).toHaveLength(1);
    const ld = markupOn(b2.keep[0].job, "2026-11-18");
    expect(String(ld?.validThrough)).toMatch(/^2026-11-18/);
    expect(String(ld?.validThrough)).not.toMatch(/^2026-12-15/);
    expect(ld?.employmentType).toBe("FULL_TIME");
    // And the statements ride on to the next ledger entry.
    expect(liveEntry(b2.keep[0].job, b2.keep[0].stated).stated)
      .toEqual({ employerValidThrough: "2026-11-18", employmentType: "Full time" });
  });

  it("a bake on 11-20 retires the page: noindex, no JobPosting, never in the sitemap", async () => {
    const b3 = await bake("2026-11-20", UNREAD, { employerValidThrough: "2026-11-18", employmentType: "Full time" });
    expect(b3.keep).toHaveLength(0);
    expect(b3.ended).toHaveLength(1);
    const stub = employerEndedStub(b3.ended[0].job, D);
    expect(stub).toMatchObject({ path: PATH, state: "gone", basis: "employer-stated end" });
    const e = postingStubEntry({ stub, prior: { state: "live" }, today: "2026-11-20", employerName: (_t: unknown, n: string) => n, tokenOf: () => ROW.token });
    expect(e).toMatchObject({ state: "gone", basis: "employer-stated end", since: "2026-11-20" });
    const page = postingStubPage({ path: PATH, id: ROW.id, state: "gone", since: e.since, title: ROW.title, company: "Marriott", companyLink: "", windowDays: 30, basis: e.basis, esc: (x: string) => x });
    expect(page.robots).toBe("noindex, follow");
    expect("jsonLd" in page).toBe(false);
    expect(page.content).toMatch(/past the closing date its employer stated/);
    expect(page.content).not.toMatch(/That is a statement about this board/);
  });
});

describe("the end date moves later only on a fresh statement", () => {
  const carried = { employerValidThrough: "2026-11-18", employmentType: "Full time", remote: true };
  it("an open read stating a later end moves it; one stating none keeps the carried end", () => {
    expect(withCarriedStatements({ employerValidThrough: "2026-11-25" }, carried, "open")?.employerValidThrough).toBe("2026-11-25");
    expect(withCarriedStatements({ employmentType: "Part time" }, carried, "open")).toEqual({ employerValidThrough: "2026-11-18", employmentType: "Part time" });
  });
  it("an unknown read keeps the carried end, time type and remote flag; an open one is the employer's word on the last two", () => {
    expect(withCarriedStatements(null, carried, "unknown")).toEqual(carried);
    expect(withCarriedStatements({}, carried, "open")).toEqual({ employerValidThrough: "2026-11-18" });
  });
  it("with nothing carried, today's answer stands as it did", () => {
    expect(withCarriedStatements({ employmentType: "Full time" }, null, "open")).toEqual({ employmentType: "Full time" });
    expect(withCarriedStatements(null, null, "unknown")).toBeNull();
  });
});
