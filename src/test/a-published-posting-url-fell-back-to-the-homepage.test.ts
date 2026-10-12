import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import {
  POSTING_STUB_KEEP_DAYS,
  carrySitemaps,
  postingCarryBase,
  postingCheckState,
  postingStubPage,
} from "../../scripts/prerender-pages.mjs";
import { composeHtml } from "../../scripts/prerender-seo.mjs";
import { postingIdFromPath } from "@/components/jobs/posting-page";

/**
 * WHAT WAS WRONG, measured 2026-10-08 with a Googlebot UA (SEO report F2,
 * register L1-04, L13-36, L13-34):
 *  - 364 of the 371 posting URLs in the last committed sitemap answered with
 *    a byte-identical copy of the homepage. Each publish rebuilt the posting
 *    pages from the COMMITTED public/sitemap.xml, which a hosted build never
 *    updates, so the previous publish's pages were never asked about; and a
 *    300-row carry cap under a 400-page cap dropped the rest unread.
 *  - the homepage file carried no canonical at all, so every address that
 *    fell back to it was an indexable copy of "/".
 *
 * The carry base is now what the LIVE site published (its sitemap and the
 * ledger it served), with no cap; every carried URL is asked about, and one
 * whose posting the board no longer lists keeps a noindex page saying so.
 */

const SITE = "https://resumebooster.work";
const TODAY = "2026-10-09";
const posting = (i: number) => `/jobs/posting/workday/acme~wd3~Careers/JR${i}`;
const sitemap = (paths: string[]) =>
  `<urlset>${paths.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("")}<url><loc>${SITE}/jobs</loc></url></urlset>`;
const esc = (s: string) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

describe("the carry base is everything the live site published, uncapped", () => {
  it("re-checks all 371 posting URLs of the live sitemap, not the first 300 of a committed one", () => {
    const live = Array.from({ length: 371 }, (_, i) => posting(i));
    const committed = [posting(9000), posting(9001)];
    const base = postingCarryBase({ ledger: null, sitemaps: [sitemap(live), sitemap(committed)], idFromPath: postingIdFromPath, today: TODAY });
    expect(base.recheck.size).toBe(373);
    for (const p of live) expect(base.recheck.has(p)).toBe(true);
    expect(base.recheck.has("/jobs"), "a non-posting URL is not a posting to carry").toBe(false);
  });

  it("keeps a gone posting's page for the keep window without re-asking, then lets it go", () => {
    const ledger = {
      postings: {
        [posting(1)]: { state: "gone", since: "2026-10-01", first: "2026-09-20", title: "Nurse" },
        [posting(2)]: { state: "gone", since: "2026-07-01", first: "2026-06-20" },
        [posting(3)]: { state: "retired", since: "2026-10-05", first: "2026-09-25" },
        [posting(4)]: { state: "live", since: "2026-10-08", first: "2026-09-01" },
      },
    };
    const base = postingCarryBase({ ledger, sitemaps: [], idFromPath: postingIdFromPath, today: TODAY });
    expect(base.stubs.has(posting(1))).toBe(true);
    expect(base.recheck.has(posting(1)), "a gone posting is not re-read").toBe(false);
    expect(base.stubs.has(posting(2)), `past ${POSTING_STUB_KEEP_DAYS} days the noindex page has done its work`).toBe(false);
    expect(base.recheck.get(posting(3))).toBe("2026-09-25");
    expect(base.recheck.get(posting(4)), "the first-published day rides along").toBe("2026-09-01");
  });
});

