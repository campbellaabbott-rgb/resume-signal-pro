// @vitest-environment node
/**
 * REMOTE MEANS NEVER ON SITE (SEO audit 2026-11-18, STRUCTURED-6).
 *
 * Google's TELECOMMUTE is for a job worked remotely all of the time. The
 * 2026-11-18 bake marked Turner & Townsend 744000161597359 TELECOMMUTE because
 * SmartRecruiters set location.remote, while its own description asks for
 * travel to the Frederick, MD project site "approximately 3-4 days per month"
 * and an "onsite expectation". The vendor's remote flag now stands only when
 * the posting's own text obliges no time on site, read from the vendor's
 * answer where it carries text and from the stored description in the bake.
 *
 * The rule is held to a labelled corpus of 867 vendor-flagged remote postings
 * (src/test/fixtures/remote-flag-corpus-2026-11-18.json): every posting
 * labelled fully remote keeps its flag (never worse than the flag alone), and
 * every one whose text obliges time on site loses it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { onSiteObligation, readEmployers, withoutObligedRemote } from "../../scripts/employer-reads.mjs";
import { askEmployersAbout } from "../../scripts/prerender-seo.mjs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";

const D = { ...companyDisplay, ...postingPage };
const FIX = resolve(__dirname, "fixtures");
type Case = { label: "remote" | "on-site"; vendor: string; ids: string[]; text: string };
const corpus = JSON.parse(readFileSync(resolve(FIX, "remote-flag-corpus-2026-11-18.json"), "utf8")) as { postings: number; cases: Case[] };

function answering(table: Record<string, { status: number; body: string }>) {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => {
    asked.push(url);
    const a = table[url];
    if (!a) return { status: 599, url, text: async () => "" };
    return { status: a.status, url, text: async () => a.body };
  };
  return { fetchImpl, asked };
}

const TT_ROW = { id: "smartrecruiters:TurnerTownsend:744000161597359", applyUrl: "https://jobs.smartrecruiters.com/TurnerTownsend/744000161597359" };
const TT_URL = "https://api.smartrecruiters.com/v1/companies/TurnerTownsend/postings/744000161597359";
const TT_BODY = readFileSync(resolve(FIX, "employer-reads/smartrecruiters-turnertownsend-744000161597359-built.json"), "utf8");
const TT_TEXT = (JSON.parse(TT_BODY).jobAd.sections.jobDescription.text as string).replace(/<\/p>/g, "\n").replace(/<[^>]+>/g, "");

describe("a vendor's remote flag stands only on a text that obliges no time on site", () => {
  it("the corpus: 867 flagged postings, every fully remote one kept, every on-site obligation refused", () => {
    expect(corpus.postings).toBe(867);
    const kept = corpus.cases.filter((c) => c.label === "remote");
    const obliged = corpus.cases.filter((c) => c.label === "on-site");
    expect(kept.reduce((n, c) => n + c.ids.length, 0)).toBe(859);
    expect(obliged.reduce((n, c) => n + c.ids.length, 0)).toBe(8);
    const wrongRefusals = kept.filter((c) => onSiteObligation(c.text) !== null).map((c) => `${c.ids[0]}: ${onSiteObligation(c.text)}`);
    expect(wrongRefusals).toEqual([]);
    const missed = obliged.filter((c) => onSiteObligation(c.text) === null).map((c) => c.ids[0]);
    expect(missed).toEqual([]);
  });

  it("names the sentence that obliges, and lets an offered alternative, an occasional visit and a technical word pass", () => {
    expect(onSiteObligation(TT_TEXT)).toMatch(/3-4 days per month/);
    expect(onSiteObligation("Must provide daily on-site support in DC office")).toMatch(/daily on-site support/);
    expect(onSiteObligation("Flexibele werktijden en hybride werken")).toMatch(/hybride werken/);
    expect(onSiteObligation("Brisbane-based with one or two days a week in the office, or fully remote anywhere in Australia")).toBeNull();
    expect(onSiteObligation("Occasional travel or on-site presence may be required.")).toBeNull();
    expect(onSiteObligation("Experience with hybrid cloud and hybrid identity (Entra ID).")).toBeNull();
    expect(onSiteObligation("This is a hybrid role that spans product management and product delivery disciplines.")).toBeNull();
    expect(onSiteObligation("Assigning technicians based on site requirements, qualifications and workload.")).toBeNull();
    expect(onSiteObligation("No daily commute. Fully remote, work from anywhere in the US.")).toBeNull();
  });

  it("Turner & Townsend: SmartRecruiters' remote flag is not stated, its time type still is", async () => {
    const f = answering({ [TT_URL]: { status: 200, body: TT_BODY } });
    const r = (await readEmployers([TT_ROW], { fetchImpl: f.fetchImpl, budgetMs: 5_000 })).get(TT_ROW.id);
    expect(r.state).toBe("open");
    expect(r.stated?.remote).toBeUndefined();
    expect(r.stated?.employmentType).toBe("Full-time");
  });

  it("a fully remote Lever posting keeps its flag", async () => {
    const row = { id: "lever:example:00000000-0000-4000-8000-000000000001", applyUrl: "https://jobs.lever.co/example/00000000-0000-4000-8000-000000000001" };
    const body = JSON.stringify({
      id: "00000000-0000-4000-8000-000000000001",
      text: "Senior Data Engineer",
      workplaceType: "remote",
      categories: { commitment: "Full-time", location: "Remote - US" },
      descriptionPlain: "This is a fully remote role. Work from anywhere in the United States; no daily commute.",
      lists: [{ text: "What you'll do", content: "<li>Build pipelines.</li><li>Travel to our annual offsite may be required.</li>" }],
    });
    const f = answering({ "https://api.lever.co/v0/postings/example/00000000-0000-4000-8000-000000000001": { status: 200, body } });
    const r = (await readEmployers([row], { fetchImpl: f.fetchImpl, budgetMs: 5_000 })).get(row.id);
    expect(r.state).toBe("open");
    expect(r.stated?.remote).toBe(true);
  });

  it("the bake reads the stored description too: a list answer with no text cannot mark an on-site job remote", async () => {
    const id = "ashby:example-co:11111111-1111-4111-8111-111111111111";
    const board = JSON.stringify({ jobs: [{ id: "11111111-1111-4111-8111-111111111111", title: "Senior Cost Manager", workplaceType: "Remote", employmentType: "FullTime" }] });
    const f = answering({ "https://api.ashbyhq.com/posting-api/job-board/example-co": { status: 200, body: board } });
    const job = { id, title: "Senior Cost Manager", company: "Example Co", location: "Frederick, MD", country: "US", postedAt: "2026-11-14T00:00:00Z", applyUrl: "https://jobs.ashbyhq.com/example-co/11111111-1111-4111-8111-111111111111" };
    const { keep } = await askEmployersAbout([{ job: { ...job }, description: TT_TEXT }], { D, deadline: Date.now() + 5_000, readOpts: { fetchImpl: f.fetchImpl } });
    expect(keep).toHaveLength(1);
    expect(keep[0].job.workModeSource).not.toBe("vendor");
    expect(D.postingRemoteBasis(keep[0].job)).not.toBe("vendor");
    expect(keep[0].stated?.remote).toBeUndefined();
    // The same answer beside a fully remote description is stated as remote.
    const remote = await askEmployersAbout([{ job: { ...job }, description: "A fully remote role. Work from anywhere in the United States." }], { D, deadline: Date.now() + 5_000, readOpts: { fetchImpl: answering({ "https://api.ashbyhq.com/posting-api/job-board/example-co": { status: 200, body: board } }).fetchImpl } });
    expect(D.postingRemoteBasis(remote.keep[0].job)).toBe("vendor");
  });

  it("withoutObligedRemote keeps every other statement and says why it dropped the flag", () => {
    expect(withoutObligedRemote({ remote: true, employmentType: "Full-time" }, TT_TEXT)).toEqual({ employmentType: "Full-time", remoteRefused: expect.stringMatching(/3-4 days per month/) });
    const stated = { remote: true };
    expect(withoutObligedRemote(stated, "Fully remote.")).toBe(stated);
    expect(withoutObligedRemote(null, TT_TEXT)).toBeNull();
  });
});
