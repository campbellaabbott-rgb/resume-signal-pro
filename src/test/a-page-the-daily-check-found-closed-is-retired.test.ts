// @vitest-environment node
/**
 * A PAGE THE DAILY CHECK FOUND CLOSED IS RETIRED AT THE NEXT BAKE (SEO audit
 * 2026-11-18, CRAWL-M2).
 *
 * The daily closure check asks every live posting page's employer about it
 * and prints the closed ones, and nothing more: the 11-17 run found 30 pages
 * closed (ASML J-00348204 among the audit's examples) and the 11-18 bake
 * baked them live again with their JobPosting, because its own read of the
 * same employers did not answer. CI may not write to the site (owner ask,
 * default), so the check now names the closed pages in its job summary and in
 * one standing issue (label posting-closure-closed), as lines for
 * scripts/seo-seed/closed-at-employer.txt; at a publish they are committed
 * there, and the bake retires each listed live page with the employer's "no
 * longer listed" page without asking the employer again. A line over 14 days
 * old is ignored.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { askEmployersAbout, closedAtEmployerList, employerClosedStub } from "../../scripts/prerender-seo.mjs";
import { postingStubEntry, postingStubPage } from "../../scripts/prerender-pages.mjs";
import { closedListLines, closureRecord, closureSummaryMarkdown } from "../../scripts/posting-closure-check.mjs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";

const D = { ...companyDisplay, ...postingPage };
const ROOT = resolve(__dirname, "../..");
const ASML = {
  id: "workday:asml~wd3~asmlext1:J-00348204",
  source: "workday",
  token: "asml~wd3~asmlext1",
  title: "CS - Ops TW/SEA BPM Domain Network Lead - Tainan",
  company: "ASML",
  location: "Tainan, Taiwan",
  country: "TW",
  postedAt: "2026-11-15T00:00:00Z",
  applyUrl: "https://asml.wd3.myworkdayjobs.com/en-US/asmlext1/job/Tainan-Taiwan/CS---Ops-TW-SEA-BPM-Domain-Network-Lead---Taichung_J-00348204",
};
const ASML_PATH = "/jobs/posting/workday/asml~wd3~asmlext1/J-00348204";
const OTHER = { id: "greenhouse:acme:4001", source: "greenhouse", token: "acme", title: "Analyst", company: "Acme", location: "Leeds, England", country: "GB", postedAt: "2026-11-15T00:00:00Z", applyUrl: "https://job-boards.greenhouse.io/acme/jobs/4001" };
const DESCRIPTION = "The Domain Network Lead leads the governance and maturity of an assigned process domain, and drives the activation and sustainability of the domain network across the region.";

const replay = () => {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => {
    asked.push(url);
    // Every employer answers "open": only the list can retire ASML.
    const body = url.includes("myworkdayjobs.com") ? JSON.stringify({ jobPostingInfo: { id: "x", title: ASML.title, jobReqId: "J-00348204" } }) : "{}";
    return { status: 200, url, text: async () => body, headers: { get: () => null } };
  };
  return { fetchImpl, asked };
};

describe("the committed list retires a live page", () => {
  const LIST = [
    "# closed at the employer",
    `${ASML_PATH} 2026-11-17 employer`,
    "/jobs/posting/greenhouse/acme/9999 2026-11-01 employer",
    "/jobs/posting/greenhouse/acme/9998 2026-11-25 employer",
    "/not/a/posting 2026-11-17 employer",
  ].join("\n");

  it("reads the lines in its window and ignores one over 14 days old, a future one and a non-posting path", () => {
    const m = closedAtEmployerList(LIST, "2026-11-18");
    expect([...m.keys()]).toEqual([ASML_PATH]);
    expect(m.get(ASML_PATH)).toEqual({ date: "2026-11-17", basis: "employer" });
    // Fourteen days is still in; fifteen is out.
    expect(closedAtEmployerList(`${ASML_PATH} 2026-11-04 employer`, "2026-11-18").size).toBe(1);
    expect(closedAtEmployerList(`${ASML_PATH} 2026-11-03 employer`, "2026-11-18").size).toBe(0);
  });

  it("ASML J-00348204 on the list is closed without a read, and becomes the noindex employer page with no JobPosting", async () => {
    const f = replay();
    const items = [{ job: { ...ASML }, description: DESCRIPTION }, { job: { ...OTHER }, description: DESCRIPTION }];
    const { keep, closed } = await askEmployersAbout(items, {
      D, deadline: Date.now() + 5_000, today: "2026-11-18",
      readOpts: { fetchImpl: f.fetchImpl, retryDelayMs: 1 },
      closedAtEmployer: closedAtEmployerList(LIST, "2026-11-18"),
    });
    expect(closed.map((d: { job: { id: string } }) => d.job.id)).toEqual([ASML.id]);
    expect(keep.map((d: { job: { id: string } }) => d.job.id)).toEqual([OTHER.id]);
    expect(f.asked.some((u) => u.includes("asml"))).toBe(false);
    const stub = employerClosedStub(closed[0].job, D);
    expect(stub).toMatchObject({ path: ASML_PATH, state: "gone", basis: "employer" });
    const e = postingStubEntry({ stub, prior: { state: "live" }, today: "2026-11-18", employerName: (_t: unknown, n: string) => n, tokenOf: () => ASML.token });
    const page = postingStubPage({ path: ASML_PATH, id: ASML.id, state: "gone", since: e.since, title: ASML.title, company: "ASML", companyLink: "", windowDays: 30, basis: e.basis, esc: (x: string) => x });
    // A robots value keeps a page out of the bake's sitemap (write: only a page with neither canonical nor robots is listed).
    expect(page.robots).toBe("noindex, follow");
    expect("jsonLd" in page).toBe(false);
    expect(page.postingClosed).toBe("employer");
  });

  it("an entry over 14 days old does not retire the page", async () => {
    const f = replay();
    const { keep, closed } = await askEmployersAbout([{ job: { ...ASML }, description: DESCRIPTION }], {
      D, deadline: Date.now() + 5_000, today: "2026-11-18",
      readOpts: { fetchImpl: f.fetchImpl, retryDelayMs: 1 },
      closedAtEmployer: closedAtEmployerList(`${ASML_PATH} 2026-11-01 employer`, "2026-11-18"),
    });
    expect(closed).toHaveLength(0);
    expect(keep).toHaveLength(1);
  });

  it("the committed list parses, and the bake reads it from scripts/seo-seed", () => {
    const text = readFileSync(resolve(ROOT, "scripts/seo-seed/closed-at-employer.txt"), "utf8");
    for (const line of text.split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean)) {
      expect(line, line).toMatch(/^\/jobs\/posting\/\S+ \d{4}-\d{2}-\d{2} \S+$/);
    }
    const src = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/closedAtEmployerList\(seedList\("closed-at-employer\.txt"\)\.join\("\\n"\), TODAY\)/);
    expect(src).toMatch(/closedAtEmployer: CLOSED_AT_EMPLOYER/);
  });
});

describe("the daily check names what it found closed, and writes nothing", () => {
  const answers = new Map<string, { vendor: string; state: string; why?: string }>([
    [ASML_PATH, { vendor: "workday", state: "closed" }],
    ["/jobs/posting/greenhouse/acme/4001", { vendor: "greenhouse", state: "open" }],
    ["/jobs/posting/workday/x~wd1~y/R1", { vendor: "workday", state: "unknown", why: "challenge" }],
  ]);
  const record = closureRecord("2026-11-18", answers);

  it("latest.json lists the closed paths, and the issue lines are ready for the list", () => {
    expect(record.closedPaths).toEqual([ASML_PATH]);
    expect(closedListLines(record)).toEqual([`${ASML_PATH} 2026-11-18 employer`]);
    expect(closedAtEmployerList(closedListLines(record).join("\n"), "2026-11-18").has(ASML_PATH)).toBe(true);
  });

  it("the job summary lists the counts, why the unknowns are unknown, and every closed path", () => {
    const md = closureSummaryMarkdown(record, { message: "2026-11-18: 50.0% closed" });
    expect(md).toMatch(/3 live posting pages checked: 1 open, 1 closed at the employer, 1 unknown/);
    expect(md).toMatch(/\| workday \| 0 \| 1 \| 1 \| challenge 1 \|/);
    expect(md).toContain(`${ASML_PATH} 2026-11-18 employer`);
  });

  it("the workflow updates one standing issue inside its existing job, on the existing schedule", () => {
    const wf = readFileSync(resolve(ROOT, ".github/workflows/posting-closure.yml"), "utf8");
    expect(wf.match(/^\s*- cron:/gm)).toHaveLength(1);
    expect(wf).toMatch(/cron: "41 2,10,18 \* \* \*"/);
    expect(wf.slice(wf.search(/^jobs:/m)).match(/^  [a-z][\w-]*:\s*$/gm)).toEqual(["  check:"]);
    expect(wf).toMatch(/--closed-out \.posting-closure\/closed-today\.txt/);
    expect(wf).toMatch(/--label posting-closure-closed --state open/);
    expect(wf).not.toMatch(/functions\/v1\/job-board|x-rb-budget|curl -X POST/);
  });
});
