import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * EVERY URL WE SUBMIT FOR INDEXING MUST SERVE ITS OWN HTML.
 *
 * WHAT THIS PREVENTS, found twice now. A route with no prerendered file falls
 * through to dist/index.html — the SPA fallback — which carries the HOMEPAGE's
 * <title>, <meta description>, og:title, og:description and rendered body. A
 * crawler fetching that URL receives the homepage. Put several such routes in
 * sitemap.xml and you are asking Google to index N duplicates of "/".
 *
 * Round one, audit 2026-07-25: /pricing, /changelog and /explore. The money
 * page had no pricing title, description or canonical in served HTML.
 *
 * Round two, audit 2026-08-15: /methodology, /trust, /affiliates and
 * /freelance-boost — all four declared in the sitemap, all four serving the
 * homepage byte-for-byte, verified live against a Googlebot user-agent.
 *
 * WHY IT SURVIVED A YEAR. Three of the four had a correct <SEO> component, so
 * opening them in a browser showed the right tab title — React swapped it after
 * hydration. Every human check passed. Only the SERVED bytes were wrong, and
 * those are what a non-rendering crawler indexes and what AI answer engines
 * read. SEO that is correct only after JavaScript runs is correct only for the
 * crawlers that never needed the help.
 *
 * The fix for round one was four page entries. Nothing was added to stop it
 * happening again, so it happened again at nearly twice the size. This test is
 * that missing piece: the sitemap and the prerender output have to agree, and
 * disagreeing fails the build rather than quietly shipping duplicates.
 *
 * REQUIRES A BUILD. Without dist/ there is nothing to compare, so the test
 * skips rather than passing — a green tick on an unbuilt tree would be the same
 * kind of false assurance it exists to catch.
 */
const ROOT = resolve(__dirname, "../..");
const SITE = "https://resumebooster.work";

/** Routes whose file is written by the fallback branch, not as a page. */
const FALLBACK_FILE = resolve(ROOT, "dist/index.html");

const sitemapPaths = (): string[] => {
  const xml = readFileSync(resolve(ROOT, "public/sitemap.xml"), "utf8");
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => u.startsWith(SITE))
    .map((u) => u.slice(SITE.length) || "/");
};

/** The file a static host serves for `path`, or null when none exists. */
const servedFile = (path: string): string | null => {
  if (path === "/") return existsSync(FALLBACK_FILE) ? FALLBACK_FILE : null;
  const nested = resolve(ROOT, `dist${path}/index.html`);
  if (existsSync(nested)) return nested;
  const flat = resolve(ROOT, `dist${path}.html`);
  if (existsSync(flat)) return flat;
  return null;
};

const built = existsSync(FALLBACK_FILE);

