// @vitest-environment node
/**
 * ORACLE, ADP, BREEZY AND RECRUITEE POSTINGS ARE ASKED OF THEIR EMPLOYERS
 * (SEO check 2026-11-15, F01, with the employer-read halves of F08 and F13).
 *
 * The bake's employer read (scripts/employer-reads.mjs) had no reader for
 * Oracle (36 live pages), ADP (16), Breezy (7) or Recruitee (3): 72 of the 490
 * marked-up pages were never checked, and two Oracle postings the employer had
 * already taken down (Kroger 216822, Caesars 91598) still served
 * 'index, follow' with job markup running to 7-8 December. Six more carried a
 * validThrough later than Oracle's own end date, and Oracle's schedule and
 * remote fields were never read.
 *
 * Every answer below is a RECORDED response (2026-11-15, GET only, at most one
 * request a second, trimmed to the fields read; src/test/fixtures/
 * employer-reads/), replayed through a fetch stub. Where a test needs an
 * answer the employers did not give that day, it says which recorded answer
 * it starts from and the one field it changes.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  READ_VENDORS,
  distrustImplausibleClosures,
  employerReadPlan,
  employerVerdict,
  readEmployers,
} from "../../scripts/employer-reads.mjs";
import { applyEmployerStatements, employerStatedOf } from "../../scripts/employer-statements.mjs";
import { askEmployersAbout, employerClosedStub } from "../../scripts/prerender-seo.mjs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";

const FIX = resolve(__dirname, "fixtures/employer-reads");
const rec = (name: string) => readFileSync(resolve(FIX, name), "utf8");
const D = { ...companyDisplay, ...postingPage };
const SITE = "https://resumebooster.work";
const DESC = "Join the team running the work this posting describes, with the duties, the hours and the requirements the employer set out in full. ".repeat(4);

type Answer = { status: number; body?: string; url?: string };
/** A fetch that answers each URL from recorded responses (anything else is a 599), and counts what it was asked. */
function recordedFetch(table: Record<string, Answer>) {
  const asked: string[] = [];
  const methods: string[] = [];
  const fetchImpl = async (url: string, init?: { method?: string }) => {
    asked.push(url);
    methods.push(init?.method ?? "GET");
    const a = table[url];
    if (!a) return { status: 599, url, text: async () => "" };
    return { status: a.status, url: a.url ?? url, text: async () => a.body ?? "" };
  };
  return { fetchImpl: fetchImpl as unknown as typeof fetch, asked, methods };
}

const ORACLE_DETAILS = "hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=";
const ADP_DETAIL = "https://workforcenow.adp.com/mascsr/default/careercenter/public/events/staffing/v1/job-requisitions/";

const ROWS = {
  kroger: { id: "oracle:eluq~us2~CX_1:216822", applyUrl: "https://eluq.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/216822" },
  caesars: { id: "oracle:edmn~us2~CX_1:91598", applyUrl: "https://edmn.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/91598" },
  dell: { id: "oracle:iawmqy~ocs~CX_1:299933", applyUrl: "https://iawmqy.fa.ocs.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1/job/299933" },
  inova: { id: "oracle:elar~us2~CX_14001:687069", applyUrl: "https://elar.fa.us2.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_14001/job/687069" },
  jpmc: { id: "oracle:jpmc~~CX_1001:210741860", applyUrl: "https://jpmc.fa.oraclecloud.com/hcmUI/CandidateExperience/en/sites/CX_1001/job/210741860" },
  adpOpen: { id: "adp:07372372-77a5-45e9-8573-f67327c3c3ec:9207315772373_1", applyUrl: "https://workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid=07372372-77a5-45e9-8573-f67327c3c3ec&ccId=19000101_000001&lang=en_US&jobId=574113" },
  adpGone: { id: "adp:6f977557-f6eb-4f25-922c-96f9b3a3ee19:9201318551534_1", applyUrl: null },
  adpCareerCenter: { id: "adp:2d93ec5f-f224-4220-aca4-a8bc7295609e~2478480903_6918:9201873830880_5", applyUrl: null },
  breezyOpen: { id: "breezy:almentor:cfddbc0293d6-senior-data-applied-ai-engineer", applyUrl: "https://almentor.breezy.hr/p/cfddbc0293d6-senior-data-applied-ai-engineer" },
  breezyOpen2: { id: "breezy:almentor:fa5f554bf662-senior-software-engineer-backend", applyUrl: "https://almentor.breezy.hr/p/fa5f554bf662-senior-software-engineer-backend" },
  breezyGone: { id: "breezy:almentor:8b23b761bdd9-senior-product-designer", applyUrl: null },
  recruiteeOpen: { id: "recruitee:rwg:2814168", applyUrl: null },
  recruiteeGone: { id: "recruitee:rwg:2796483", applyUrl: null },
};

