import { beforeAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import { POSTING_PATH_PREFIX } from "@/components/jobs/posting-page";
import { skipWithoutDist } from "./helpers/built-output";
import { LANDER_OPENINGS_READS, postingFreshBudget } from "../../scripts/prerender-pages.mjs";

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

describe.skipIf(skipWithoutDist(built))("the built sitemap advertises no posting URL without a page", () => {
  // Parity is a property of ONE bake: read the sitemap that shipped beside
  // these files, never a committed copy a later bake may have rewritten.
  // Read in the hook, not at collection: a skipped describe still runs its
  // body to collect, and a read there raised ENOENT for every tree without
  // a local dist (reviewed 2026-09-27).
  let xml = "";
  beforeAll(() => { xml = readFileSync(DIST_SITEMAP, "utf8"); });
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

  // THE BOUND THE GENERATOR STATES, read from what this bake recorded. This
  // used to compare the count with POSTING_PAGE_CAP, which stopped being a
  // bound on 2026-10-10 (SEO F2a, L13-36): carried pages have no cap, new ones
  // stop at POSTING_PAGE_CEILING, and the 2026-10-11 bake carried 454 and
  // added 46. Main's CI went red on a bake that did exactly what its rule says.
  it("adds no new posting page past the ceiling, and carries no more than the bake can re-check", () => {
    const ledger = JSON.parse(readFileSync(resolve(ROOT, "dist/prerender-ledger.json"), "utf8")) as {
      builtAt: string;
      postings: Record<string, { state: string; first?: string; carried?: unknown }>;
    };
    const live = Object.entries(ledger.postings).filter(([, e]) => e.state === "live");
    const livePaths = new Set(live.map(([p]) => p));
    expect(advertisedPostingPaths(xml).filter((p) => !livePaths.has(p)), "advertised posting URLs the bake's ledger does not call live").toEqual([]);
    expect(live.filter(([, e]) => typeof e.carried !== "boolean").map(([p]) => p), "live pages that do not say whether they were carried").toEqual([]);
    // A page first published on an earlier day can only have been carried.
    expect(live.filter(([, e]) => e.carried === false && e.first !== ledger.builtAt).map(([p]) => p)).toEqual([]);

    const carried = live.filter(([, e]) => e.carried === true).length;
    const fresh = live.length - carried;
    const ceiling = generatorNumber("POSTING_PAGE_CEILING");
    expect(fresh).toBeLessThanOrEqual(postingFreshBudget({
      carriedLive: carried, cap: generatorNumber("POSTING_PAGE_CAP"), reserve: generatorNumber("POSTING_FRESH_RESERVE"), ceiling,
    }));
    expect(live.length).toBeLessThanOrEqual(Math.max(ceiling, carried));
    // Every carried page is one board read, and the bake's reads are fixed.
    expect(carried).toBeLessThanOrEqual(generatorNumber("BAKE_BOARD_CALL_BUDGET") - LANDER_OPENINGS_READS);
  });
});

/** A numeric constant the bake declares, read from its code (not its comments). */
function generatorNumber(name: string): number {
  const m = new RegExp(`const ${name} = (\\d+);`).exec(codeOf(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8")));
  expect(m, `scripts/prerender-seo.mjs declares no ${name}`).toBeTruthy();
  return Number(m![1]);
}

describe("the posting budget is a ceiling on new pages, not the cap its name suggests", () => {
  const rule = () => ({
    cap: generatorNumber("POSTING_PAGE_CAP"),
    reserve: generatorNumber("POSTING_FRESH_RESERVE"),
    ceiling: generatorNumber("POSTING_PAGE_CEILING"),
  });

  it("the bake computes its budget through the one rule this file checks", () => {
    const GEN = codeOf(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8"));
    expect(GEN).toMatch(/const freshBudget = postingFreshBudget\(\{ carriedLive, cap: POSTING_PAGE_CAP, reserve: POSTING_FRESH_RESERVE, ceiling: POSTING_PAGE_CEILING \}\);/);
    expect(GEN).toMatch(/if \(fresh\.length >= freshBudget\) break;/);
    expect(GEN, "a live ledger entry no longer says whether it was carried").toMatch(/postingLedger\[path\] = \{ state: "live", since: TODAY, first, carried,/);
  });

  it("TEETH: the bake that turned main red was inside its rule and outside POSTING_PAGE_CAP", () => {
    const { cap, ceiling, ...r } = rule();
    const fresh = postingFreshBudget({ carriedLive: 454, cap, ceiling, ...r });
    expect(454 + fresh).toBe(ceiling);
    expect(454 + fresh).toBeGreaterThan(cap);
  });

  it("keeps the reserve moving under the ceiling, and adds nothing once the carried pages reach it", () => {
    const { cap, reserve, ceiling } = rule();
    expect(postingFreshBudget({ carriedLive: 0, cap, reserve, ceiling })).toBe(cap);
    expect(postingFreshBudget({ carriedLive: cap, cap, reserve, ceiling })).toBe(Math.min(reserve, ceiling - cap));
    expect(postingFreshBudget({ carriedLive: ceiling, cap, reserve, ceiling })).toBe(0);
    expect(postingFreshBudget({ carriedLive: ceiling + 50, cap, reserve, ceiling })).toBe(0);
    for (let carriedLive = 0; carriedLive <= ceiling + 100; carriedLive += 7) {
      expect(carriedLive + postingFreshBudget({ carriedLive, cap, reserve, ceiling })).toBeLessThanOrEqual(Math.max(ceiling, carriedLive));
    }
  });
});

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * AND THE ENDPOINT ITSELF, BECAUSE REMOVING THE SIGN DOES NOT CLOSE THE ROAD.
 *
 * The describe above pins robots.txt, on the reasoning stated at the top of
 * this file: "the lever that produced the 767,391 was one line in a text file,
 * not code". That was wrong, and it cost a week of traffic to find out.
 *
 * Taking the Sitemap line out of robots.txt removed the ADVERTISEMENT. The
 * board function kept SERVING the index, and a crawler does not consult
 * robots.txt to decide whether to re-fetch a URL it already has — Google had
 * already counted 767,391 of them. Measured live on 2026-10-01, eight days
 * after the "fix": ?action=sitemap still answered with a 30-page index, page 0
 * still carried 24,449 URLs in 3.3 MB, uncached at the CDN, 7.4 s per page,
 * and 200 to Bytespider, Baiduspider, PetalBot and curl alike. ~733,000 URLs
 * at ~81 KB each is about 59 GB of uncached egress per full crawl, per
 * crawler. The owner reported it as a flood of foreign traffic and asked
 * whether they were being spammed. They were not; we were serving it.
 *
 * So this half checks the SERVER, not the text file: there is no branch left
 * that builds a sitemap of board URLs, and the action that used to is answered
 * 410 — the terminal status that empties a crawler's queue, where a 404 is
 * retried for months.
 * ─────────────────────────────────────────────────────────────────────────────
 */
describe("the board function serves no sitemap, and says so terminally", () => {
  const FN = codeOf(readFileSync(resolve(ROOT, "supabase/functions/job-board/index.ts"), "utf8"));

  it("reads the function, not an empty string", () => {
    expect(FN.length, "the board function read as empty — every check below would pass vacuously")
      .toBeGreaterThan(50_000);
    expect(FN, "the sitemap action is gone entirely, so re-point this file").toContain('"sitemap"');
  });

  it("builds no sitemap of board URLs anywhere in the function", () => {
    // The two shapes it used to emit. Either one returning is the 767,391 back.
    for (const shape of ["<sitemapindex", "<urlset"]) {
      expect(
        FN.includes(shape),
        `the function builds ${shape} again — that is a sitemap of /jobs?job= shells, ` +
          "which is the thing this whole file exists to keep off the wire",
      ).toBe(false);
    }
    expect(
      /<loc>/.test(FN),
      "the function emits sitemap <loc> entries again",
    ).toBe(false);
  });

  it("answers the retired action 410, not 404 and not a payload", () => {
    const i = FN.indexOf('u.searchParams.get("action") === "sitemap"');
    expect(i, "nothing handles the retired sitemap action — it must be answered, not fall through " +
      "to the generic 405, or crawlers keep retrying it").toBeGreaterThan(0);
    const branch = FN.slice(i, i + 700);
    expect(branch, "the retired sitemap action must answer 410 Gone; a 404 is retried for months")
      .toMatch(/status:\s*410/);
  });

  it("handles it exactly once, so no earlier branch can still serve one", () => {
    const hits = [...FN.matchAll(/u\.searchParams\.get\("action"\) === "sitemap"/g)].length;
    expect(hits, "more than one sitemap branch: the 410 may sit behind one that still serves")
      .toBe(1);
  });
});