describe("an expired gone posting is not re-read from a stale sitemap", () => {
  // Reviewer, 2026-10-10: past the keep window a gone ledger entry went into
  // neither set, so the committed sitemap (which a hosted build never
  // updates) put it back on the re-check list; the board answered "gone"
  // again, the stub kept its old date, and the same path was re-read on
  // every bake, one budget read each, until the fresh pool was starved.
  const gonePath = posting(77);
  const ledger = { postings: { [gonePath]: { state: "gone", since: "2026-10-11", first: "2026-10-01" } } };
  const committed = sitemap([gonePath, posting(78)]);

  it("inside the keep window it is a kept stub, not a re-check", () => {
    const base = postingCarryBase({ ledger, sitemaps: ["", committed], idFromPath: postingIdFromPath, today: "2026-11-01" });
    expect(base.stubs.has(gonePath)).toBe(true);
    expect(base.recheck.has(gonePath)).toBe(false);
  });

  it("past the window it is dropped, and a sitemap still naming it does not bring it back", () => {
    const base = postingCarryBase({ ledger, sitemaps: ["", committed], idFromPath: postingIdFromPath, today: "2026-12-15" });
    expect(base.stubs.has(gonePath)).toBe(false);
    expect(base.recheck.has(gonePath), "the ledger decided this path; a stale sitemap cannot re-open it").toBe(false);
    expect(base.recheck.has(posting(78)), "a path no ledger names is still carried").toBe(true);
  });

  it("once the live ledger is read the committed sitemap is not carried at all", () => {
    const live = sitemap([posting(1)]);
    expect(carrySitemaps({ ledgerSource: "live", liveSitemap: live, committedSitemap: committed })).toEqual([live]);
    expect(carrySitemaps({ ledgerSource: "committed", liveSitemap: live, committedSitemap: committed })).toEqual([live, committed]);
    expect(carrySitemaps({ ledgerSource: "none", liveSitemap: null, committedSitemap: committed })).toEqual(["", committed]);
  });
});

describe("only the board's own answer retires a page", () => {
  it("reads found, gone and unchecked from the detail action's answer", () => {
    expect(postingCheckState(200, { job: { id: "x" }, description: "..." })).toBe("found");
    expect(postingCheckState(200, { job: null, agedOut: { title: "t" } })).toBe("gone");
    expect(postingCheckState(200, { job: null, closed: { title: "t" } })).toBe("gone");
    expect(postingCheckState(200, { job: null, description: "the vendor still has text" })).toBe("gone");
    expect(postingCheckState(404, { error: "Posting not found" })).toBe("gone");
    for (const s of [0, 429, 500, 503]) expect(postingCheckState(s, null), `HTTP ${s}`).toBe("unchecked");
  });

  it("a posting no longer listed keeps a noindex page that says so, never the homepage", () => {
    const page = postingStubPage({ path: posting(1), id: "workday:acme~wd3~Careers:JR1", state: "gone", since: "2026-10-01", title: "Staff Nurse", company: "Acme Health", companyLink: "", windowDays: 30, esc });
    expect(page.robots).toBe("noindex, follow");
    expect(page.title).toContain("no longer listed");
    expect(page.content).toContain("Staff Nurse at Acme Health is no longer listed on this board");
    expect(page.content, "it is a statement about this board, not the employer").toContain("not about the employer");
  });

  it("an unanswered re-check says only that, and a duplicate points at the page that carries it", () => {
    const unchecked = postingStubPage({ path: posting(5), id: "workday:acme~wd3~Careers:JR5", state: "unchecked", since: null, title: null, company: null, companyLink: "", windowDays: 30, esc });
    expect(unchecked.robots).toBe("noindex, follow");
    expect(unchecked.content).toContain("did not answer");
    expect(unchecked.content).toContain("/jobs?job=workday%3Aacme~wd3~Careers%3AJR5");
    const dup = postingStubPage({ path: posting(6), id: "workday:acme~wd3~Careers:JR6", state: "retired", since: null, title: "Nurse", company: "Acme", companyLink: "", windowDays: 30, duplicateOf: posting(7), esc });
    expect(dup.content).toContain(`href="${posting(7)}"`);
  });
});

