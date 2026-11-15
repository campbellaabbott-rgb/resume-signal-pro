/**
 * A POSTING PAGE SAYS WHAT ITS EMPLOYER STATED, BAKED AND HYDRATED (SEO/GEO
 * audit 2026-11-07, B06: SD-04, SD-05, F05).
 *
 * WHAT WAS WRONG. Every baked posting's markup carried posted + 30 days as its
 * end, no employment type for most rows, no TELECOMMUTE for any (the board
 * carries no vendor remote flag), and the board's own date, even where the
 * employer's system states an end date (Workday endDate), a time type
 * (Workday timeType, Lever commitment, SmartRecruiters typeOfEmployment), a
 * fully remote posting (Workday remoteType "Fully Remote": Allstate R35646) or
 * an earlier original date and a street address (Paylocity 3011581's own
 * JobPosting: 2026-08-12 and Bellaire, TX 77401, fed to us as 2026-10-31).
 *
 * WHAT IS TRUE NOW. The bake's employer read (scripts/employer-reads.mjs, GET
 * only) returns what the employer states, applyEmployerStatements
 * (scripts/employer-statements.mjs) puts it into the row's own fields
 * (employerValidThrough, employmentType, workMode/remote/workModeSource,
 * postedAt, location) and the page and its markup are written from that row.
 * The bake writes the statements into the page's head, and the React page
 * applies the same statements to the row the board returns, so hydrating puts
 * back none of what the bake corrected. Nothing ever lengthens a window: an
 * end date only shortens it and a date is taken only when it is earlier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...a: unknown[]) => invoke(...a) },
    from: () => stubTable(),
    rpc: async () => ({ data: [], error: null }),
  },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, session: null }) }));
function stubTable() {
  const th: Record<string, unknown> = {};
  for (const k of ["select", "order", "eq", "not", "update", "insert", "in", "gte", "lte", "is"]) th[k] = () => th;
  th.limit = async () => ({ data: [] });
  th.maybeSingle = async () => ({ data: null });
  th.then = (ok: (v: unknown) => void) => Promise.resolve({ data: [], error: null }).then(ok);
  return th;
}

import JobPosting from "@/pages/JobPosting";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";
import { POSTING_LD_TAG_ID, isPostingLive, postingJsonLd, postingPagePath, postingWithEmployerStatements, type PostingRow } from "@/components/jobs/posting-page";
import { bakedHead, resetBakedHeadForTests } from "@/components/seo/baked-head";
import { clearBoardBudgetRefusal } from "@/lib/board-budget";
import { MOUNT_TEST_BUDGET, SLOW } from "./helpers/mount-budget";
import { employerReadPlan, employerVerdict } from "../../scripts/employer-reads.mjs";
import { EMPLOYER_STATED_META, applyEmployerStatements, employerStatedOf } from "../../scripts/employer-statements.mjs";
import { askEmployersAbout, bakePostingPage, composeHtml } from "../../scripts/prerender-seo.mjs";

vi.setConfig(MOUNT_TEST_BUDGET);

const ROOT = resolve(__dirname, "../..");
const FIX = resolve(__dirname, "fixtures/employer-reads");
const rec = (name: string) => readFileSync(resolve(FIX, name), "utf8");
const SITE = "https://resumebooster.work";
const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const dayOf = (iso: string) => iso.slice(0, 10);
const DESC = "We are hiring a database engineer to run the in-memory platform our claims systems read from, with an on-call rotation. ".repeat(5);
const D = { ...companyDisplay, ...postingPage };

const ALLSTATE = { id: "workday:allstate~wd5~allstate_careers:R35646", applyUrl: "https://allstate.wd5.myworkdayjobs.com/en-US/allstate_careers/job/US---Remote/In-Memory-Database-Platform-Engineer_R35646" };
const PAYLOCITY = { id: "paylocity:14284393-6db2-46bd-8cb8-998b05a738a2:3011581", applyUrl: "https://recruiting.paylocity.com/recruiting/jobs/Details/3011581" };

const row = (over: Partial<PostingRow> = {}): PostingRow => ({
  id: ALLSTATE.id,
  title: "In-Memory Database Platform Engineer",
  company: "Allstate",
  token: "allstate~wd5~allstate_careers",
  source: "workday",
  location: "US - Remote",
  country: "US",
  workMode: "remote",
  postedAt: "2026-11-07T08:00:00.000Z",
  missingSince: null,
  applyUrl: ALLSTATE.applyUrl,
  salary: null,
  agency: false,
  ...over,
});

/** The verdict on one recorded answer, as the bake reads it. */
const verdictOn = (r: { id: string; applyUrl: string }, res: { status: number; body: string; url?: string }) =>
  employerVerdict(employerReadPlan(r), { url: r.applyUrl, ...res }, r);