describe.skipIf(!built)("sitemap URLs serve their own prerendered HTML", () => {
  it("has a built sitemap to check", () => {
    expect(sitemapPaths().length, "sitemap.xml declared no URLs").toBeGreaterThan(10);
  });

  it("gives every sitemap URL a file of its own", () => {
    const orphans = sitemapPaths().filter((p) => p !== "/" && servedFile(p) === null);
    expect(
      orphans,
      `These sitemap URLs have no prerendered file, so the host serves them the ` +
        `HOMEPAGE fallback. Crawlers receive the homepage title, description and ` +
        `body at each one — duplicates of "/" that we are actively submitting ` +
        `for indexing.\n` +
        `  Fix: add a write({ path: … }) entry in scripts/prerender-seo.mjs, or ` +
        `drop the URL from the sitemap if it should not be indexed.\n` +
        `  Orphaned: ${orphans.join(", ")}`,
    ).toEqual([]);
  });

  it("gives no two sitemap URLs the same <title>", () => {
    // The orphan check above catches a MISSING file. This catches the subtler
    // version: a file that exists but was generated with copy-pasted metadata.
    // Duplicate titles across indexed URLs are the symptom Search Console
    // reports as "Duplicate without user-selected canonical".
    const byTitle = new Map<string, string[]>();
    for (const p of sitemapPaths()) {
      const f = servedFile(p);
      if (!f) continue;
      const m = /<title>([\s\S]*?)<\/title>/.exec(readFileSync(f, "utf8"));
      if (!m) continue;
      const list = byTitle.get(m[1]) ?? [];
      list.push(p);
      byTitle.set(m[1], list);
    }
    const dupes = [...byTitle.entries()].filter(([, paths]) => paths.length > 1);
    expect(
      dupes.map(([title, paths]) => `"${title.slice(0, 60)}" ← ${paths.join(", ")}`),
      "Multiple indexed URLs ship the same <title>. Either the pages are genuine " +
        "duplicates (drop all but one from the sitemap) or their prerender entries " +
        "share metadata they should not.",
    ).toEqual([]);
  });

  it("does not serve the homepage's title at any non-homepage URL", () => {
    // The failure mode stated directly, independent of how it happened: a page
    // whose served <title> IS the homepage's is a page a crawler cannot tell
    // apart from the homepage, whatever the reason.
    const home = /<title>([\s\S]*?)<\/title>/.exec(readFileSync(FALLBACK_FILE, "utf8"))?.[1];
    expect(home, "homepage fallback has no <title>").toBeTruthy();
    const wearingIt = sitemapPaths().filter((p) => {
      if (p === "/") return false;
      const f = servedFile(p);
      if (!f || f === FALLBACK_FILE) return true;
      return /<title>([\s\S]*?)<\/title>/.exec(readFileSync(f, "utf8"))?.[1] === home;
    });
    expect(
      wearingIt,
      `These indexed URLs serve the HOMEPAGE's title (${home}). To a crawler they ` +
        `are the homepage.`,
    ).toEqual([]);
  });

  it("never ships two robots directives on one page", () => {
    // Found in this file's own first draft: setting robots=noindex APPENDED a
    // tag beside the template's `index, follow` instead of replacing it, so the
    // page carried both. Which one wins is up to the crawler — that is not a
    // decision to leave to chance on a page we deliberately marked noindex.
    const offenders: string[] = [];
    for (const p of [...sitemapPaths(), "/shortlist"]) {
      const f = servedFile(p);
      if (!f) continue;
      const n = (readFileSync(f, "utf8").match(/<meta name="robots"/g) ?? []).length;
      if (n > 1) offenders.push(`${p} (${n} tags)`);
    }
    expect(offenders, "Pages carrying contradictory robots directives").toEqual([]);
  });

  it("keeps noindex pages out of the sitemap", () => {
    const contradictions = sitemapPaths().filter((p) => {
      const f = servedFile(p);
      if (!f || f === FALLBACK_FILE) return false;
      return /<meta name="robots"[^>]*content="[^"]*noindex/.test(readFileSync(f, "utf8"));
    });
    expect(
      contradictions,
      "These URLs are submitted in the sitemap AND marked noindex — the sitemap " +
        "asks Google to index them, the page tells it not to. Pick one.",
    ).toEqual([]);
  });

  it("gives every prerendered sitemap URL its own canonical", () => {
    const missing: string[] = [];
    for (const p of sitemapPaths()) {
      if (p === "/") continue; // the fallback deliberately ships none — see prerender-seo.mjs
      const f = servedFile(p);
      if (!f) continue; // already reported by the orphan check
      const html = readFileSync(f, "utf8");
      const m = /rel="canonical"[^>]*href="([^"]+)"/.exec(html);
      if (!m || m[1] !== `${SITE}${p}`) missing.push(`${p} → ${m?.[1] ?? "NONE"}`);
    }
    expect(
      missing,
      "Indexed URLs whose canonical is missing or points elsewhere — a canonical " +
        "that disagrees with the URL it sits on tells the crawler to index " +
        "something else.",
    ).toEqual([]);
  });
});
