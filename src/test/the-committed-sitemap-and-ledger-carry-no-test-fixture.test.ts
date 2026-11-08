// @vitest-environment node
/**
 * THE COMMITTED SITEMAP AND LEDGER CARRY NO TEST FIXTURE (SEO/GEO audit
 * 2026-11-07, IDX-05 / B11).
 *
 * The bake writes public/sitemap.xml and public/prerender-ledger.json, and
 * Lovable's publish commits them back to main. Test-fixture employers reached
 * them that way: 114 greenhouse postings on made-up boards and two made-up
 * company pages were published in October, served the homepage copy, and now
 * keep noindex "no longer has a page" stubs, which is the right answer for an
 * address that was once published (they stay, recorded as seeded entries from
 * scripts/seo-seed/). This guard keeps any NEW fixture out:
 *   - the sitemap names no fixture address at all (a stub is noindex and is
 *     never in a sitemap);
 *   - the ledger names a fixture address only as one of those once-published
 *     stubs: listed in the seed, marked seed, and never live.
 * A fixture is recognised by the token shapes the tests use; a check below
 * keeps that list in step with src/test, and real employers whose names merely
 * start the same way (two are on the board today) are not fixtures.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

/** The test-fixture token shapes, case-folded: the made-up employers src/test names. */
const FIXTURE_TOKEN = /^(?:acme(?:\d+|corp\d*|widgets|-?sr|uk|-dev\d+)?(?:~[\w~-]+)?|levertest)$/;
const isFixtureToken = (token: string) => FIXTURE_TOKEN.test(token.toLowerCase());

