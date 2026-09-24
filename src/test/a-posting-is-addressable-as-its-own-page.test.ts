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
    // shape that makes that true: the ids come out of the committed sitemap
    // and go into the detail fetch, never through the pool.
    expect(GEN).toMatch(/const carriedDetailed = await fetchDetails\(carried\.slice\(0, POSTING_PAGE_CARRY_MAX\)\)/);
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
    expect(GEN, "the bake still writes pages for staffing-agency rows").toMatch(/j\.agency !== true/);
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
    const carry = /const POSTING_PAGE_CARRY_MAX = (\d+)/.exec(GEN);
    expect(carry, "the generator declares no bound on carried-over pages").toBeTruthy();
    expect(Number(carry![1])).toBeLessThan(n);
  });
});

const DIST = resolve(ROOT, "dist/index.html");
const built = existsSync(DIST);

describe.skipIf(!built)("every posting URL in the built sitemap serves the posting", () => {
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

  it("gives each one a heading and job markup whose address is its own", () => {
    const wrong: string[] = [];
    for (const p of paths) {
      const f = servedFile(p);
      if (!f) continue;
      const html = readFileSync(f, "utf8");
      if (!/<h1>[^<]+<\/h1>/.test(html)) { wrong.push(`${p} → no heading`); continue; }
      // ATTRIBUTES ALLOWED ON THE TAG. The JobPosting block carries the id the
      // React route takes it over by, and a pattern that required the tag to
      // end right after the type read this page as having no job markup at all.
      const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
        .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
        .filter((d) => d && d["@type"] === "JobPosting");
      if (blocks.length !== 1) { wrong.push(`${p} → ${blocks.length} job entities`); continue; }
      if (blocks[0].url !== `${SITE}${p}`) wrong.push(`${p} → markup names ${blocks[0].url}`);
    }
    expect(wrong, "a posting page without its own heading and its own job markup is a page about nothing").toEqual([]);
  });
});
