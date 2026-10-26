/**
 * SEO-012: THE HISTORICAL URLS CAN BE RESUBMITTED, AND NOTHING IS SENT
 * WITHOUT THE OWNER'S GO-AHEAD.
 *
 * scripts/indexnow-ping.mjs had only "every sitemap <loc>" and --changed: no
 * way to resubmit the 2,920 URLs published before the ledger existed (which
 * indexes still hold with retired titles), no dry run, and no notice of a page
 * whose title changed. A dry run must never touch the network; --changed must
 * name a page whose title changed and never one whose count merely moved, nor
 * a posting page that states nothing checked.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { changedUrls, dryRunReport, submit, urlOfPath, urlsFromList } from "../../scripts/indexnow-ping.mjs";
import { COUNT_BEARING, contentFingerprint } from "../../scripts/prerender-pages.mjs";

const ROOT = resolve(__dirname, "../..");

describe("--urls: a list of paths or URLs, this site's own, each once", () => {
  it("turns paths into served addresses and drops other hosts, comments and repeats", () => {
    const urls = urlsFromList("# comment\n/\n/privacy\n/jobs/company/careers.ulta.com\nhttps://resumebooster.work/terms\nhttps://example.com/x\n/privacy\n\n");
    expect(urls).toEqual([
      "https://resumebooster.work/",
      "https://resumebooster.work/privacy",
      "https://resumebooster.work/jobs/company/careers.ulta.com/",
      "https://resumebooster.work/terms",
    ]);
    expect(urlOfPath("/jobs/company/dominos")).toBe("https://resumebooster.work/jobs/company/dominos");
  });
  it("the committed historical list carries the seed and the five pages the report names", () => {
    const urls = urlsFromList(readFileSync(resolve(ROOT, "scripts/seo-seed/indexnow-historical-urls.txt"), "utf8"));
    for (const p of ["/", "/privacy", "/terms", "/ghost-job-index", "/research/ats-score-benchmarks"]) expect(urls).toContain(urlOfPath(p));
    const seedCount = (f: string) => readFileSync(resolve(ROOT, "scripts/seo-seed", f), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#")).length;
    expect(urls.length).toBe(5 + seedCount("published-company-paths.txt") + seedCount("published-posting-paths.txt"));
    expect(urls.length).toBeLessThanOrEqual(10000);
  });
});

describe("--dry-run sends nothing", () => {
  it("never calls fetch, and says what it would have sent", async () => {
    const fetchImpl = vi.fn();
    const r = await submit(["https://resumebooster.work/privacy"], { fetchImpl: fetchImpl as unknown as typeof fetch, dryRun: true });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r.submitted).toBe(0);
    expect(r.reason).toMatch(/dry run/);
    expect(dryRunReport(["https://resumebooster.work/jobs/company/a", "https://resumebooster.work/privacy"])).toMatch(/nothing was sent[\s\S]*2 URL\(s\): 1 company pages, 1 other pages/);
  });
});

describe("--changed names a page whose title changed, never a count that moved", () => {
  const ledger = {
    builtAt: "2026-10-19",
    postings: {
      "/jobs/posting/a/b/1": { state: "unchecked", since: "2026-10-19" },
      "/jobs/posting/a/b/2": { state: "seeded", seed: true, since: "2026-10-19" },
      "/jobs/posting/a/b/3": { state: "live", since: "2026-10-19" },
    },
    pages: {
      "/privacy": { lastmod: "2026-10-04", thChanged: "2026-10-19" },
      "/jobs/company/dominos": { lastmod: "2026-10-01", thChanged: "2026-10-01" },
      "/jobs/posting/a/b/1": { thChanged: "2026-10-19" },
      "/jobs/posting/a/b/2": { thChanged: "2026-10-19" },
      "/jobs/posting/a/b/3": { thChanged: "2026-10-19" },
      "/jobs/company/careers.ulta.com": { thChanged: "2026-10-19" },
    },
  };
  it("adds the retitled pages, skipping posting pages that state nothing checked", () => {
    const urls = changedUrls({ sitemapXml: "", ledger });
    expect(urls).toContain("https://resumebooster.work/privacy");
    expect(urls).toContain("https://resumebooster.work/jobs/posting/a/b/3");
    expect(urls).toContain("https://resumebooster.work/jobs/company/careers.ulta.com/");
    expect(urls).not.toContain("https://resumebooster.work/jobs/company/dominos");
    expect(urls).not.toContain("https://resumebooster.work/jobs/posting/a/b/1");
    expect(urls).not.toContain("https://resumebooster.work/jobs/posting/a/b/2");
  });
  it("the title hash the bake keeps is blind to a count on a count-bearing page", () => {
    const th = (title: string, path: string) => contentFingerprint(title, { blindCounts: COUNT_BEARING(path) });
    expect(th("Domino's jobs: 23,789 open roles from their own hiring system", "/jobs/company/dominos"))
      .toBe(th("Domino's jobs: 24,001 open roles from their own hiring system", "/jobs/company/dominos"));
    expect(th("Privacy Policy — Resume Booster", "/privacy")).not.toBe(th("Privacy Policy — Zero Ghost Jobs", "/privacy"));
  });
  it("the bake writes th and thChanged into every page entry, and an old entry without th flags nothing", () => {
    const bake = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8");
    expect(bake).toMatch(/th: contentFingerprint\(String\(page\.title \?\? ""\), \{ blindCounts: COUNT_BEARING\(page\.path\) \}\)/);
    expect(bake).toMatch(/return \[path, th \? \{ \.\.\.entry, th, thChanged \} : entry\];/);
    expect(bake).toMatch(/typeof prior\.th !== "string" \? \(typeof prior\.thChanged === "string" \? prior\.thChanged : \(prior\.changed/);
  });
});
