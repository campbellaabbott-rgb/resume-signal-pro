// @vitest-environment node
/**
 * A POSTING ITS EMPLOYER TOOK DOWN LOSES ITS JOB MARKUP AT THE NEXT BAKE
 * (SEO/GEO audit 2026-11-07, B01: G4J-01, SD-01, F01).
 *
 * The bake's carry re-check asked the board's detail action, which reads our
 * stored row and never the employer. Measured 2026-11-07, about 7% of the 500
 * baked posting pages were already closed at the employer; on 2026-11-08 the
 * day's bake still baked Sanford R-0278723, Fresenius R0270716 and JCI
 * WD30282057 live while each employer's Workday answered 403 S22.
 *
 * Each vendor's answer below is a RECORDED response (2026-11-08, GET only,
 * trimmed to the fields read; src/test/fixtures/employer-reads/), replayed
 * through a fetch stub, and the bake's own decision is asked of it: a closed
 * row becomes the "no longer listed" page with basis "employer" (noindex, no
 * JobPosting, so never in the sitemap), and an unknown row keeps its page and
 * is counted.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  EMPLOYER_READ_CONCURRENCY,
  distrustImplausibleClosures,
  employerReadLine,
  employerReadPlan,
  readEmployers,
  summarizeEmployerReads,
} from "../../scripts/employer-reads.mjs";
import { askEmployersAbout, employerClosedStub } from "../../scripts/prerender-seo.mjs";
import { postingCarryBase, postingStubEntry, postingStubPage } from "../../scripts/prerender-pages.mjs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";

const FIX = resolve(__dirname, "fixtures/employer-reads");
const rec = (name: string) => readFileSync(resolve(FIX, name), "utf8");
const D = { ...companyDisplay, ...postingPage };

type Answer = { status: number; body?: string; url?: string } | { throws: string } | { hang: true };
/** A fetch that answers each URL from a table of recorded responses, and counts what it was asked. */
function recordedFetch(table: Record<string, Answer>) {
  const asked: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const methods: string[] = [];
  const fetchImpl = async (url: string, init?: { method?: string; signal?: AbortSignal }) => {
    asked.push(url);
    methods.push(init?.method ?? "GET");
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const a = table[url];
      await new Promise((r) => setTimeout(r, 5));
      if (!a) return { status: 599, url, text: async () => "" };
      if ("throws" in a) throw new Error(a.throws);
      if ("hang" in a) {
        return await new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("timeout"), { name: "TimeoutError" }))));
      }
      return { status: a.status, url: a.url ?? url, text: async () => a.body ?? "" };
    } finally {
      inFlight--;
    }
  };
  return { fetchImpl, asked, methods, maxInFlight: () => maxInFlight };
}

