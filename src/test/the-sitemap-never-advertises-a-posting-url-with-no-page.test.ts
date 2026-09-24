import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { POSTING_PATH_PREFIX } from "@/components/jobs/posting-page";

/**
 * A SITEMAP ENTRY IS A REQUEST TO INDEX THAT URL, SO EVERY ENTRY MUST HAVE A
 * PAGE — AND THE POSTING FAMILY IS THE ONE THAT CAN BREAK THIS AT SCALE.
 *
 * WHAT WE WERE DOING, measured 2026-09-23. robots.txt named two sitemaps. The
 * second was an index served live by the board function: 30 pages, 767,391
 * URLs counted by fetching every page, each of the form /jobs?job=<id>. Every
 * one of them served the SAME bytes as /jobs — same MD5, the board's title,
 * the board's description, and a canonical naming /jobs — so we were asking
 * crawlers to index three quarters of a million copies of one page while
 * telling them on each copy that the real page was somewhere else. An id that
 * does not exist returned those bytes too, which is what a sitemap of shells
 * looks like from the outside: indistinguishable from a sitemap of anything.
 *
 * The standing sitemap has a build-gated orphan check already
 * (sitemap-prerender-parity.test.ts). It could not see this, for two reasons
 * that both generalise: the URLs were not in THAT sitemap, and their number is
 * unbounded. So this file checks the property directly, in three ways:
 *
 *   1. As a PURE FUNCTION over (sitemap text, does this path have a file),
 *      exercised on the real build AND on a synthetic sitemap that names a
 *      posting URL with no file. A checker that has never been shown failing is
 *      a checker nobody knows the shape of.
 *   2. Over the BUILT artifact, which is the only thing a crawler ever sees.
 *   3. Over robots.txt as SOURCE, so no second sitemap of un-backed URLs can be
 *      declared again without this going red — the lever that produced the
 *      767,391 was one line in a text file, not code.
 */

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";

/** Posting paths a sitemap advertises. */
export function advertisedPostingPaths(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.startsWith(SITE))
    .map((u) => u.slice(SITE.length))
    .filter((p) => p.startsWith(`${POSTING_PATH_PREFIX}/`));
}

/**
 * THE PROPERTY, as a function so it can be shown failing: the posting URLs a
 * sitemap advertises for which `hasPage` answers no. Empty is the only pass.
 */
export function advertisedWithoutAPage(xml: string, hasPage: (path: string) => boolean): string[] {
  return advertisedPostingPaths(xml).filter((p) => !hasPage(p));
}