/** The employer token of a site path: /jobs/company/<t> or /jobs/posting/<vendor>/<t>/<id>. */
function tokenOf(path: string): string | null {
  let p = path.replace(/^https?:\/\/[^/]+/, "");
  try { p = decodeURIComponent(p); } catch { /* keep it as written */ }
  const m = /^\/jobs\/company\/([^/?#]+)/.exec(p) ?? /^\/jobs\/posting\/[^/]+\/([^/?#]+)/.exec(p);
  return m ? m[1] : null;
}
const isFixturePath = (path: string) => { const t = tokenOf(path); return t !== null && isFixtureToken(t); };
const norm = (path: string) => path.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "") || "/";

type LedgerEntry = { state?: string; seed?: boolean; token?: string } | null;
type Ledger = { postings?: Record<string, LedgerEntry>; companies?: Record<string, LedgerEntry>; openings?: Record<string, unknown>; pages?: Record<string, unknown> };

/** Every fixture address the files carry that is not a once-published, seeded, non-live stub. */
function fixtureLeaks({ sitemapXml, ledger, oncePublished }: { sitemapXml: string; ledger: Ledger; oncePublished: Set<string> }): string[] {
  const leaks: string[] = [];
  for (const m of sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    if (isFixturePath(m[1].trim())) leaks.push(`sitemap names ${norm(m[1].trim())}`);
  }
  for (const section of ["postings", "companies"] as const) {
    for (const [path, e] of Object.entries(ledger[section] ?? {})) {
      const fixture = isFixturePath(path) || (typeof e?.token === "string" && isFixtureToken(e.token));
      if (!fixture) continue;
      if (!oncePublished.has(norm(path))) leaks.push(`ledger ${section} names ${path}, which was never published`);
      else if (e?.seed !== true || e?.state === "live") leaks.push(`ledger ${section} holds ${path} as ${e?.state ?? "no state"}${e?.seed === true ? "" : " without seed"}`);
    }
  }
  for (const section of ["openings", "pages"] as const) {
    for (const path of Object.keys(ledger[section] ?? {})) {
      if (isFixturePath(path) && !oncePublished.has(norm(path))) leaks.push(`ledger ${section} names ${path}, which was never published`);
    }
  }
  return leaks;
}

const seed = (name: string) => read(`scripts/seo-seed/${name}`).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map(norm);
const ONCE_PUBLISHED = new Set([...seed("published-posting-paths.txt"), ...seed("published-company-paths.txt")]);
const SITEMAP = read("public/sitemap.xml");
const LEDGER = JSON.parse(read("public/prerender-ledger.json")) as Ledger;

describe("the committed sitemap and ledger carry no test fixture", () => {
  it("public/sitemap.xml and public/prerender-ledger.json hold no fixture address beyond the once-published stubs", () => {
    expect(fixtureLeaks({ sitemapXml: SITEMAP, ledger: LEDGER, oncePublished: ONCE_PUBLISHED })).toEqual([]);
  });

  it("the guard reads real files: its shapes match the fixture addresses that were once published", () => {
    const leaked = [...ONCE_PUBLISHED].filter(isFixturePath);
    expect(leaked.length, "the guard recognises none of the once-published fixture addresses: its token shapes no longer match them").toBeGreaterThan(100);
    expect(SITEMAP.match(/<loc>/g)?.length ?? 0, "the committed sitemap is empty: nothing was checked").toBeGreaterThan(100);
  });

  const once = new Set(["/jobs/posting/greenhouse/acme7/700007", "/jobs/company/levertest"]);
  const okLedger: Ledger = {
    postings: { "/jobs/posting/greenhouse/acme7/700007": { state: "seeded", seed: true, token: "acme7" } },
    companies: { "/jobs/company/levertest": { state: "stub", seed: true, token: "levertest" } },
    pages: { "/jobs/posting/greenhouse/acme7/700007": {}, "/jobs/company/levertest": {} },
  };

  it("positive control: once-published fixture stubs, seeded and not live, pass", () => {
    expect(fixtureLeaks({ sitemapXml: "<urlset><url><loc>https://resumebooster.work/jobs</loc></url></urlset>", ledger: okLedger, oncePublished: once })).toEqual([]);
  });

  it("a fixture address in the sitemap fails, even a once-published one", () => {
    const xml = "<urlset><url><loc>https://resumebooster.work/jobs/posting/greenhouse/acme7/700007</loc></url><url><loc>https://resumebooster.work/jobs/company/AcmeCorp091614/</loc></url></urlset>";
    expect(fixtureLeaks({ sitemapXml: xml, ledger: {}, oncePublished: once })).toEqual([
      "sitemap names /jobs/posting/greenhouse/acme7/700007",
      "sitemap names /jobs/company/AcmeCorp091614",
    ]);
  });

  it("a new fixture posting, or a once-published one written live, fails in the ledger", () => {
    const ledger: Ledger = {
      postings: {
        "/jobs/posting/greenhouse/acmewidgets/1": { state: "live", token: "acmewidgets" },
        "/jobs/posting/greenhouse/acme7/700007": { state: "live", seed: true, token: "acme7" },
        "/jobs/posting/workday/acme~wd5~Ext/R9": { state: "gone", token: "acme~wd5~Ext" },
      },
      pages: { "/jobs/posting/greenhouse/acmewidgets/1": {} },
    };
    expect(fixtureLeaks({ sitemapXml: "", ledger, oncePublished: once })).toEqual([
      "ledger postings names /jobs/posting/greenhouse/acmewidgets/1, which was never published",
      "ledger postings holds /jobs/posting/greenhouse/acme7/700007 as live",
      "ledger postings names /jobs/posting/workday/acme~wd5~Ext/R9, which was never published",
      "ledger pages names /jobs/posting/greenhouse/acmewidgets/1, which was never published",
    ]);
  });

  it("real employers whose names start the same way are not fixtures", () => {
    for (const t of ["acmelogistics", "Acmehouseco", "acmebrick~wd1~Careers"]) expect(isFixtureToken(t), t).toBe(false);
    for (const t of ["acme", "acme0", "acme39", "acmecorp", "AcmeCorp091614", "acme-sr", "acmesr", "acmeuk", "acmewidgets", "acme~a", "acme~wd1~ext", "acme~wd3~Careers_Alt", "acme-dev1~us2~CX_1", "levertest"]) expect(isFixtureToken(t), t).toBe(true);
  });

  it("every acme-shaped employer token the tests use is one the guard recognises", () => {
    const testDir = resolve(ROOT, "src/test");
    const files = readdirSync(testDir).filter((n) => /\.test\.tsx?$/.test(n));
    const used = new Set<string>();
    for (const name of files) {
      const src = readFileSync(join(testDir, name), "utf8");
      for (const m of src.matchAll(/token: ?["`]((?:acme|Acme)[\w~-]*)["`$]/g)) used.add(m[1]);
      for (const m of src.matchAll(/\/jobs\/(?:company|posting\/[a-z]+)\/((?:acme|Acme)[\w~-]*)/g)) used.add(m[1]);
    }
    expect(used.size, "the scan found no acme-shaped fixture token: it reads nothing").toBeGreaterThan(5);
    expect([...used].filter((t) => !isFixtureToken(t)), "these fixture tokens would leak past the guard: add their shape to FIXTURE_TOKEN").toEqual([]);
  });
});