const wd = (tenant: string, dc: string, site: string, path: string) => `https://${tenant}.${dc}.myworkdayjobs.com/wday/cxs/${tenant}/${site}${path}`;
const ROWS = {
  sanford: { id: "workday:sanford~wd5~SanfordHealth:R-0278723", applyUrl: "https://sanford.wd5.myworkdayjobs.com/en-US/SanfordHealth/job/SD-Watertown/Medication-Assistant--Certified--Assisted-Living_R-0278723" },
  ups: { id: "workday:hcmportal~wd5~Search:R26036254", applyUrl: "https://hcmportal.wd5.myworkdayjobs.com/en-US/Search/job/US---SIOUX-FALLS-SDSIO/Seasonal-PT-Operations-Supervisor_R26036254" },
  tapestry: { id: "workday:tapestry~wd108~Tapestry_Careers:JR99999999", applyUrl: "https://tapestry.wd108.myworkdayjobs.com/en-US/Tapestry_Careers/job/Invented-Place/Not-A-Real-Job_JR99999999" },
  allstate: { id: "workday:allstate~wd5~allstate_careers:R35646", applyUrl: "https://allstate.wd5.myworkdayjobs.com/en-US/allstate_careers/job/US---Remote/In-Memory-Database-Platform-Engineer_R35646" },
  peoplegrove: { id: "lever:peoplegrove:c250dbe1-7e93-4042-ac17-a84a1a947ddb", applyUrl: "https://jobs.lever.co/peoplegrove/c250dbe1-7e93-4042-ac17-a84a1a947ddb" },
  leverOpen: { id: "lever:americaatwork:a02cac51-7ee4-4e6e-8d5c-6acfa515ae25", applyUrl: "https://jobs.lever.co/americaatwork/a02cac51-7ee4-4e6e-8d5c-6acfa515ae25" },
  ghOpen: { id: "greenhouse:altentechnologyusa:5268072007", applyUrl: "https://job-boards.greenhouse.io/altentechnologyusa/jobs/5268072007" },
  ghGone: { id: "greenhouse:altentechnologyusa:1", applyUrl: "https://job-boards.greenhouse.io/altentechnologyusa/jobs/1" },
  srOpen: { id: "smartrecruiters:HMGroup:744000156135889", applyUrl: "https://jobs.smartrecruiters.com/HMGroup/744000156135889" },
  srGone: { id: "smartrecruiters:HMGroup:744000156135000", applyUrl: "https://jobs.smartrecruiters.com/HMGroup/744000156135000" },
  srOdd: { id: "smartrecruiters:HMGroup:744000000000001", applyUrl: "https://jobs.smartrecruiters.com/HMGroup/744000000000001" },
  harmattanGone: { id: "ashby:harmattan-ai:94d60cab-ece8-469f-b5b9-70da86eabbb2", applyUrl: "https://jobs.ashbyhq.com/harmattan-ai/94d60cab-ece8-469f-b5b9-70da86eabbb2" },
  harmattanOpen: { id: "ashby:harmattan-ai:441ec812-5c8e-486a-ba97-632458eb362f", applyUrl: "https://jobs.ashbyhq.com/harmattan-ai/441ec812-5c8e-486a-ba97-632458eb362f" },
  sprouts: { id: "icims:jobs.sprouts.com:382267", applyUrl: "https://jobs.sprouts.com/jobs/382267/job" },
  cooper: { id: "icims:talent.cooperhealth.org:86505", applyUrl: "https://talent.cooperhealth.org/jobs/86505/job" },
  paylocityOpen: { id: "paylocity:14284393-6db2-46bd-8cb8-998b05a738a2:3011581", applyUrl: "https://recruiting.paylocity.com/recruiting/jobs/Details/3011581" },
  paylocityGone: { id: "paylocity:5733a42d-4243-4f7d-8b77-c8f55301d34d:1000001", applyUrl: "https://recruiting.paylocity.com/recruiting/jobs/Details/1000001" },
  teamtailorGone: { id: "teamtailor:rasan:8611780", applyUrl: "https://rasan.teamtailor.com/jobs/8611780" },
  personioOpen: { id: "personio:deag-deutsche-entertainment-ag:2859520", applyUrl: "https://deag-deutsche-entertainment-ag.jobs.personio.de/job/2859520" },
  personioGone: { id: "personio:deag-deutsche-entertainment-ag:2859599", applyUrl: "https://deag-deutsche-entertainment-ag.jobs.personio.de/job/2859599" },
  netDown: { id: "greenhouse:netdown:42", applyUrl: "https://job-boards.greenhouse.io/netdown/jobs/42" },
  adp: { id: "adp:07372372-77a5-45e9-8573-f67327c3c3ec:9207315772373_1", applyUrl: "https://workforcenow.adp.com/x" },
};
const TABLE: Record<string, Answer> = {
  [wd("sanford", "wd5", "SanfordHealth", "/job/SD-Watertown/Medication-Assistant--Certified--Assisted-Living_R-0278723")]: { status: 403, body: rec("workday-sanford-403-s22.json") },
  [wd("hcmportal", "wd5", "Search", "/job/US---SIOUX-FALLS-SDSIO/Seasonal-PT-Operations-Supervisor_R26036254")]: { status: 404, body: rec("workday-ups-404.json") },
  [wd("tapestry", "wd108", "Tapestry_Careers", "/job/Invented-Place/Not-A-Real-Job_JR99999999")]: { status: 404, body: rec("workday-tapestry-404-s21.json") },
  [wd("allstate", "wd5", "allstate_careers", "/job/US---Remote/In-Memory-Database-Platform-Engineer_R35646")]: { status: 200, body: rec("workday-allstate-200.json") },
  "https://api.lever.co/v0/postings/peoplegrove/c250dbe1-7e93-4042-ac17-a84a1a947ddb": { status: 404, body: rec("lever-peoplegrove-404.json") },
  "https://api.lever.co/v0/postings/americaatwork/a02cac51-7ee4-4e6e-8d5c-6acfa515ae25": { status: 200, body: rec("lever-americaatwork-200.json") },
  "https://boards-api.greenhouse.io/v1/boards/altentechnologyusa/jobs/5268072007": { status: 200, body: rec("greenhouse-alten-200.json") },
  "https://boards-api.greenhouse.io/v1/boards/altentechnologyusa/jobs/1": { status: 404, body: rec("greenhouse-404.json") },
  "https://api.smartrecruiters.com/v1/companies/HMGroup/postings/744000156135889": { status: 200, body: rec("smartrecruiters-hm-200.json") },
  "https://api.smartrecruiters.com/v1/companies/HMGroup/postings/744000156135000": { status: 404, body: "" },
  "https://api.smartrecruiters.com/v1/companies/HMGroup/postings/744000000000001": { status: 400, body: rec("smartrecruiters-400.json") },
  "https://api.ashbyhq.com/posting-api/job-board/harmattan-ai": { status: 200, body: rec("ashby-harmattan-board.json") },
  "https://jobs.sprouts.com/jobs/382267/job": { status: 410, body: "" },
  "https://talent.cooperhealth.org/jobs/86505/job": { status: 200, body: rec("icims-cooperhealth-200.html") },
  "https://recruiting.paylocity.com/recruiting/jobs/Details/3011581": { status: 200, body: rec("paylocity-3011581-200.html") },
  "https://recruiting.paylocity.com/recruiting/jobs/Details/1000001": { status: 200, url: "https://recruiting.paylocity.com/Recruiting/jobs/JobNotFound", body: "<html>Job not found</html>" },
  "https://rasan.teamtailor.com/jobs/8611780": { status: 404, url: "https://careers.rasan.co/jobs/8611780", body: "" },
  "https://deag-deutsche-entertainment-ag.jobs.personio.de/job/2859520": { status: 200, body: rec("personio-deag-200.html") },
  "https://deag-deutsche-entertainment-ag.jobs.personio.de/job/2859599": { status: 410, body: "" },
  "https://boards-api.greenhouse.io/v1/boards/netdown/jobs/42": { throws: "getaddrinfo ENOTFOUND" },
};