describe("the checker itself detects the thing it exists to detect", () => {
  const withOne = (loc: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><urlset><url><loc>${SITE}/jobs</loc></url><url><loc>${SITE}${loc}</loc></url></urlset>`;

  it("passes a sitemap whose posting URL has a page", () => {
    expect(advertisedWithoutAPage(withOne(`${POSTING_PATH_PREFIX}/ashby/acme/req7`), () => true)).toEqual([]);
  });

  it("FAILS a sitemap whose posting URL has no page", () => {
    // The defect in one line: an advertised URL the host has no file for, which
    // it answers with the app shell — the homepage, to a crawler.
    expect(advertisedWithoutAPage(withOne(`${POSTING_PATH_PREFIX}/ashby/acme/req7`), () => false))
      .toEqual([`${POSTING_PATH_PREFIX}/ashby/acme/req7`]);
  });

  it("does not mistake the board's other pages for posting pages", () => {
    // /jobs, /jobs/field/x and /jobs/company/x are a different family with a
    // different generator; sweeping them in here would make this guard's result
    // depend on work that is not its own.
    const xml = `<urlset><url><loc>${SITE}/jobs</loc></url><url><loc>${SITE}/jobs/company/acme</loc></url><url><loc>${SITE}/jobs/field/nursing</loc></url></urlset>`;
    expect(advertisedPostingPaths(xml)).toEqual([]);
  });
});

describe("robots.txt declares no sitemap of URLs we do not serve", () => {
  const ROBOTS = readFileSync(resolve(ROOT, "public/robots.txt"), "utf8");
  const declared = [...ROBOTS.matchAll(/^\s*Sitemap:\s*(\S+)\s*$/gim)].map((m) => m[1]);

  it("reads a non-trivial robots.txt that still declares our own sitemap", () => {
    expect(ROBOTS.length).toBeGreaterThan(500);
    expect(declared).toContain(`${SITE}/sitemap.xml`);
  });

  it("declares only sitemaps this build writes", () => {
    // A sitemap served by anything other than the bake advertises a URL list
    // nothing in this repository can check. The one that existed listed three
    // quarters of a million URLs that all served one page.
    const foreign = declared.filter((u) => u !== `${SITE}/sitemap.xml`);
    expect(
      foreign,
      "robots.txt points crawlers at a sitemap this build does not generate, so no check here " +
        "can know whether its URLs have pages. Generate those URLs' pages and put them in " +
        "sitemap.xml, or do not advertise them.",
    ).toEqual([]);
  });
});

describe("the generator refuses to write a sitemap that names a posting page it did not build", () => {
  const GEN = codeOf(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8"));

  it("reads the generator, not an empty string", () => {
    expect(GEN.length).toBeGreaterThan(20000);
  });

  it("carries the refusal in code rather than in a note about it", () => {
    // Comment-stripped, because the block that does this is explained in prose
    // immediately above itself.
    expect(GEN).toMatch(/const written = new Set\(postingPaths\)/);
    expect(GEN).toMatch(/unwritten\.length/);
  });

  it("drops the unbacked entries instead of throwing, because a throw here keeps the OLD sitemap", () => {
    // The refusal used to throw. The script's foot carries a never-block-a-
    // publish handler, so the throw was caught and the two writeFileSync calls
    // that replace public/sitemap.xml and dist/sitemap.xml never ran — leaving
    // the COMMITTED sitemap in place, still naming posting URLs this bake did
    // not write. The check would have produced the state it exists to prevent.
    // The shrink ratchet twenty lines below already knew about that hazard.
    expect(GEN).toMatch(/entries = entries\.filter\(\(e\) => !drop\.has\(e\.path\)\)/);
    expect(GEN, "the unbacked-URL check throws again, and a throw here is caught and skips the write")
      .not.toMatch(/throw new Error\(`sitemap names/);
    // And the entries list has to be reassignable for that to be possible.
    expect(GEN).toMatch(/let entries = \[\.\.\.STATIC_ROUTES\]/);
  });

  it("keeps the shrink ratchet from being tripped by a set that is meant to churn", () => {
    // The ratchet aborts the bake when the sitemap would shrink by a fifth. A
    // bake that cannot reach the board correctly writes zero posting pages, and
    // counted together with the standing pages that correct behaviour looks
    // like a collapse — which aborts the bake and LEAVES THE OLD SITEMAP in
    // place, still naming posting URLs whose files were never written. So the
    // ratchet has to compare like with like.
    expect(GEN).toMatch(/const standing = \(u\) => !u\.includes\(/);
    expect(GEN).toMatch(/nowCount < prevCount \* 0\.8/);
  });
});

const DIST_SITEMAP = resolve(ROOT, "dist/sitemap.xml");
const built = existsSync(resolve(ROOT, "dist/index.html")) && existsSync(DIST_SITEMAP);

describe.skipIf(!built)("the built sitemap advertises no posting URL without a page", () => {
  // Parity is a property of ONE bake: read the sitemap that shipped beside
  // these files, never a committed copy a later bake may have rewritten.
  const xml = readFileSync(DIST_SITEMAP, "utf8");
  const hasPage = (path: string) =>
    existsSync(resolve(ROOT, `dist${path}/index.html`)) ||
    existsSync(resolve(ROOT, `dist${path.replace(/\/$/, "")}.html`));

  it("has posting URLs in it to check", () => {
    expect(
      advertisedPostingPaths(xml).length,
      "the built sitemap names no posting page at all — rebuild before reading the check below as a pass",
    ).toBeGreaterThan(0);
  });

  it("gives every one of them a file", () => {
    expect(
      advertisedWithoutAPage(xml, hasPage),
      "these posting URLs are submitted for indexing and have no file behind them — the host " +
        "serves each the app shell, which carries the homepage to every crawler",
    ).toEqual([]);
  });

  it("stays inside the cap the generator states, so the set cannot quietly become unbounded", () => {
    const cap = Number(
      /const POSTING_PAGE_CAP = (\d+)/.exec(codeOf(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8")))![1],
    );
    expect(advertisedPostingPaths(xml).length).toBeLessThanOrEqual(cap);
  });
});
