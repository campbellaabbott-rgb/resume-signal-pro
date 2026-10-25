import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { codeOf } from "./helpers/strip-comments";
import {
  POSTING_PATH_PREFIX,
  postingIdFromParams,
  postingIdFromPath,
  postingPagePath,
  postingPathParts,
} from "@/components/jobs/posting-page";
import { skipWithoutDist } from "./helpers/built-output";

/**
 * A POSTING HAS AN ADDRESS, AND THAT ADDRESS SERVES THE POSTING.
 *
 * WHAT WAS WRONG, measured 2026-09-23 under a Googlebot user-agent. The board
 * showed a posting in a dialog over the list, so the only handle on one was a
 * query parameter. /jobs?job=<id> answered with the same 12,377 bytes as /jobs
 * — MD5 2a0026a438ee41d4caf2a29a6016b272 for the real id, for a second real id
 * and for an id that does not exist — carrying the board's own title, the
 * board's own meta description and a canonical naming /jobs, with no job markup
 * in the served bytes at all. Meanwhile /jobs/posting/<id> served the HOMEPAGE
 * shell (17,966 bytes, MD5 aa3cadba1fcaccf906514f91b928bdca, byte-identical to
 * "/"), because no such route existed. A posting could not be linked, indexed,
 * cited or handed to an answer engine as itself.
 *
 * WHAT THIS GUARDS, in three layers, because each one fails differently:
 *
 *  1. THE ADDRESS ITSELF. A board id has to survive the round trip to a path
 *     and back, and the path may contain only characters this host is already
 *     proven to serve. 25 of 485 company URLs once shipped dead because a dot
 *     in the last segment made the host answer a bare 404 — to crawlers and to
 *     people — so a new page family that invents a character class is a new
 *     copy of that outage.
 *
 *  2. THE WIRING. A page component and a generator that do not meet leave the
 *     route serving the SPA fallback, which is the homepage. Read as SOURCE so
 *     it needs no build: the router must carry the route, and the generator
 *     must write pages under the same prefix, through write() — the single path
 *     into the sitemap.
 *
 *  3. THE ARTIFACT. With a dist/ present, every posting URL in the sitemap must
 *     serve a file of its own, carrying its own title, its own canonical and
 *     its own job markup. This is the only layer that can see what a crawler
 *     actually receives; it skips rather than passes without a build, because a
 *     green tick on an unbuilt tree is the false assurance the SEO audits here
 *     keep being caught by.
 */

const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

describe("a board id round-trips through its page address", () => {
  // Shapes taken from the live board: a Workday tenant id with tildes, an ADP
  // uuid token, and a token that is a hostname (dots in a middle segment).
  const IDS = [
    "workday:rmit~wd3~RMIT_Careers:JR50820-2",
    "adp:02161b08-cb15-42c3-bce4-f772c36f668c:9207170471967_1",
    "phenom:careers.amd.com:1234567",
    "greenhouse:pulse:4001",
  ];

  it("gives every id a path, and every path back the same id", () => {
    for (const id of IDS) {
      const path = postingPagePath(id);
      expect(path, `no path for ${id}`).toBeTruthy();
      expect(postingIdFromPath(path!), `round trip failed for ${id}`).toBe(id);
    }
  });

  it("puts nothing in the path but characters this host already serves", () => {
    // The host reads paths, not ids. A colon, a percent-escape or a space in a
    // path segment is an untested character class on a static host that has
    // already been measured 404ing a dot.
    for (const id of IDS) {
      const path = postingPagePath(id)!;
      expect(path.startsWith(`${POSTING_PATH_PREFIX}/`), path).toBe(true);
      expect(/^[A-Za-z0-9._~@=+/-]+$/.test(path), `unsafe characters in ${path}`).toBe(true);
      expect(path.includes(":"), `a colon survived into ${path}`).toBe(false);
      expect(path.includes("%"), `an escape survived into ${path}`).toBe(false);
    }
  });

  it("gives a dotted last segment the trailing slash that stops the host 404ing it", () => {
    const dotted = postingPagePath("ashby:acme:req.7")!;
    expect(dotted.endsWith("/")).toBe(true);
    expect(postingIdFromPath(dotted)).toBe("ashby:acme:req.7");
    // And does NOT put one on a segment that does not need it, or every
    // canonical on the family would disagree with its own URL.
    expect(postingPagePath("ashby:acme:req7")!.endsWith("/")).toBe(false);
  });

  it("refuses an id it cannot address rather than inventing one", () => {
    for (const bad of ["notanid", "a:b", "a:b:c:d", "a:b:c/d", "a:b:c d", "a::c", ""]) {
      expect(postingPagePath(bad), `${bad} should have no page`).toBeNull();
      expect(postingPathParts(bad), `${bad} should have no parts`).toBeNull();
    }
    expect(postingIdFromParams("a", "b", null)).toBeNull();
    expect(postingIdFromPath("/jobs/company/acme")).toBeNull();
    expect(postingIdFromPath("/jobs/posting/a/b")).toBeNull();
  });
});