describe("the homepage file names itself canonical", () => {
  const TEMPLATE = `<html lang="en"><head><title>x</title><meta name="description" content="" /><meta property="og:title" content="" /><meta property="og:description" content="" /><meta name="twitter:title" content="" /><meta name="twitter:description" content="" /><meta property="og:url" content="" /><meta name="twitter:url" content="" /></head><body><div id="root"></div></body></html>`;
  const render = (page: Record<string, unknown>) => composeHtml(
    { title: "Resume Booster", description: "d", content: "<h1>Home</h1>", ...page } as never,
    { template: TEMPLATE, D: { POSTING_LD_TAG_ID: "posting-jsonld" }, esc, shell: (c: string) => c, preloadFor: () => "", publicHref: (p: string) => p, onTruncated: () => {} } as never,
  );

  it("an unknown address served the homepage with no canonical; the fallback now says it is a copy of /", () => {
    const html = render({ path: "/", isFallback: true });
    expect(html).toContain(`<link rel="canonical" href="${SITE}/" />`);
    // The app's own routes run the inline script, which takes the canonical
    // off any path other than "/" before React writes its own.
    expect(html).toMatch(/location\.pathname!=="\/"[^<]*link\[rel="canonical"\][^<]*remove\(\)/);
  });
});

describe("the bake is wired to the live site's record and writes the next one", () => {
  const bake = codeOf(readFileSync(resolve(__dirname, "../../scripts/prerender-seo.mjs"), "utf8"));
  it("reads the live sitemap and ledger before it writes a page, and serves the ledger beside the sitemap", () => {
    const read = bake.indexOf("const liveSitemap = await fetchText(`${SITE}/sitemap.xml`);");
    const ledger = bake.indexOf("const liveLedgerText = await fetchText(`${SITE}${PRERENDER_LEDGER_PATH}`);");
    const firstWrite = bake.indexOf("write({");
    expect(read).toBeGreaterThan(-1);
    expect(ledger).toBeGreaterThan(-1);
    expect(read).toBeLessThan(firstWrite);
    expect(bake).toMatch(/const carrySitemapsNow = carrySitemaps\(\{ ledgerSource, liveSitemap, committedSitemap \}\);/);
    expect(bake).toMatch(/sitemaps: carrySitemapsNow,/);
    expect(bake).toMatch(/writeFileSync\(join\(dist, PRERENDER_LEDGER_PATH\.slice\(1\)\), ledgerJson\)/);
  });
});

describe("the React posting page says what the board does with a posting, not that it drops it the moment the feed does", () => {
  // Reviewer, 2026-10-10 (register L13-34): the false sentence was removed
  // from the bake only. The React posting page, which Google renders over
  // the static one, still said a posting "is dropped the moment the
  // employer's feed stops serving it" in nine locales and in its default;
  // the board drops it at the next re-check of that board.
  const dir = resolve(__dirname, "../i18n/locales");
  const INSTANT = /the moment|sobald|en cuanto|dès que|जैसे ही|zodra|assim que|sa sandaling/;
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    it(`${file}: jobPostingPage.sourceNote states the window and the re-check on open`, () => {
      const note: string = JSON.parse(readFileSync(resolve(dir, file), "utf8")).jobPostingPage.sourceNote;
      expect(note).not.toMatch(INSTANT);
      expect(note).toContain("{{days}}");
    });
  }
  it("the page's own default says the same", () => {
    const page = readFileSync(resolve(__dirname, "../pages/JobPosting.tsx"), "utf8");
    const m = /t\("jobPostingPage\.sourceNote", \{\s*defaultValue:\s*"([^"]+)"/.exec(page);
    expect(m, "could not find the sourceNote default").toBeTruthy();
    expect(m![1]).not.toMatch(INSTANT);
    expect(m![1]).toBe(JSON.parse(readFileSync(resolve(dir, "en.json"), "utf8")).jobPostingPage.sourceNote);
  });
});