describe("each vendor's recorded answer reads as open, closed or unknown", () => {
  const state = async (row: { id: string; applyUrl: string }) => {
    const f = recordedFetch(TABLE);
    const r = await readEmployers([row], { fetchImpl: f.fetchImpl as unknown as typeof fetch, retryDelayMs: 1 });
    return r.get(row.id)!;
  };

  it("Workday: 403 S22 is closed, 404 S21 and a bare 404 are unknown, 200 is open", async () => {
    expect((await state(ROWS.sanford)).state).toBe("closed");
    expect((await state(ROWS.tapestry)).state).toBe("unknown");
    expect((await state(ROWS.ups)).state).toBe("unknown");
    expect((await state(ROWS.allstate)).state).toBe("open");
  });

  it("an iCIMS portal page is read through its frame, which carries the job's own markup", () => {
    expect(employerReadPlan({ id: "icims:talent.urbn.com:34263", applyUrl: "https://stores-na-urbn.icims.com/jobs/34263/job" }).url)
      .toBe("https://stores-na-urbn.icims.com/jobs/34263/job?in_iframe=1");
    expect(employerReadPlan(ROWS.sprouts).url).toBe("https://jobs.sprouts.com/jobs/382267/job");
  });

  it("an EU Greenhouse or Lever board is read at the vendor's EU instance, as the board reads it", () => {
    expect(employerReadPlan({ id: "greenhouse:eu~think-cell:5008812101", applyUrl: "" }).url).toBe("https://boards.eu.greenhouse.io/v1/boards/think-cell/jobs/5008812101");
    expect(employerReadPlan({ id: "lever:eu~mobileye:0d17f0b5-29db-4e7e-8688-08f69d91ad0f", applyUrl: "" }).url).toBe("https://api.eu.lever.co/v0/postings/mobileye/0d17f0b5-29db-4e7e-8688-08f69d91ad0f");
  });

  it("Workday's detail is read from the posting's own path on the tenant's CXS host", () => {
    expect(employerReadPlan(ROWS.sanford).url).toBe(wd("sanford", "wd5", "SanfordHealth", "/job/SD-Watertown/Medication-Assistant--Certified--Assisted-Living_R-0278723"));
    expect(employerReadPlan({ ...ROWS.sanford, applyUrl: "https://elsewhere.example/job/x" }).url).toBeNull();
  });

  it("Greenhouse, Lever and SmartRecruiters: a 404 is closed and a 200 open; any other refusal is unknown", async () => {
    expect((await state(ROWS.ghGone)).state).toBe("closed");
    expect((await state(ROWS.ghOpen)).state).toBe("open");
    expect((await state(ROWS.peoplegrove)).state).toBe("closed");
    expect((await state(ROWS.leverOpen)).state).toBe("open");
    expect((await state(ROWS.srGone)).state).toBe("closed");
    expect((await state(ROWS.srOpen)).state).toBe("open");
    expect((await state(ROWS.srOdd)).state).toBe("unknown");
  });

  it("Ashby: an id missing from the employer's whole board is closed, one on it is open", async () => {
    expect((await state(ROWS.harmattanGone)).state).toBe("closed");
    expect((await state(ROWS.harmattanOpen)).state).toBe("open");
  });

  it("an Ashby board that lists nothing says nothing about one posting", async () => {
    const f = recordedFetch({ "https://api.ashbyhq.com/posting-api/job-board/harmattan-ai": { status: 200, body: JSON.stringify({ jobs: [] }) } });
    const r = await readEmployers([ROWS.harmattanGone], { fetchImpl: f.fetchImpl as unknown as typeof fetch });
    expect(r.get(ROWS.harmattanGone.id)!.state).toBe("unknown");
  });

  it("iCIMS, Paylocity, Teamtailor and Personio pages: 404 or 410 is closed, Paylocity's own JobNotFound page is closed, 200 with the job's own JSON-LD is open", async () => {
    expect((await state(ROWS.sprouts)).state).toBe("closed");
    expect((await state(ROWS.cooper)).state).toBe("open");
    expect((await state(ROWS.paylocityGone)).state).toBe("closed");
    expect((await state(ROWS.paylocityOpen)).state).toBe("open");
    expect((await state(ROWS.teamtailorGone)).state).toBe("closed");
    expect((await state(ROWS.personioOpen)).state).toBe("open");
    expect((await state(ROWS.personioGone)).state).toBe("closed");
  });

  it("a page that answers 200 with no JobPosting of its own (an outage page) is unknown", async () => {
    const f = recordedFetch({ "https://jobs.sprouts.com/jobs/382267/job": { status: 200, url: "https://outage.sprouts.com/sproutsdotcom/", body: "<html><title>Sprouts Maintenance</title></html>" } });
    const r = await readEmployers([ROWS.sprouts], { fetchImpl: f.fetchImpl as unknown as typeof fetch });
    expect(r.get(ROWS.sprouts.id)!.state).toBe("unknown");
  });

  it("a network error is unknown, and a vendor this reader does not read is unknown without a request", async () => {
    expect((await state(ROWS.netDown)).state).toBe("unknown");
    const f = recordedFetch(TABLE);
    const r = await readEmployers([ROWS.adp], { fetchImpl: f.fetchImpl as unknown as typeof fetch });
    expect(r.get(ROWS.adp.id)!.state).toBe("unknown");
    expect(f.asked).toEqual([]);
  });

  it("every request is a GET", async () => {
    const f = recordedFetch(TABLE);
    await readEmployers(Object.values(ROWS), { fetchImpl: f.fetchImpl as unknown as typeof fetch, retryDelayMs: 1 });
    expect(new Set(f.methods)).toEqual(new Set(["GET"]));
  });

  it("one Ashby board is read once for all its postings", async () => {
    const f = recordedFetch(TABLE);
    await readEmployers([ROWS.harmattanGone, ROWS.harmattanOpen], { fetchImpl: f.fetchImpl as unknown as typeof fetch });
    expect(f.asked.filter((u) => u.includes("ashbyhq"))).toHaveLength(1);
  });

  it("a 429 is asked once more before it counts", async () => {
    let n = 0;
    const fetchImpl = async (url: string) => {
      n++;
      return n === 1 ? { status: 429, url, text: async () => "" } : { status: 404, url, text: async () => "" };
    };
    const r = await readEmployers([ROWS.ghGone], { fetchImpl: fetchImpl as unknown as typeof fetch, retryDelayMs: 1 });
    expect(n).toBe(2);
    expect(r.get(ROWS.ghGone.id)!.state).toBe("closed");
  });
});