describe("the route and the generator agree about where a posting lives", () => {
  const APP = codeOf(read("src/App.tsx"));
  const GEN = codeOf(read("scripts/prerender-seo.mjs"));

  it("reads a router and a generator, not empty strings", () => {
    expect(APP.length).toBeGreaterThan(2000);
    expect(GEN.length).toBeGreaterThan(20000);
  });

  it("routes the posting address in the app", () => {
    // Comment-stripped: the docblock above this file, and the generator's own
    // notes, necessarily contain the prefix they explain.
    const routes = [...APP.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
    const postingRoutes = routes.filter((r) => r.startsWith(`${POSTING_PATH_PREFIX}/`));
    expect(
      postingRoutes.length,
      `no route under ${POSTING_PATH_PREFIX} — a posting URL would serve the SPA fallback, ` +
        `which carries the homepage's title, description and body to every crawler`,
    ).toBeGreaterThan(0);
    // The three-segment form is the one baked and canonicalised; it must exist
    // however the compatibility route is spelled.
    expect(postingRoutes.some((r) => r.split("/").length === 6)).toBe(true);
  });

  it("writes posting pages through the one function that reaches the sitemap", () => {
    // write() is the only path into writtenPaths, and the sitemap is generated
    // from writtenPaths. A page rendered any other way exists on disk and is
    // advertised nowhere, or worse, is advertised and does not exist.
    expect(GEN).toMatch(/postingPaths\.push\(path\)/);
    expect(GEN).toMatch(/write\(\{\s*\n?\s*path,/);
    // And the generator must actually import the shared address helpers rather
    // than spell a second opinion of the URL.
    expect(GEN).toMatch(/postingPagePath/);
    expect(GEN).toMatch(/POSTING_PATH_PREFIX/);
  });

  it("resolves the carried pages by ID, not by hoping they fall in today's newest window", () => {
    // RULE 2 WAS INOPERATIVE ON EVERY BAKE AFTER THE FIRST. The carried set was
    // intersected with the candidate pool, and the pool is the newest ~900 rows
    // of a board taking tens of thousands a day — so a carried posting that is
    // alive and fully eligible simply is not in that window a day later.
    // Measured on a bake hours after the committed one: 397 posting URLs in,
    // 2 kept, 395 dropped, and 10 of 10 of the dropped sampled through the
    // detail action came back live with no missingSince. Each abandoned URL
    // then serves the SPA fallback — the homepage, `index, follow`, no
    // canonical — which is the defect this whole page family exists to end.
    //
    // The property is that the carry set is asked about DIRECTLY. Assert the
    // shape that makes that true: the ids come out of what the LIVE site
    // published (its sitemap and ledger, postingCarryBase) and go into the
    // detail read, every one of them, never through the pool. The carry base
    // itself is run against fixtures in
    // a-published-posting-url-fell-back-to-the-homepage.test.ts.
    expect(GEN).toMatch(/const carriedPaths = \[\.\.\.carryBase\.recheck\.keys\(\)\];/);
    expect(GEN).toMatch(/const carriedChecks = await readDetails\(carriedPaths\.map\(/);
    expect(
      GEN,
      "the carried set is filtered against the pool again — a published URL only survives if it is " +
        "still in today's newest window, which is the churn this was supposed to end",
    ).not.toMatch(/filter\(\(j\) => carried\.has\(j\.id\)\)/);
    // And the /jobs copy promises exactly this, so the two cannot drift.
    expect(GEN).toContain("Pages already published keep their URL while the posting lives");
  });

  it("claims no paging mechanism the board does not give it", () => {
    // The pool loop's comment used to say it paged with the board's keyset
    // cursor. The board returns nextCursor null for the newest sort by
    // construction, so the loop pages by offset and the dedupe by id is what
    // actually holds. A guard that reads an identifier which is null on every
    // response is this repository's documented failure mode, so the loop must
    // not reference one.
    const block = GEN.slice(GEN.indexOf("const pool = []"), GEN.indexOf("const fresh = []"));
    expect(block.length, "the pool loop moved — re-point this guard").toBeGreaterThan(200);
    expect(block, "the pool loop reads a cursor the board does not return for this sort")
      .not.toMatch(/cursor/i);
    expect(block, "nothing dedupes the offset pages").toMatch(/seenIds\.has\(row\.id\)/);
  });

  it("writes the job markup under the id the page takes over, escaped", () => {
    // TWO DEFECTS IN ONE LINE. (a) The React route replaces the baked
    // JobPosting block rather than adding a second entity, and it finds it by
    // id — the bake wrote no id, so a live page ended up with two entities and
    // a page whose posting went stale kept the baked one while saying the
    // posting was gone. (b) JSON.stringify escapes neither `<` nor `/`, and a
    // posting's description is EMPLOYER-AUTHORED text that decodeJdEntities
    // deliberately turns `&lt;` back into `<` — so a JD containing a closing
    // script tag would end the element early and spill the rest of the JSON
    // into the head.
    expect(GEN).toMatch(/id="\$\{D\.POSTING_LD_TAG_ID\}"/);
    expect(GEN).toMatch(/ld\["@type"\] === "JobPosting"/);
    expect(GEN, "the serialised LD goes into a script element unescaped").toMatch(/JSON\.stringify\(ld\)\.replace\(/);
    expect(GEN).toContain("u003c");
  });

  it("gives a staffing agency's posting no page, because the page claims it is not one", () => {
    // Every posting page prints "never an aggregator, never a repost" and names
    // the row's company as the hiring organisation. The board flags staffing
    // agencies on every row (NOT NULL, on the list payload, with a badge and a
    // documented opt-out filter) and nothing here read it, so for an agency row
    // both statements were false. The eligibility filter is where that belongs.
    // The predicate is postingRowEligible (scripts/prerender-pages.mjs) since
    // the reviewer pass of 2026-10-10; the bake must still call it.
    expect(GEN, "the bake no longer judges rows by postingRowEligible").toMatch(/const eligibleRow = \(j\) => postingRowEligible\(j, D\);/);
    expect(codeOf(read("scripts/prerender-pages.mjs")), "the bake still writes pages for staffing-agency rows").toMatch(/j\.agency !== true/);
  });

  it("bounds the set with a cap it states, not with hope", () => {
    const cap = /const POSTING_PAGE_CAP = (\d+)/.exec(GEN);
    expect(cap, "the generator declares no cap on posting pages").toBeTruthy();
    const n = Number(cap![1]);
    expect(n).toBeGreaterThan(0);
    // The whole corpus is three quarters of a million postings and one board
    // round trip each. A "cap" near that size is not a cap.
    expect(n).toBeLessThanOrEqual(5000);
    // Some of the budget is always reserved for postings that have never had a
    // page, or the carried-over set freezes and nothing new is ever addressable.
    // The carried set itself has NO cap any more: a published URL is re-checked
    // until the board says it is gone (a 300 cap under a 400 page cap dropped
    // up to 100 published URLs a bake, unread, L13-36).
    const reserve = /const POSTING_FRESH_RESERVE = (\d+)/.exec(GEN);
    expect(reserve, "the generator reserves nothing for new postings").toBeTruthy();
    expect(Number(reserve![1])).toBeGreaterThan(0);
    expect(Number(reserve![1])).toBeLessThan(n);
    const ceiling = /const POSTING_PAGE_CEILING = (\d+)/.exec(GEN);
    expect(ceiling, "no new page has a ceiling").toBeTruthy();
    expect(Number(ceiling![1])).toBeGreaterThanOrEqual(n);
    expect(Number(ceiling![1])).toBeLessThanOrEqual(5000);
    expect(GEN, "the carry cap is gone").not.toMatch(/POSTING_PAGE_CARRY_MAX/);
  });
});

/**
 * ONE POSTING PAGE, JUDGED. A page must carry its own heading and exactly one
 * JobPosting naming its own address, with one exception the bake records: a
 * carried page that owner decision D7 keeps indexable while its markup is
 * withheld (the name gate refuses the employer's name, or the location ends
 * in another country's name). The bake writes why in the page's posting
 * ledger entry (`markupWithheld`), and only such a page may carry no job
 * markup; it must then carry none at all. A page with no markup and no such
 * entry, a new page with one, or an entry that says withheld beside markup
 * the page still serves is a page about nothing, or a ledger that lies.
 * Returns the problem, or null.
 */
type PostingLedgerEntry = { state?: string; carried?: boolean; markupWithheld?: string } | undefined;
const WITHHELD_REASONS = new Set(["name", "country"]);
function postingPageProblem(path: string, html: string, entry: PostingLedgerEntry): string | null {
  if (!/<h1>[^<]+<\/h1>/.test(html)) return "no heading";
  // ATTRIBUTES ALLOWED ON THE TAG. The JobPosting block carries the id the
  // React route takes it over by, and a pattern that required the tag to end
  // right after the type read this page as having no job markup at all.
  const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .filter((d) => d && d["@type"] === "JobPosting");
  const withheld = entry?.markupWithheld;
  if (withheld !== undefined) {
    if (!WITHHELD_REASONS.has(withheld)) return `the ledger withholds its markup for an unknown reason "${withheld}"`;
    if (entry?.carried !== true) return `the ledger withholds its markup (${withheld}) on a page that was not carried: D7 keeps only pages indexable today`;
    if (blocks.length !== 0) return `the ledger says its markup is withheld (${withheld}) and the page serves ${blocks.length} job entities`;
    if (withheld === "name" && !/<p>The employer\b/.test(html)) return "the ledger withholds its markup for the employer's name, and the page still prints a name";
    return null;
  }
  if (blocks.length !== 1) return `${blocks.length} job entities`;
  if (blocks[0].url !== `${SITE}${path}`) return `markup names ${blocks[0].url}`;
  return null;
}

describe("a posting page is judged by its own heading and markup, or by the reason the bake withheld it", () => {
  const P = "/jobs/posting/smartrecruiters/ThePlace1/744000154839819";
  const ld = (url: string) => `<script type="application/ld+json" data-rb-posting="x">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", url })}</script>`;
  const crumbs = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [] })}</script>`;
  const page = (head: string, body: string) => `<!doctype html><html><head>${head}</head><body><h1>Store Associate</h1>${body}</body></html>`;

  it("passes a page with its heading and one JobPosting naming its own address", () => {
    expect(postingPageProblem(P, page(ld(`${SITE}${P}`) + crumbs, "<p>ThePlace — Lagos</p>"), { state: "live", carried: true })).toBeNull();
  });

  it("fails a page with no job markup and no reason in the ledger", () => {
    expect(postingPageProblem(P, page(crumbs, "<p>ThePlace — Lagos</p>"), { state: "live", carried: true })).toBe("0 job entities");
    expect(postingPageProblem(P, page(crumbs, "<p>ThePlace — Lagos</p>"), undefined)).toBe("0 job entities");
  });

  it("passes a carried page whose markup the bake withheld for its country or its employer's name, and that serves none", () => {
    expect(postingPageProblem(P, page(crumbs, "<p>ThePlace — Lagos</p>"), { state: "live", carried: true, markupWithheld: "country" })).toBeNull();
    expect(postingPageProblem(P, page(crumbs, "<p>The employer — Austin, TX</p>"), { state: "live", carried: true, markupWithheld: "name" })).toBeNull();
  });

  it("fails a withheld page that was not carried, that still serves markup, that prints the refused name, or whose reason is unknown", () => {
    expect(postingPageProblem(P, page(crumbs, "<p>ThePlace — Lagos</p>"), { state: "live", carried: false, markupWithheld: "country" })).toMatch(/not carried/);
    expect(postingPageProblem(P, page(ld(`${SITE}${P}`) + crumbs, "<p>ThePlace — Lagos</p>"), { state: "live", carried: true, markupWithheld: "country" })).toMatch(/serves 1 job entities/);
    expect(postingPageProblem(P, page(crumbs, "<p>Axia Logo Horizontal — Austin, TX</p>"), { state: "live", carried: true, markupWithheld: "name" })).toMatch(/still prints a name/);
    expect(postingPageProblem(P, page(crumbs, "<p>ThePlace — Lagos</p>"), { state: "live", carried: true, markupWithheld: "budget" })).toMatch(/unknown reason/);
  });

  it("fails a page without its own heading, and markup that names another address", () => {
    expect(postingPageProblem(P, "<html><body><p>x</p></body></html>", { state: "live", carried: true })).toBe("no heading");
    expect(postingPageProblem(P, page(ld(`${SITE}/jobs`), ""), { state: "live", carried: true })).toBe(`markup names ${SITE}/jobs`);
  });

  it("the bake writes the reason into the ledger entry of every live page it writes without markup", () => {
    const bake = codeOf(read("scripts/prerender-seo.mjs"));
    expect(bake).toMatch(/postingLedger\[path\] = \{ state: "live", since: TODAY, first, carried, title, company: nm, token: job\.token \?\? null, \.\.\.\(ld \? \{\} : \{ markupWithheld: nameRefused \? "name" : "country" \}\) \};/);
    // A page is written without markup only when it is carried and D7 keeps it.
    expect(bake).toMatch(/if \(!path \|\| \(!ld && !\(\(mismatchOnly \|\| nameOnly\) && carried\)\)\) \{/);
  });
});

const DIST = resolve(ROOT, "dist/index.html");
const built = existsSync(DIST);

describe.skipIf(skipWithoutDist(built))("every posting URL in the built sitemap serves the posting", () => {
  const xml = readFileSync(
    existsSync(resolve(ROOT, "dist/sitemap.xml")) ? resolve(ROOT, "dist/sitemap.xml") : resolve(ROOT, "public/sitemap.xml"),
    "utf8",
  );
  const paths = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.startsWith(SITE))
    .map((u) => u.slice(SITE.length))
    .filter((p) => p.startsWith(`${POSTING_PATH_PREFIX}/`));

  const servedFile = (path: string): string | null => {
    const nested = resolve(ROOT, `dist${path}/index.html`);
    if (existsSync(nested)) return nested;
    const flat = resolve(ROOT, `dist${path.replace(/\/$/, "")}.html`);
    return existsSync(flat) ? flat : null;
  };

  it("has posting URLs to check at all (an empty set would pass everything below)", () => {
    expect(
      paths.length,
      "the built sitemap names no posting page — either the bake could not reach the board " +
        "(in which case rebuild before trusting this) or the page family stopped being generated",
    ).toBeGreaterThan(0);
  });

  it("serves each one its own file, not the homepage shell", () => {
    const home = /<title>([\s\S]*?)<\/title>/.exec(readFileSync(DIST, "utf8"))?.[1];
    const wrong: string[] = [];
    for (const p of paths) {
      const f = servedFile(p);
      if (!f) { wrong.push(`${p} → NO FILE`); continue; }
      const title = /<title>([\s\S]*?)<\/title>/.exec(readFileSync(f, "utf8"))?.[1];
      if (!title || title === home) wrong.push(`${p} → "${title ?? "none"}"`);
    }
    expect(wrong, "posting URLs serving no page, or serving the homepage's title").toEqual([]);
  });

  it("gives each one a canonical naming itself", () => {
    const wrong: string[] = [];
    for (const p of paths) {
      const f = servedFile(p);
      if (!f) continue;
      const c = /rel="canonical"[^>]*href="([^"]+)"/.exec(readFileSync(f, "utf8"))?.[1];
      if (c !== `${SITE}${p}`) wrong.push(`${p} → ${c ?? "NONE"}`);
    }
    expect(wrong, "a canonical that names another page tells the crawler to index that one instead").toEqual([]);
  });

  it("gives each one a heading and job markup whose address is its own, or the reason D7 kept it without", () => {
    const ledgerFile = resolve(ROOT, "dist/prerender-ledger.json");
    const postings: Record<string, PostingLedgerEntry> = existsSync(ledgerFile) ? (JSON.parse(readFileSync(ledgerFile, "utf8")).postings ?? {}) : {};
    const wrong: string[] = [];
    const withheld: string[] = [];
    for (const p of paths) {
      const f = servedFile(p);
      if (!f) continue;
      const why = postingPageProblem(p, readFileSync(f, "utf8"), postings[p]);
      if (why) wrong.push(`${p} → ${why}`);
      else if (postings[p]?.markupWithheld) withheld.push(`${p} (${postings[p]!.markupWithheld})`);
    }
    expect(wrong, "a posting page without its own heading and its own job markup is a page about nothing").toEqual([]);
    // A HANDFUL, NOT A HABIT. D7 keeps the few carried pages a stricter rule
    // would drop; a fault that withholds markup across the set (a country
    // reader that reads every row as a mismatch) would otherwise pass here.
    expect(withheld.length, `pages kept without job markup: ${withheld.join(", ")}`).toBeLessThanOrEqual(Math.max(5, Math.ceil(paths.length * 0.02)));
  });
});
