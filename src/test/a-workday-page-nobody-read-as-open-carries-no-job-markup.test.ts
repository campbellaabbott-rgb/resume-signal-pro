// @vitest-environment node
/**
 * A WORKDAY PAGE NOBODY READ AS OPEN CARRIES NO JOB MARKUP (owner decision
 * 2026-11-19 on the SEO audit of 2026-11-18, STRUCTURED-1 / STRUCTURED-M2
 * refined: "once the daily check's answers reach the bake, withhold
 * JobPosting (the page stays indexed) on a Workday page that neither the bake
 * nor a daily check in the last 36 h read as open").
 *
 * Workday holds most of the board's posting pages and is the vendor the
 * bake's own network reads worst (39 of 297 on 2026-11-18). A page no one has
 * read as open recently may be a closed job still marked up as open, which is
 * what stands between a searcher and a real interview. The page stays live
 * and indexed; only its JobPosting is withheld, with reason "unread" in its
 * ledger entry. The rule waits for the check's answers: with no line in
 * scripts/seo-seed/employer-stated.txt nothing is withheld.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as bakeModule from "../../scripts/prerender-seo.mjs";
import * as statements from "../../scripts/employer-statements.mjs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";

const { askEmployersAbout, bakePostingPage, postingMarkupWithheld } = bakeModule as unknown as {
  askEmployersAbout: (list: unknown[], o: unknown) => Promise<{ keep: Array<{ job: Record<string, unknown>; unread?: boolean; read?: string }> }>;
  bakePostingPage: (row: unknown, d: string, o: unknown) => Record<string, unknown>;
  postingMarkupWithheld: (page: unknown) => string | null;
};
const withUnreadWithheld = (bakeModule as unknown as { withUnreadWithheld?: (p: unknown, u: unknown) => Record<string, unknown> }).withUnreadWithheld;
const S = statements as unknown as { employerStatedList?: (t: string, now: number) => Map<string, unknown> };
const D = { ...companyDisplay, ...postingPage };
const SITE = "https://resumebooster.work";
const NOW = Date.parse("2026-11-21T18:00:00Z");
const TODAY = "2026-11-21";

const WD = {
  id: "workday:pnc~wd5~External:R217438-1", source: "workday", token: "pnc~wd5~External",
  title: "Branch Banker", company: "PNC", location: "Pittsburgh, PA", country: "US",
  postedAt: "2026-11-12T00:00:00.000Z",
  applyUrl: "https://pnc.wd5.myworkdayjobs.com/en-US/External/job/Pittsburgh-PA/Branch-Banker_R217438-1",
};
const WD_PATH = "/jobs/posting/workday/pnc~wd5~External/R217438-1";
const GH = { id: "greenhouse:acme:123", source: "greenhouse", token: "acme", title: "Analyst", company: "Acme", location: "Austin, TX", country: "US", postedAt: "2026-11-12T00:00:00.000Z", applyUrl: "https://boards.greenhouse.io/acme/jobs/123" };
const DESCRIPTION = "Serve customers at the branch: open accounts, answer questions about products and services, and help clients with their everyday banking needs while keeping every transaction accurate and compliant.";
const OTHER = "/jobs/posting/workday/x~wd1~S/R-9 2026-11-21T10:00Z open -";

const unreadFetch = async (url: string) => ({ status: 429, url, text: async () => "", headers: { get: () => null } });
const openFetch = async (url: string) => ({ status: 200, url, text: async () => JSON.stringify({ jobPostingInfo: { title: "Branch Banker" } }), headers: { get: () => null } });

async function ask(row: Record<string, unknown>, checkText: string, fetchImpl = unreadFetch) {
  const checkReads = S.employerStatedList ? S.employerStatedList(checkText, NOW) : new Map();
  const out = await askEmployersAbout([{ job: { ...row }, description: DESCRIPTION, carried: true, first: "2026-11-12" }], {
    D, deadline: Date.now() + 10_000, today: TODAY, nowMs: NOW, readOpts: { fetchImpl, retryDelayMs: 1 }, carriedOf: () => null, checkReads,
  });
  return out.keep[0];
}

describe("which Workday pages are unread", () => {
  it("a Workday page neither this bake nor a check line read as open is unread", async () => {
    expect((await ask(WD, OTHER))?.unread).toBe(true);
  });
  it("a check line from 8 hours ago that read it open, or this bake's own open read, clears it", async () => {
    expect((await ask(WD, `${OTHER}\n${WD_PATH} 2026-11-21T10:00Z open -`))?.unread).toBeFalsy();
    expect((await ask(WD, OTHER, openFetch))?.unread).toBeFalsy();
  });
  it("a check line older than 36 hours, or one that read it unknown, does not", async () => {
    expect((await ask(WD, `${OTHER}\n${WD_PATH} 2026-11-20T04:00Z open -`))?.unread).toBe(true);
    expect((await ask(WD, `${OTHER}\n${WD_PATH} 2026-11-21T10:00Z unknown -`))?.unread).toBe(true);
  });
  it("waits for the check's answers, and reads only Workday", async () => {
    expect((await ask(WD, ""))?.unread).toBeFalsy();
    expect((await ask(GH, OTHER))?.unread).toBeFalsy();
  });
});

describe("an unread page keeps its page and loses its markup", () => {
  it("is live, carries no JobPosting, and its ledger says why", () => {
    expect(typeof withUnreadWithheld).toBe("function");
    const page = bakePostingPage({ ...WD, postedAt: new Date(NOW - 86_400_000).toISOString() }, DESCRIPTION, { D, SITE, carried: true });
    expect(page.live).toBe(true);
    expect(page.ld).toBeTruthy();
    const withheld = withUnreadWithheld!(page, true);
    expect(withheld).toMatchObject({ live: true, ld: null, unread: true });
    expect(postingMarkupWithheld(withheld)).toBe("unread");
    expect(withUnreadWithheld!(page, false)).toBe(page);
  });
  it("the bake applies it and reads the check's file", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/d\.page = withUnreadWithheld\(d\.page, d\.unread\);/);
    expect(src).toMatch(/const CHECK_READS = employerStatedList\(seedList\("employer-stated\.txt"\)/);
    expect(src).toMatch(/checkReads: CHECK_READS,/);
  });
});
