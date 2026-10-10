import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { changedUrls, submit, INDEXNOW_KEY } from "../../scripts/indexnow-ping.mjs";

/**
 * WHAT WAS WRONG (SEO report 2026-10-08, S3): IndexNow was pinged only by
 * hand (`npm run indexnow`), with every URL in the sitemap at once, and never
 * with a URL that had been removed, so Bing (which feeds ChatGPT search and
 * Copilot) learned of a change only at its next crawl. The post-publish
 * verifier now submits what the live publish changed, and the posting URLs
 * it retired, on every clean pass.
 */

const SITE = "https://resumebooster.work";
const sitemap = `<urlset>
  <url>\n    <loc>${SITE}/</loc>\n    <lastmod>2026-10-09</lastmod>\n  </url>
  <url>\n    <loc>${SITE}/guides/x</loc>\n    <lastmod>2026-07-06</lastmod>\n  </url>
  <url>\n    <loc>${SITE}/jobs/company/dominos</loc>\n    <lastmod>2026-10-09</lastmod>\n  </url>
</urlset>`;
const ledger = {
  builtAt: "2026-10-09",
  postings: {
    "/jobs/posting/workday/a~wd1~x/1": { state: "gone", since: "2026-10-09" },
    "/jobs/posting/workday/a~wd1~x/2": { state: "gone", since: "2026-09-30" },
    "/jobs/posting/workday/a~wd1~x/3": { state: "live", since: "2026-10-09" },
    "/jobs/posting/workday/a~wd1~x/4": { state: "retired", since: "2026-10-09" },
  },
};

describe("a publish tells IndexNow what it changed and what it removed", () => {
  it("submits the pages dated the publish day and the postings it retired that day", () => {
    expect(changedUrls({ sitemapXml: sitemap, ledger }).sort()).toEqual([
      `${SITE}/`,
      `${SITE}/jobs/company/dominos`,
      `${SITE}/jobs/posting/workday/a~wd1~x/1`,
      `${SITE}/jobs/posting/workday/a~wd1~x/4`,
    ].sort());
  });

  it("submits nothing without a ledger to say which day the publish was", () => {
    expect(changedUrls({ sitemapXml: sitemap, ledger: null })).toEqual([]);
  });

  it("checks the key file is live before posting, and never throws", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url.endsWith(".txt")) return new Response(INDEXNOW_KEY, { status: 200 });
      return new Response("", { status: 202 });
    }) as unknown as typeof fetch;
    const r = await submit([`${SITE}/`], { fetchImpl: fake });
    expect(r).toMatchObject({ submitted: 1, status: 202, ok: true });
    expect(calls).toEqual([`${SITE}/${INDEXNOW_KEY}.txt`, "https://www.bing.com/indexnow"]);
    const down = await submit([`${SITE}/`], { fetchImpl: (async () => { throw new Error("offline"); }) as unknown as typeof fetch });
    expect(down.submitted).toBe(0);
  });

  it("the post-publish verifier runs it on a clean pass", () => {
    const smoke = codeOf(readFileSync(resolve(__dirname, "../../scripts/post-publish-smoke.mjs"), "utf8"));
    expect(smoke).toMatch(/if \(results\.every\(\(r\) => r\.ok\) && !process\.env\.NO_INDEXNOW\)/);
    expect(smoke).toMatch(/await submitChanged\(\)/);
  });
});