const oracleUrl = (host: string, key: string, site: string) => `https://${host}/${ORACLE_DETAILS}${encodeURIComponent(`ById;Id="${key}",siteNumber=${site}`)}`;
const TABLE: Record<string, Answer> = {
  [oracleUrl("eluq.fa.us2.oraclecloud.com", "216822", "CX_1")]: { status: 200, body: rec("oracle-kroger-216822-empty.json") },
  [oracleUrl("edmn.fa.us2.oraclecloud.com", "91598", "CX_1")]: { status: 200, body: rec("oracle-caesars-91598-empty.json") },
  [oracleUrl("iawmqy.fa.ocs.oraclecloud.com", "299933", "CX_1")]: { status: 200, body: rec("oracle-dell-299933-200.json") },
  [oracleUrl("elar.fa.us2.oraclecloud.com", "687069", "CX_14001")]: { status: 200, body: rec("oracle-inova-687069-200.json") },
  [`${ADP_DETAIL}9207315772373_1?cid=07372372-77a5-45e9-8573-f67327c3c3ec&ccId=19000101_000001&lang=en_US&locale=en_US`]: { status: 200, body: rec("adp-07372372-9207315772373_1-200.json") },
  [`${ADP_DETAIL}9201318551534_1?cid=6f977557-f6eb-4f25-922c-96f9b3a3ee19&ccId=19000101_000001&lang=en_US&locale=en_US`]: { status: 200, body: rec("adp-6f977557-9201318551534_1-200-empty.json") },
  "https://almentor.breezy.hr/json": { status: 200, body: rec("breezy-almentor-list.json") },
  "https://rwg.recruitee.com/api/offers/": { status: 200, body: rec("recruitee-rwg-offers.json") },
};

const read = async (rows: Array<{ id: string; applyUrl: string | null }>, table = TABLE) => {
  const f = recordedFetch(table);
  const out = await readEmployers(rows, { fetchImpl: f.fetchImpl, retryDelayMs: 1 });
  return { out, f };
};
const one = async (row: { id: string; applyUrl: string | null }) => (await read([row])).out.get(row.id)!;