describe("the read is bounded, so a publish build can never hang on a vendor", () => {
  it("keeps at most four requests in flight", async () => {
    const f = recordedFetch(TABLE);
    await readEmployers(Object.values(ROWS), { fetchImpl: f.fetchImpl as unknown as typeof fetch, retryDelayMs: 1 });
    expect(EMPLOYER_READ_CONCURRENCY).toBe(4);
    expect(f.maxInFlight()).toBeLessThanOrEqual(4);
    expect(f.maxInFlight()).toBeGreaterThan(1);
  });

  it("ends inside its budget when every vendor hangs, and calls what it did not reach unknown", async () => {
    const hanging: Record<string, Answer> = {};
    const rows = Array.from({ length: 12 }, (_, i) => ({ id: `greenhouse:slow${i}:${i}`, applyUrl: `https://job-boards.greenhouse.io/slow${i}/jobs/${i}` }));
    for (const r of rows) hanging[employerReadPlan(r).url!] = { hang: true };
    const f = recordedFetch(hanging);
    const t0 = Date.now();
    const out = await readEmployers(rows, { fetchImpl: f.fetchImpl as unknown as typeof fetch, budgetMs: 300, timeoutMs: 10_000 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect([...out.values()].every((r) => r.state === "unknown")).toBe(true);
    expect([...out.values()].some((r) => r.why === "budget")).toBe(true);
  });
});

describe("a run of closures too large to be true is not trusted", () => {
  it("makes every closed answer of a vendor that says closed for most of its postings unknown", () => {
    const m = new Map<string, { id: string; vendor: string; state: string; why: string; stated: object }>();
    for (let i = 0; i < 10; i++) m.set(`greenhouse:b:${i}`, { id: `greenhouse:b:${i}`, vendor: "greenhouse", state: i < 8 ? "closed" : "open", why: "", stated: {} });
    const out = distrustImplausibleClosures(m);
    expect([...out.values()].filter((r) => r.state === "closed")).toHaveLength(0);
  });

  it("makes a Workday tenant's closures unknown when every one of its reads said closed", () => {
    const m = new Map<string, { id: string; vendor: string; state: string; why: string; stated: object }>();
    for (let i = 0; i < 3; i++) m.set(`workday:blocked~wd1~X:R${i}`, { id: `workday:blocked~wd1~X:R${i}`, vendor: "workday", state: "closed", why: "403 S22", stated: {} });
    m.set("workday:fine~wd1~X:R1", { id: "workday:fine~wd1~X:R1", vendor: "workday", state: "closed", why: "403 S22", stated: {} });
    m.set("workday:fine~wd1~X:R2", { id: "workday:fine~wd1~X:R2", vendor: "workday", state: "open", why: "200", stated: {} });
    const out = distrustImplausibleClosures(m);
    expect(out.get("workday:blocked~wd1~X:R0")!.state).toBe("unknown");
    expect(out.get("workday:fine~wd1~X:R1")!.state).toBe("closed");
  });
});

describe("the bake retires a posting its employer closed and keeps one it could not judge", () => {
  const DESC = "We are hiring a medication assistant for our assisted living community, working beside nurses and caregivers every day. ".repeat(5);
  const days = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
  const closedRow = { ...ROWS.sanford, title: "Medication Assistant, Certified, Assisted Living", company: "Sanford Health", token: "sanford~wd5~SanfordHealth", source: "workday", location: "SD, Watertown", country: "US", postedAt: days(5), missingSince: null, agency: false };
  const unknownRow = { ...ROWS.netDown, title: "Analyst", company: "Netdown", token: "netdown", source: "greenhouse", location: "Austin, TX", country: "US", postedAt: days(3), missingSince: null, agency: false };

  it("splits the rows on their employers' answers and counts every answer", async () => {
    const f = recordedFetch(TABLE);
    const results = new Map();
    const list = [{ job: closedRow, description: DESC }, { job: unknownRow, description: DESC }];
    const { keep, closed } = await askEmployersAbout(list, { D, deadline: Date.now() + 5000, results, readOpts: { fetchImpl: f.fetchImpl, retryDelayMs: 1 } });
    expect(closed.map((d) => d.job.id)).toEqual([closedRow.id]);
    expect(keep.map((d) => d.job.id)).toEqual([unknownRow.id]);
    const s = summarizeEmployerReads(results);
    expect(s).toMatchObject({ checked: 2, closed: 1, unknown: 1, open: 0 });
    expect(employerReadLine(s)).toMatch(/1 closed \(retired\), 1 unknown/);
  });

  it("gives the closed one the noindex 'no longer listed' page, with no job markup, naming the employer's own system", () => {
    const stub = employerClosedStub(closedRow, D);
    expect(stub).toMatchObject({ state: "gone", basis: "employer", path: postingPage.postingPagePath(closedRow.id) });
    const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const page = postingStubPage({ ...stub, since: "2026-11-08", windowDays: 30, esc, companyLink: "" });
    expect(page.robots).toBe("noindex, follow");
    expect(JSON.stringify(page)).not.toMatch(/JobPosting/);
    expect(page.content).toMatch(/the employer's own hiring system answered that it no longer serves this posting/);
    expect(page.description).toMatch(/no longer listed by its employer/);
  });

  it("records the closure in the ledger, so the next bake keeps the stub and never re-checks it into the sitemap", () => {
    const stub = employerClosedStub(closedRow, D);
    const entry = postingStubEntry({ stub, prior: { state: "live", since: "2026-11-01", first: "2026-10-17" }, today: "2026-11-08", employerName: D.employerName, tokenOf: () => "sanford~wd5~SanfordHealth" });
    expect(entry).toMatchObject({ state: "gone", basis: "employer", since: "2026-11-08", first: "2026-10-17" });
    const path = stub.path!;
    const base = postingCarryBase({ ledger: { postings: { [path]: entry } }, sitemaps: [`<loc>https://resumebooster.work${path}</loc>`], idFromPath: D.postingIdFromPath, today: "2026-11-09" });
    expect(base.recheck.has(path)).toBe(false);
    expect(base.stubs.has(path)).toBe(true);
  });
});