describe("the bake reads what the employer states and the markup says it", () => {
  it("Workday's recorded answer for Allstate R35646: its posting date, Full time and Fully Remote", () => {
    const v = verdictOn(ALLSTATE, { status: 200, body: rec("workday-allstate-200.json") });
    expect(v.state).toBe("open");
    expect(v.stated).toEqual({ postedAt: "2026-11-06", employmentType: "Full time", remote: true });
    const job = postingWithEmployerStatements(row(), v.stated);
    expect(job).toMatchObject({ postedAt: "2026-11-06", employmentType: "Full time", workMode: "remote", remote: true, workModeSource: "vendor" });
    const ld = postingJsonLd(job, DESC, { site: SITE, now: new Date("2026-11-08T12:00:00Z") })!;
    expect(ld).toMatchObject({ datePosted: "2026-11-06", employmentType: "FULL_TIME", jobLocationType: "TELECOMMUTE", applicantLocationRequirements: { "@type": "Country", name: "US" } });
    // Without the employer's read the same row carried neither.
    const before = postingJsonLd(row(), DESC, { site: SITE, now: new Date("2026-11-08T12:00:00Z") })!;
    expect(before.jobLocationType).toBeUndefined();
    expect(before.employmentType).toBeUndefined();
  });

  it("a Workday end date ends the markup's window on the employer's day, and Part time is PART_TIME", () => {
    const body = JSON.stringify({ jobPostingInfo: { startDate: "2026-11-02", endDate: "2026-11-08", timeType: "Part time", remoteType: "Hybrid" } });
    const v = verdictOn(ALLSTATE, { status: 200, body });
    expect(v.stated).toEqual({ employerValidThrough: "2026-11-08", postedAt: "2026-11-02", employmentType: "Part time" });
    const ld = postingJsonLd(postingWithEmployerStatements(row({ workMode: "hybrid", location: "Northbrook, IL" }), v.stated), DESC, { site: SITE, now: new Date("2026-11-05T12:00:00Z") })!;
    expect(ld).toMatchObject({ validThrough: "2026-11-08T23:59:59+00:00", employmentType: "PART_TIME", datePosted: "2026-11-02" });
    // Hybrid is not work from anywhere: no TELECOMMUTE.
    expect(ld.jobLocationType).toBeUndefined();
  });

  it("Paylocity 3011581's own markup: the original date it states and its street address, and the window counts from that date", () => {
    const v = verdictOn(PAYLOCITY, { status: 200, body: rec("paylocity-3011581-200.html") });
    expect(v.state).toBe("open");
    // The employer's own day, offset kept: the 12th in Bellaire is the 13th in UTC.
    expect(v.stated.postedAt).toBe("2026-08-12T22:31:03-05:00");
    expect(v.stated.address).toMatchObject({ addressLocality: "Bellaire", addressRegion: "TX", postalCode: "77401" });
    const fed = row({ id: PAYLOCITY.id, token: "14284393-6db2-46bd-8cb8-998b05a738a2", source: "paylocity", company: "Lady Nomada", location: "Lady Nomada Central Park", workMode: null, postedAt: "2026-10-31T00:00:00.000Z", applyUrl: PAYLOCITY.applyUrl });
    const job = postingWithEmployerStatements(fed, v.stated);
    expect(job.postedAt?.slice(0, 10)).toBe("2026-08-12");
    expect(job.location).toBe("Bellaire, TX 77401");
    // Read on 2026-08-20 it is marked up from the employer's own date and town;
    // read on 2026-11-08 it is past the board's window from the date the
    // employer states, and is not live at all: the republish kept it alive.
    const early = postingJsonLd(job, DESC, { site: SITE, now: new Date("2026-08-20T12:00:00Z") })!;
    expect(early.datePosted).toBe("2026-08-12");
    expect((early.jobLocation as { address: Record<string, string> }).address).toMatchObject({ addressLocality: "Bellaire", addressRegion: "TX", postalCode: "77401" });
    expect(isPostingLive(job, new Date("2026-11-08T12:00:00Z"))).toBe(false);
    expect(isPostingLive(fed, new Date("2026-11-08T12:00:00Z"))).toBe(true);
  });

  it("nothing a statement says ever lengthens a window, invents a type or moves a posting across a border", () => {
    const base = row({ employerValidThrough: "2026-11-10", postedAt: "2026-11-01T00:00:00.000Z" });
    const out = applyEmployerStatements(base, {
      employerValidThrough: "2026-12-31",
      postedAt: "2026-11-05T00:00:00.000Z",
      employmentType: "Flexible Schedule",
      address: { addressLocality: "Toronto", addressRegion: "ON", addressCountry: "CA" },
    }, { employmentTypeOf: postingPage.ldEmploymentType });
    expect(out.employerValidThrough).toBe("2026-11-10");
    expect(out.postedAt).toBe("2026-11-01T00:00:00.000Z");
    expect(out.employmentType).toBeUndefined();
    expect(out.location).toBe("US - Remote");
    // Fields a statement does not know are never put into the row.
    expect(employerStatedOf({ title: "x", remote: "yes", employerValidThrough: "soon" })).toBeNull();
  });

  it("askEmployersAbout keeps the statements beside the row, and the bake's page is decided on the stated row", async () => {
    const fetchImpl = async (url: string) => ({ status: 200, url, text: async () => rec("workday-allstate-200.json") });
    const live = row({ postedAt: ago(1), location: "US - Remote" });
    const { keep } = await askEmployersAbout([{ job: live, description: DESC, carried: true }], { D, deadline: Date.now() + 30_000, readOpts: { fetchImpl } });
    expect(keep[0].stated).toEqual({ postedAt: "2026-11-06", employmentType: "Full time", remote: true });
    const page = bakePostingPage(keep[0].job, DESC, { D, SITE, carried: true });
    expect(page.ld).toMatchObject({ employmentType: "FULL_TIME", jobLocationType: "TELECOMMUTE" });
  });

  it("the baked head carries the statements, checked, for the page that hydrates over it", () => {
    const html = composeHtml(
      { path: postingPagePath(ALLSTATE.id)!, title: "t", description: "d", content: "<p>x</p>", employerStated: { remote: true, employmentType: "Full time", title: "not a statement" } },
      { template: readFileSync(resolve(ROOT, "index.html"), "utf8"), D: { POSTING_LD_TAG_ID }, esc: (s: unknown) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;"), shell: (c: string) => c, preloadFor: () => "", publicHref: (p: string) => p, onTruncated: () => {} },
    );
    const m = new RegExp(`<meta name="${EMPLOYER_STATED_META}" content="([^"]*)" />`).exec(html);
    expect(m).not.toBeNull();
    expect(JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"))).toEqual({ employmentType: "Full time", remote: true });
    const none = composeHtml({ path: "/jobs", title: "t", description: "d", content: "<p>x</p>" }, { template: readFileSync(resolve(ROOT, "index.html"), "utf8"), D: { POSTING_LD_TAG_ID }, esc: String, shell: (c: string) => c, preloadFor: () => "", publicHref: (p: string) => p, onTruncated: () => {} });
    expect(none).not.toContain(EMPLOYER_STATED_META);
  });
});

describe("the React page keeps what the bake stated when it hydrates", () => {
  const jobEntities = () =>
    [...document.head.querySelectorAll('script[type="application/ld+json"]')]
      .map((s) => { try { return JSON.parse(s.textContent || ""); } catch { return null; } })
      .filter((d) => d && d["@type"] === "JobPosting");

  /** The head the bake wrote for this posting: its own page, its markup, and (when given) the statements it applied. */
  function bakeFile(job: PostingRow, stated: Record<string, unknown> | null, robots = "index, follow") {
    const path = postingPagePath(job.id)!;
    window.history.replaceState({}, "", path);
    const ld = bakePostingPage(job, DESC, { D, SITE, carried: true }).ld;
    document.head.innerHTML = [
      `<meta name="x-prerendered" content="1">`,
      `<title>${job.title}</title>`,
      `<meta name="robots" content="${robots}">`,
      `<link rel="canonical" href="${SITE}${path}">`,
      ...(stated ? [`<meta name="${EMPLOYER_STATED_META}" content="${JSON.stringify(stated).replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">`] : []),
      ...(ld ? [`<script type="application/ld+json" id="${POSTING_LD_TAG_ID}">${JSON.stringify(ld)}</script>`] : []),
    ].join("");
    resetBakedHeadForTests();
  }
  async function hydrate(boardRow: PostingRow) {
    invoke.mockImplementation(async (fn: string, a: { body?: { action?: string } } | undefined) =>
      fn === "job-board" && a?.body?.action === "detail" ? { data: { job: boardRow, description: DESC }, error: null } : { data: [], error: null },
    );
    render(
      <HelmetProvider>
        <MemoryRouter initialEntries={[postingPagePath(boardRow.id)!]}>
          <Routes><Route path="/jobs/posting/:source/:token/:key" element={<JobPosting />} /></Routes>
        </MemoryRouter>
      </HelmetProvider>,
    );
    await screen.findByRole("heading", { level: 1, name: boardRow.title! }, SLOW);
  }

  beforeEach(() => { invoke.mockReset(); clearBoardBudgetRefusal(); });
  afterEach(() => { cleanup(); clearBoardBudgetRefusal(); document.head.innerHTML = ""; resetBakedHeadForTests(); window.history.replaceState({}, "", "/"); });

  const end = new Date(Date.now() + 9 * DAY).toISOString().slice(0, 10);
  const stated = { employerValidThrough: end, employmentType: "Part time", remote: true, postedAt: ago(4) };
  const boardRow = row({ postedAt: ago(2), location: "US - Remote" });

  it("the head reads the statements back exactly as the bake wrote them", () => {
    bakeFile(postingWithEmployerStatements(boardRow, stated), stated);
    expect(bakedHead()?.employerStated).toEqual(employerStatedOf(stated));
  });

  it("the JobPosting written after hydration keeps the employer's end date, type, remote field and date", async () => {
    const baked = postingWithEmployerStatements(boardRow, stated);
    bakeFile(baked, stated);
    const bakedLd = JSON.parse(JSON.stringify(bakePostingPage(baked, DESC, { D, SITE, carried: true }).ld));
    expect(bakedLd).toMatchObject({ validThrough: `${end}T23:59:59+00:00`, employmentType: "PART_TIME", jobLocationType: "TELECOMMUTE", datePosted: dayOf(ago(4)) });
    await hydrate(boardRow);
    await waitFor(() => expect(jobEntities()).toEqual([bakedLd]), SLOW);
  });

  it("negative control: a head with no statements gets the board's row, as before", async () => {
    bakeFile(boardRow, null);
    await hydrate(boardRow);
    await waitFor(() => expect(jobEntities()).toHaveLength(1), SLOW);
    const ld = jobEntities()[0];
    expect(ld.jobLocationType).toBeUndefined();
    expect(ld.employmentType).toBeUndefined();
    expect(ld.datePosted).toBe(dayOf(ago(2)));
  });

  it("a stub's head (noindex) lends no statements to the row", async () => {
    bakeFile(boardRow, stated, "noindex, follow");
    expect(bakedHead()?.indexable).toBe(false);
    await hydrate(boardRow);
    await waitFor(() => expect(jobEntities()).toEqual([]), SLOW);
  });
});