describe("Oracle: the requisition is asked of the tenant's own recruiting API", () => {
  it("reads the ById finder with the requisition's site, as the report's evidence did (region-less hosts too)", () => {
    expect(employerReadPlan(ROWS.kroger).url).toBe(
      "https://eluq.fa.us2.oraclecloud.com/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?onlyData=true&finder=ById%3BId%3D%22216822%22%2CsiteNumber%3DCX_1",
    );
    expect(employerReadPlan(ROWS.jpmc).url).toBe(oracleUrl("jpmc.fa.oraclecloud.com", "210741860", "CX_1001"));
    // A token that could name another host, or a key that could break out of the finder, is not read.
    expect(employerReadPlan({ id: "oracle:evil.example~us2~CX_1:1", applyUrl: null }).url).toBeNull();
    expect(employerReadPlan({ id: "oracle:eluq~us2~CX_1:1\",siteNumber=CX_2", applyUrl: null }).url).toBeNull();
    expect(READ_VENDORS).toEqual(expect.arrayContaining(["oracle", "adp", "breezy", "recruitee"]));
  });

  it("Kroger 216822 and Caesars 91598: an empty answer is closed, and the bake gives each the noindex stub", async () => {
    const { out } = await read([ROWS.kroger, ROWS.caesars]);
    expect(out.get(ROWS.kroger.id)).toMatchObject({ vendor: "oracle", state: "closed" });
    expect(out.get(ROWS.caesars.id)).toMatchObject({ vendor: "oracle", state: "closed" });
    const job = { ...ROWS.kroger, title: "Pharmacy Technician", company: "Kroger", token: "eluq~us2~CX_1", source: "oracle", location: "Cincinnati, OH, United States", country: "US", postedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(), missingSince: null, agency: false };
    const f = recordedFetch(TABLE);
    const { keep, closed } = await askEmployersAbout([{ job, description: DESC }], { D, deadline: Date.now() + 5000, readOpts: { fetchImpl: f.fetchImpl, retryDelayMs: 1 } });
    expect(keep).toHaveLength(0);
    expect(employerClosedStub(closed[0].job, D)).toMatchObject({ state: "gone", basis: "employer", path: "/jobs/posting/oracle/eluq~us2~CX_1/216822" });
  });

  it("Dell 299933: open, Full time, India, and its end date ends the window on the last whole day before Oracle's end instant", async () => {
    const r = await one(ROWS.dell);
    expect(r.state).toBe("open");
    // ExternalPostedEndDate 2026-12-09T18:30:00+00:00 is midnight in Bengaluru;
    // 23:59:59 UTC on the 9th would run past it, so the window ends on the 8th.
    expect(r.stated).toMatchObject({ employerValidThrough: "2026-12-08", employmentType: "Full time", country: "IN" });
    // ORA_REMOTE is labelled "Field" by this employer (a role run in customer
    // data centres): not fully remote, so never TELECOMMUTE.
    expect(r.stated.remote).toBeUndefined();
  });

  it("Inova 687069: Oracle's end date (5:00 UTC on the 17th, midnight in Virginia) shortens the markup's window, and Part time is PART_TIME", async () => {
    const r = await one(ROWS.inova);
    expect(r.stated).toMatchObject({ employerValidThrough: "2026-11-16", employmentType: "Part time", country: "US" });
    const row = { id: ROWS.inova.id, title: "Clinical Technician 1 - Acute Care Unit", company: "Inova", token: "elar~us2~CX_14001", source: "oracle", location: "Leesburg, VA, United States", country: "US", postedAt: "2026-11-15T00:00:00.000Z", missingSince: null, agency: false, applyUrl: ROWS.inova.applyUrl };
    const now = new Date("2026-11-15T18:00:00Z");
    const before = postingPage.postingJsonLd(row, DESC, { site: SITE, now })!;
    expect(before.validThrough).toBe("2026-12-15T23:59:59+00:00");
    const after = postingPage.postingJsonLd(postingPage.postingWithEmployerStatements(row, r.stated), DESC, { site: SITE, now })!;
    expect(after).toMatchObject({ validThrough: "2026-11-16T23:59:59+00:00", employmentType: "PART_TIME" });
    // On the 17th the posting is no longer live, so no page marks it up.
    expect(postingPage.isPostingLive(postingPage.postingWithEmployerStatements(row, r.stated), new Date("2026-11-17T01:00:00Z"))).toBe(false);
  });

  it("ORA_REMOTE labelled as remote is a fully remote posting (Dell's recorded answer, its label changed to 'Remote')", () => {
    const j = JSON.parse(rec("oracle-dell-299933-200.json"));
    j.items[0].WorkplaceType = "Remote";
    const v = employerVerdict(employerReadPlan(ROWS.dell), { status: 200, url: "", body: JSON.stringify(j) }, ROWS.dell);
    expect(v.stated.remote).toBe(true);
    j.items[0].WorkplaceType = "Hybrid";
    expect(employerVerdict(employerReadPlan(ROWS.dell), { status: 200, url: "", body: JSON.stringify(j) }, ROWS.dell).stated.remote).toBeUndefined();
    j.items[0] = { ...j.items[0], WorkplaceType: "On-site", WorkplaceTypeCode: "ORA_ON_SITE" };
    expect(employerVerdict(employerReadPlan(ROWS.dell), { status: 200, url: "", body: JSON.stringify(j) }, ROWS.dell).stated.remote).toBeUndefined();
  });

  it("a refusal, a 404, or an answer naming another requisition is unknown", () => {
    const plan = employerReadPlan(ROWS.dell);
    expect(employerVerdict(plan, { status: 404, url: "", body: "" }, ROWS.dell).state).toBe("unknown");
    expect(employerVerdict(plan, { status: 503, url: "", body: "" }, ROWS.dell).state).toBe("unknown");
    expect(employerVerdict(plan, { status: 200, url: "", body: "<html>maintenance</html>" }, ROWS.dell).state).toBe("unknown");
    expect(employerVerdict(plan, { status: 200, url: "", body: rec("oracle-inova-687069-200.json") }, ROWS.dell).state).toBe("unknown");
  });

  it("an Oracle tenant whose every read (three or more) said closed is not trusted", () => {
    const m = new Map<string, { id: string; vendor: string; state: string; why: string; stated: object }>();
    for (let i = 0; i < 3; i++) m.set(`oracle:blocked~us2~CX_1:${i}`, { id: `oracle:blocked~us2~CX_1:${i}`, vendor: "oracle", state: "closed", why: "", stated: {} });
    m.set("oracle:eluq~us2~CX_1:216822", { id: "oracle:eluq~us2~CX_1:216822", vendor: "oracle", state: "closed", why: "", stated: {} });
    m.set("oracle:eluq~us2~CX_1:216823", { id: "oracle:eluq~us2~CX_1:216823", vendor: "oracle", state: "open", why: "", stated: {} });
    for (let i = 0; i < 6; i++) m.set(`oracle:t${i}~us2~CX_1:${i}`, { id: `oracle:t${i}~us2~CX_1:${i}`, vendor: "oracle", state: "open", why: "", stated: {} });
    const out = distrustImplausibleClosures(m);
    expect(out.get("oracle:blocked~us2~CX_1:0")!.state).toBe("unknown");
    expect(out.get("oracle:eluq~us2~CX_1:216822")!.state).toBe("closed");
  });
});

