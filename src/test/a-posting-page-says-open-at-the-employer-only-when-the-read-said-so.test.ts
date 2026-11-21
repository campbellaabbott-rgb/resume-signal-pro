// @vitest-environment node
/**
 * A POSTING PAGE SAYS "OPEN AT THE EMPLOYER" ONLY WHEN THE READ SAID SO (SEO
 * audit 2026-11-18, GEO-10).
 *
 * Every posting page said only that it "was checked against the board when it
 * was built", even when the bake had just read the posting on the employer's
 * own hiring system and found it open: a dated freshness fact answer engines
 * could quote, left unsaid on about a third of the pages. Where this bake's
 * read answered open, the page now says so with the date; where it did not
 * (unknown, a challenge, the budget), the sentence is as it was.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as bakeModule from "../../scripts/prerender-seo.mjs";
import * as postingPage from "@/components/jobs/posting-page";
import * as companyDisplay from "@/lib/company-display";

const clause = (bakeModule as unknown as { postingCheckedClause?: (p: string, read: string | undefined, today: string) => string }).postingCheckedClause;
const { askEmployersAbout } = bakeModule as unknown as { askEmployersAbout: (l: unknown[], o: unknown) => Promise<{ keep: Array<{ read?: string }> }> };
const D = { ...companyDisplay, ...postingPage };
const ROW = { id: "greenhouse:acme:123", source: "greenhouse", token: "acme", title: "Analyst", company: "Acme", location: "Austin, TX", country: "US", postedAt: "2026-11-12T00:00:00.000Z", applyUrl: "https://boards.greenhouse.io/acme/jobs/123" };
const DESCRIPTION = "Analyse the data our customers rely on, build the reports our teams read every week, and work with engineering to make each figure traceable to its source system.";
const reply = (status: number, body: string) => async (url: string) => ({ status, url, text: async () => body, headers: { get: () => null } });

describe("the sentence", () => {
  it("names the employer's own hiring system and the day, only for an open read", () => {
    expect(typeof clause).toBe("function");
    expect(clause!("Acme's", "open", "2026-11-21")).toBe("this page was built 2026-11-21, when the posting was open on Acme's own hiring system");
    for (const read of ["unknown", undefined]) expect(clause!("Acme's", read, "2026-11-21")).toBe("this page was checked against the board when it was built, 2026-11-21");
  });

  it("the bake's posting sentence uses it with this bake's read", () => {
    const src = readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8");
    expect(src).toMatch(/and \$\{postingCheckedClause\(possessive\(nm\), read, TODAY\)\}; the board itself/);
    expect(src).toMatch(/for \(const \{ description, first, carried, page, stated, read \} of detailed\)/);
  });
});

describe("the read each kept page carries", () => {
  const ask = async (fetchImpl: (u: string) => Promise<unknown>) => (await askEmployersAbout([{ job: { ...ROW }, description: DESCRIPTION, carried: true }], {
    D, deadline: Date.now() + 10_000, today: "2026-11-21", readOpts: { fetchImpl, retryDelayMs: 1 }, carriedOf: () => null,
  })).keep[0];
  it("is open when the employer's API served the posting", async () => {
    expect((await ask(reply(200, JSON.stringify({ id: 123, title: "Analyst" }))))?.read).toBe("open");
  });
  it("is unknown when it did not answer", async () => {
    expect((await ask(reply(503, "")))?.read).toBe("unknown");
  });
});
