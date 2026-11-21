// @vitest-environment node
/**
 * AN END DATE THE DAILY CHECK READ OUTLIVES A FAILED BAKE READ (SEO audit
 * 2026-11-18, STRUCTURED-B2).
 *
 * The bake's own Workday read answered 39 of 297 pages on 2026-11-18, while
 * the daily closure check, from GitHub's network, answered 285 of 289. The
 * check's answers never reached the bake, so a page whose bake read failed
 * served validThrough at datePosted + 30 and no employment type: AstraZeneca
 * R-243632 served 12-06 against its employer's end of 11-20.
 *
 * The check now writes what each employer stated to
 * scripts/seo-seed/employer-stated.txt (in the pull request it proposes), and
 * the bake applies a line's statements when its own read fails: the end date
 * is the earlier of the check's and the ledger's, so validThrough never moves
 * later, and an end already past retires the page.
 */
import { describe, expect, it } from "vitest";
import { askEmployersAbout } from "../../scripts/prerender-seo.mjs";
import * as statements from "../../scripts/employer-statements.mjs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";

const D = { ...companyDisplay, ...postingPage };
type Stated = Record<string, unknown> | null;
type Entry = { at: number; state: string; stated: Stated };
// employer-statements.d.mts declares the page's half of the module; the bake's helpers are read untyped.
const S = statements as unknown as {
  employerStatedLine?: (path: string, at: string, state: string, stated: Stated) => string;
  employerStatedList?: (text: string, nowMs: number, o?: { maxAgeDays?: number }) => Map<string, Entry>;
  earlierCarried?: (check: Stated, ledger: Stated) => Stated;
};

const ROW = {
  id: "workday:astrazeneca~wd3~Careers:R-243632",
  source: "workday",
  token: "astrazeneca~wd3~Careers",
  title: "Scientist, Cell Line Development",
  company: "AstraZeneca",
  location: "Gaithersburg, MD",
  country: "US",
  postedAt: "2026-11-06T00:00:00.000Z",
  applyUrl: "https://astrazeneca.wd3.myworkdayjobs.com/en-US/Careers/job/Gaithersburg-MD/Scientist--Cell-Line-Development_R-243632",
};
const PATH = "/jobs/posting/workday/astrazeneca~wd3~Careers/R-243632";
const DESCRIPTION = "Join the team that develops the cell lines behind our biologics pipeline. You will design and run cell line development experiments, analyse clone performance and work with process development partners to move candidates into manufacturing.";
const CHECK_TEXT = (end: string) => `# a comment\n${PATH} 2026-11-15T02:41Z open {"employerValidThrough":"${end}","employmentType":"Full time"}\n`;
const at = (iso: string) => Date.parse(iso);

/** Every employer request answers 429 (the reader asks once more, then records unknown). */
const unreadFetch = async (url: string) => ({ status: 429, url, text: async () => "", headers: { get: () => null } });

async function bake(today: string, checkText: string, ledgerCarried: Stated = null) {
  const list = S.employerStatedList ? S.employerStatedList(checkText, at(`${today}T12:00:00Z`)) : new Map();
  return askEmployersAbout([{ job: { ...ROW }, description: DESCRIPTION, carried: true, first: "2026-11-06" }], {
    D, deadline: Date.now() + 10_000, today, nowMs: at(`${today}T12:00:00Z`),
    readOpts: { fetchImpl: unreadFetch, retryDelayMs: 1 },
    carriedOf: () => ledgerCarried,
    checkReads: list,
  } as never) as Promise<{ keep: Array<{ job: Record<string, unknown>; stated?: Stated }>; ended: unknown[]; closed: unknown[] }>;
}
const markupOn = (job: unknown, day: string) => D.postingJsonLd(job as never, DESCRIPTION, { site: "https://resumebooster.work", now: new Date(`${day}T12:00:00Z`) }) as Record<string, unknown> | null;

describe("AstraZeneca R-243632, its bake read failed and the daily check's answered", () => {
  it("serves the check's end date (11-20, not datePosted + 30 = 12-06) and its time type", async () => {
    const out = await bake("2026-11-15", CHECK_TEXT("2026-11-20"));
    expect(out.keep).toHaveLength(1);
    const ld = markupOn(out.keep[0].job, "2026-11-15");
    expect(String(ld?.validThrough)).toMatch(/^2026-11-20T/);
    expect(ld?.employmentType).toBe("FULL_TIME");
  });

  it("keeps the earlier end when the ledger carried a later one, and the ledger's when the check's is later", async () => {
    const a = await bake("2026-11-15", CHECK_TEXT("2026-11-20"), { employerValidThrough: "2026-11-25" });
    expect(String(markupOn(a.keep[0].job, "2026-11-15")?.validThrough)).toMatch(/^2026-11-20T/);
    const b = await bake("2026-11-15", CHECK_TEXT("2026-11-28"), { employerValidThrough: "2026-11-19" });
    expect(String(markupOn(b.keep[0].job, "2026-11-15")?.validThrough)).toMatch(/^2026-11-19T/);
  });

  it("retires the page once the check's end date has passed", async () => {
    const out = await bake("2026-11-21", CHECK_TEXT("2026-11-20"));
    expect(out.keep).toHaveLength(0);
    expect(out.ended).toHaveLength(1);
  });

  it("with no check line, serves what it served before (the window from datePosted)", async () => {
    const out = await bake("2026-11-15", "");
    expect(String(markupOn(out.keep[0].job, "2026-11-15")?.validThrough)).toMatch(/^2026-12-06T/);
  });
});

describe("employer-stated.txt", () => {
  it("round-trips a line, and leaves out a line over two weeks old, one dated ahead, and a malformed one", () => {
    expect(typeof S.employerStatedLine).toBe("function");
    const line = S.employerStatedLine!(PATH, "2026-11-15T02:41:17.000Z", "open", { employerValidThrough: "2026-11-20", employmentType: "Full time", junk: 1 });
    expect(line).toBe(`${PATH} 2026-11-15T02:41Z open {"employerValidThrough":"2026-11-20","employmentType":"Full time"}`);
    const now = at("2026-11-16T00:00:00Z");
    const text = [
      line,
      "/jobs/posting/workday/a~wd1~S/R-1 2026-10-30T00:00Z open -",
      "/jobs/posting/workday/a~wd1~S/R-2 2026-11-17T00:00Z open -",
      "/jobs/posting/workday/a~wd1~S/R-3 yesterday open -",
      "/jobs/posting/workday/a~wd1~S/R-4 2026-11-15T09:00Z unknown -",
    ].join("\n");
    const m = S.employerStatedList!(text, now);
    expect([...m.keys()]).toEqual([PATH, "/jobs/posting/workday/a~wd1~S/R-4"]);
    expect(m.get(PATH)).toMatchObject({ state: "open", stated: { employerValidThrough: "2026-11-20", employmentType: "Full time" } });
    expect(m.get("/jobs/posting/workday/a~wd1~S/R-4")).toMatchObject({ state: "unknown", stated: null });
  });

  it("the earlier end of the check's and the ledger's, and the check's time type", () => {
    expect(S.earlierCarried!({ employerValidThrough: "2026-11-20", employmentType: "Full time" }, { employerValidThrough: "2026-11-25", employmentType: "Part time", remote: true }))
      .toEqual({ employerValidThrough: "2026-11-20", employmentType: "Full time", remote: true });
    expect(S.earlierCarried!(null, { employerValidThrough: "2026-11-25" })).toEqual({ employerValidThrough: "2026-11-25" });
    expect(S.earlierCarried!(null, null)).toBeNull();
  });
});