describe("ADP: the requisition is asked of Workforce Now's public career-center endpoint", () => {
  it("reads the board's own detail address, with the career center the token names or the default one", () => {
    expect(employerReadPlan(ROWS.adpOpen).url).toBe(`${ADP_DETAIL}9207315772373_1?cid=07372372-77a5-45e9-8573-f67327c3c3ec&ccId=19000101_000001&lang=en_US&locale=en_US`);
    expect(employerReadPlan(ROWS.adpCareerCenter).url).toBe(`${ADP_DETAIL}9201873830880_5?cid=2d93ec5f-f224-4220-aca4-a8bc7295609e&ccId=2478480903_6918&lang=en_US&locale=en_US`);
    expect(employerReadPlan({ id: "adp:not-a-client:1_1", applyUrl: null }).url).toBeNull();
  });

  it("an answer naming the requisition is open; the empty requisition ADP serves for one it no longer lists is closed", async () => {
    const { out, f } = await read([ROWS.adpOpen, ROWS.adpGone]);
    expect(out.get(ROWS.adpOpen.id)).toMatchObject({ vendor: "adp", state: "open" });
    expect(out.get(ROWS.adpGone.id)).toMatchObject({ vendor: "adp", state: "closed" });
    expect(new Set(f.methods)).toEqual(new Set(["GET"]));
  });

  it("a 404 (an address ADP does not know: a client id that is not one) is unknown, not closed", () => {
    const plan = employerReadPlan(ROWS.adpOpen);
    const body = "<html><head><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>openresty</center></body></html>";
    expect(employerVerdict(plan, { status: 404, url: "", body }, ROWS.adpOpen).state).toBe("unknown");
    expect(employerVerdict(plan, { status: 200, url: "", body: "not json" }, ROWS.adpOpen).state).toBe("unknown");
  });
});

describe("Breezy and Recruitee: one read of the employer's whole list per board", () => {
  it("an id the board still lists is open and one missing from it is closed (almentor's three takedowns, rwg 2796483)", async () => {
    const { out, f } = await read([ROWS.breezyOpen, ROWS.breezyOpen2, ROWS.breezyGone, ROWS.recruiteeOpen, ROWS.recruiteeGone]);
    expect(out.get(ROWS.breezyOpen.id)).toMatchObject({ vendor: "breezy", state: "open" });
    expect(out.get(ROWS.breezyOpen2.id)).toMatchObject({ vendor: "breezy", state: "open" });
    expect(out.get(ROWS.breezyGone.id)).toMatchObject({ vendor: "breezy", state: "closed" });
    expect(out.get(ROWS.recruiteeOpen.id)).toMatchObject({ vendor: "recruitee", state: "open" });
    expect(out.get(ROWS.recruiteeGone.id)).toMatchObject({ vendor: "recruitee", state: "closed" });
    expect(f.asked.filter((u) => u === "https://almentor.breezy.hr/json")).toHaveLength(1);
    expect(f.asked.filter((u) => u === "https://rwg.recruitee.com/api/offers/")).toHaveLength(1);
  });

  it("a Breezy row stored under the bare id still finds its position", async () => {
    expect((await one({ id: "breezy:almentor:cfddbc0293d6", applyUrl: null })).state).toBe("open");
  });

  it("a list that names nothing, or a refusal, says nothing about one posting", async () => {
    const empty = { "https://almentor.breezy.hr/json": { status: 200, body: "[]" }, "https://rwg.recruitee.com/api/offers/": { status: 200, body: JSON.stringify({ offers: [] }) } };
    const { out } = await read([ROWS.breezyGone, ROWS.recruiteeGone], empty);
    expect(out.get(ROWS.breezyGone.id)!.state).toBe("unknown");
    expect(out.get(ROWS.recruiteeGone.id)!.state).toBe("unknown");
    expect((await read([ROWS.breezyGone], { "https://almentor.breezy.hr/json": { status: 403, body: "" } })).out.get(ROWS.breezyGone.id)!.state).toBe("unknown");
    // A board name that is not a bare subdomain is never asked.
    expect(employerReadPlan({ id: "breezy:evil.example/x:1", applyUrl: null }).url).toBeNull();
  });
});

describe("F13: a workload percentage is not a fully remote posting", () => {
  it("Swisscom R-0006822: Workday's remoteType '80-100%' gives no TELECOMMUTE", () => {
    const row = { id: "workday:swisscom~wd103~SwisscomExternalCareers:R-0006822", applyUrl: "https://swisscom.wd103.myworkdayjobs.com/en-US/SwisscomExternalCareers/job/Zurich/Technical-Lead-for-IoT-Gateway-as-a-Service_R-0006822" };
    const v = employerVerdict(employerReadPlan(row), { status: 200, url: "", body: rec("workday-swisscom-R-0006822-200.json") }, row);
    expect(v.state).toBe("open");
    expect(v.stated.remote).toBeUndefined();
    const job = postingPage.postingWithEmployerStatements({ id: row.id, title: "Technical Lead for IoT Gateway as a Service", company: "Swisscom", token: "swisscom~wd103~SwisscomExternalCareers", source: "workday", location: "Zurich", country: "CH", postedAt: "2026-10-25T00:00:00.000Z", missingSince: null, agency: false }, v.stated);
    const ld = postingPage.postingJsonLd(job, DESC, { site: SITE, now: new Date("2026-11-15T12:00:00Z") })!;
    expect(ld.jobLocationType).toBeUndefined();
  });
});

describe("F08: a Workday posting whose employer places it in another country keeps no address of ours", () => {
  const UPS = { id: "workday:hcmportal~wd5~Search:R26040621", applyUrl: "https://hcmportal.wd5.myworkdayjobs.com/en-US/Search/job/AR---BUENOS-AIRES-ARBUO/Export-Supervisor-Marken_R26040621" };
  const row = { id: UPS.id, title: "Export Supervisor Marken", company: "UPS", token: "hcmportal~wd5~Search", source: "workday", location: "AR - BUENOS AIRES (ARBUO)", country: "US", postedAt: "2026-11-06T00:00:00.000Z", missingSince: null, agency: false, applyUrl: UPS.applyUrl };
  const now = new Date("2026-11-15T12:00:00Z");

  it("UPS R26040621: Workday states Argentina, and the markup that said Arkansas, US is withheld", () => {
    const v = employerVerdict(employerReadPlan(UPS), { status: 200, url: "", body: rec("workday-ups-R26040621-200.json") }, UPS);
    expect(v.stated).toMatchObject({ country: "AR", employerValidThrough: "2026-11-27", employmentType: "Full time" });
    // Before: the row's own country put the job in Arkansas.
    const before = postingPage.postingJsonLd(row, DESC, { site: SITE, now })!;
    expect((before.jobLocation as { address: Record<string, string> }).address).toMatchObject({ addressCountry: "US", addressRegion: "AR" });
    // After: the employer's country disagrees with ours, so no job markup.
    const job = postingPage.postingWithEmployerStatements(row, v.stated);
    expect(postingPage.postingCountryMismatch(job)).toBe(true);
    expect(postingPage.postingJsonLd(job, DESC, { site: SITE, now })).toBeNull();
    // The country is the only thing in the way, so a carried page keeps its page without markup (D7).
    expect(postingPage.postingJsonLdShape(job, DESC, { site: SITE, now, ignoreCountryMismatch: true })).not.toBeNull();
  });

  it("an employer country that agrees with ours, or governs it, changes nothing", () => {
    const allstate = { id: "workday:allstate~wd5~allstate_careers:R35646", applyUrl: "https://allstate.wd5.myworkdayjobs.com/en-US/allstate_careers/job/US---Remote/In-Memory-Database-Platform-Engineer_R35646" };
    const v = employerVerdict(employerReadPlan(allstate), { status: 200, url: "", body: rec("workday-allstate-200.json") }, allstate);
    expect(v.stated.country).toBe("US");
    expect(postingPage.postingCountryMismatch({ location: "San Juan", country: "PR", employerCountry: "US" })).toBe(false);
    expect(postingPage.postingCountryMismatch({ location: "Leesburg, VA", country: "US", employerCountry: "US" })).toBe(false);
  });

  it("the statement survives the head the bake writes, so the React page withholds the same markup", () => {
    expect(employerStatedOf({ country: "AR" })).toEqual({ country: "AR" });
    expect(employerStatedOf({ country: "Argentina" })).toBeNull();
    expect(applyEmployerStatements(row, { country: "AR" })).toMatchObject({ country: "US", employerCountry: "AR" });
  });
});
