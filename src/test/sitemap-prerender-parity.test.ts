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

/**
 * ROUND THREE, 2026-09-15: /agents. The MCP server's human page had a correct
 * <SEO> component, a footer link, and an App.tsx route — and served the
 * 17,411-byte homepage shell to a Googlebot user-agent, because nothing above
 * this line runs without a dist/ and nothing anywhere compared the ROUTER's
 * public routes to the prerender's page list. The build-gated checks below
 * catch a sitemap URL with no file; they cannot catch a route that was never
 * put in the sitemap in the first place, which is how every one of the three
 * rounds began.
 *
 * So this block reads App.tsx and prerender-seo.mjs as SOURCE and needs no
 * build: every public route in the router must have a page entry in the
 * prerender script, or it is served as the homepage to every crawler. Routes
 * that are private, parameterised (their pages are written in loops from data
 * modules) or deliberately unindexed are named below, each with its reason —
 * an allowlist that grows silently would be a mute button, so it is explicit
 * and every entry must still exist in the router.
 */
const APP_ROUTES = (): string[] => {
  const src = readFileSync(resolve(ROOT, "src/App.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
  return [...src.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);
};

/** Private, session-bound, or operator-only: never meant for a crawler. */
const PRIVATE_ROUTES = [
  "/auth", "/account", "/success", "/product-success", "/payment-failed",
  "/analytics", "/errors", "/health-check", "/scan-metrics",
  // The Agent Pass receipt page: Stripe's success_url, signed-in only, marked
  // noindex, reads the buyer's own pass row — nothing to bake for a crawler.
  "/agents/pass",
  // The OAuth consent route: exists only for an authorization request from an
  // agent host (?authorization_id=), signed-in only, noindex, no prerender.
  "/oauth/consent",
];
/** Route families whose every member is private (dev tooling, admin, affiliate redirects). */
const PRIVATE_PREFIXES = ["/dev/", "/admin/", "/r/"];
/**
 * Public routes the prerender does not write and the sitemap does not list.
 * Each one is a debt, named so it cannot hide: legal pages whose text lives
 * only in the component. Adding to this list is a decision, not a default.
 */
const KNOWN_FALLBACK_ROUTES = ["/privacy", "/terms"];

const PRERENDERED_PATHS = (): Set<string> => {
  const src = readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8")
    .replace(/^\s*\/\/[^\n]*/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  // ONLY the write() sites count as pages. A bare `path: "/x"` literal also
  // appears in STATIC_ROUTES (the sitemap list) and in breadcrumb arguments,
  // and a route added to STATIC_ROUTES alone puts the fallback shell in the
  // sitemap — the exact trap this describe exists for — so the match is
  // anchored to the head of a write() object (the homepage's write leads with
  // its fallback flag, hence the bounded head rather than `write({ path`).
  const literal = [...src.matchAll(/write\(\{[\s\S]{0,60}?path:\s*"(\/[^"$]*)"/g)].map((m) => m[1]);
  // Tool landings are written from their data module (`path: cfg.path`), so
  // their routes count as written only if the script really iterates them.
  const landings = /path:\s*cfg\.path/.test(src)
    ? [...readFileSync(resolve(ROOT, "src/data/tool-landings.ts"), "utf8").matchAll(/path:\s*"(\/[^"]+)"/g)].map((m) => m[1])
    : [];
  return new Set([...literal, ...landings]);
};

describe("every public route in the router has a prerendered page", () => {
  const routes = APP_ROUTES();
  const isPublicStatic = (r: string) =>
    !r.includes(":") && r !== "*" &&
    !PRIVATE_ROUTES.includes(r) &&
    !PRIVATE_PREFIXES.some((p) => r.startsWith(p));

  it("reads a non-trivial router (an empty match would pass everything below vacuously)", () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes).toContain("/");
  });

  it("names on its allowlists only routes that still exist", () => {
    // An entry for a route that was deleted is an entry that will quietly
    // exempt whatever is created under that path next.
    for (const r of [...PRIVATE_ROUTES, ...KNOWN_FALLBACK_ROUTES]) {
      expect(routes, `${r} is on an allowlist but not in App.tsx`).toContain(r);
    }
    for (const p of PRIVATE_PREFIXES) {
      expect(routes.some((r) => r.startsWith(p)), `no route under ${p} — drop the prefix`).toBe(true);
    }
  });

  it("gives every public static route a page entry in scripts/prerender-seo.mjs", () => {
    const written = PRERENDERED_PATHS();
    const missing = routes
      .filter(isPublicStatic)
      .filter((r) => !KNOWN_FALLBACK_ROUTES.includes(r))
      .filter((r) => !written.has(r));
    expect(
      missing,
      `Public routes with no write({ path }) in scripts/prerender-seo.mjs — the host ` +
        `serves each one the HOMEPAGE to every crawler, and the build-gated checks ` +
        `above cannot see it because the route never reached the sitemap.\n` +
        `  Fix: add a write({ path: … }) entry (and the sitemap picks it up from ` +
        `writtenPaths), or, for a genuinely private route, name it in PRIVATE_ROUTES ` +
        `with its reason.\n  Missing: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("keeps the known-fallback list honest: none of its routes is actually prerendered", () => {
    const written = PRERENDERED_PATHS();
    const stale = KNOWN_FALLBACK_ROUTES.filter((r) => written.has(r));
    expect(stale, "these routes are prerendered now — remove them from KNOWN_FALLBACK_ROUTES").toEqual([]);
  });
});

const sitemapPaths = (): string[] => {
  // THE SITEMAP UNDER TEST IS THE BAKE'S OWN. prerender-seo.mjs writes the
  // regenerated sitemap to public/ AND dist/ in one step (its "single source
  // of truth" block), so dist/sitemap.xml names exactly the pages beside it.
  // public/sitemap.xml is committed and can be regenerated by a LATER bake on
  // the deploy host: on 2026-09-15 the host's bake rewrote it (a fresh top-500
  // company selection, /agents added) while the local dist/ was nine days old,
  // and reading the committed copy against that dist reported 162 "orphans"
  // and three canonical "mismatches" that were two bakes compared with each
  // other, not a page served wrong. Parity is a property of ONE bake: read the
  // sitemap that shipped with these files, and fall back to the committed copy
  // only when dist/ carries none.
  const DIST_SITEMAP = resolve(ROOT, "dist/sitemap.xml");
  const xml = readFileSync(existsSync(DIST_SITEMAP) ? DIST_SITEMAP : resolve(ROOT, "public/sitemap.xml"), "utf8");
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

  it("never publishes a dotted URL without a trailing slash", () => {
    // Measured live 2026-08-15: /jobs/company/careers.amd.com returned HTTP 404
    // (9-byte "Not found") while the same path with a trailing slash returned
    // 200 with the right page. The host reads the dot as a file extension and
    // never reaches the SPA fallback. 25 of 485 company URLs were affected —
    // 25/25 dotted failed, 460/460 plain passed, so it is deterministic — and
    // it broke ordinary browsers too, not just crawlers.
    const bad = sitemapPaths().filter((p) => {
      const last = p.split("/").pop() ?? "";
      return last.includes(".") && !p.endsWith("/");
    });
    expect(
      bad,
      "Sitemap URLs whose last segment contains a dot but has no trailing " +
        "slash. The host 404s these for crawlers AND for humans. Emit them " +
        "via publicHref() so they carry the slash.",
    ).toEqual([]);
  });

  it("ships exactly one WebSite JSON-LD entity on the homepage", () => {
    // index.html carries the site's WebSite block; prerender-seo.mjs briefly
    // added a second with the same name and url, one holding the SearchAction
    // and one not. Two competing entities for one URL lets Google attribute
    // the sitelinks searchbox to the block that does not declare it.
    const html = readFileSync(FALLBACK_FILE, "utf8");
    const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    const websites = blocks
      .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
      .flatMap((d) => (Array.isArray(d) ? d : [d]))
      .filter((d) => d && d["@type"] === "WebSite");
    expect(websites.length, "Homepage must declare exactly one WebSite entity").toBe(1);
    expect(
      websites[0]?.potentialAction?.["@type"],
      "The single WebSite entity should carry the SearchAction (sitelinks searchbox)",
    ).toBe("SearchAction");
  });

  it("never ships a homepage description truncated by the SERP clamp", () => {
    // A description authored over 160 chars gets cut at a word boundary with an
    // ellipsis appended. The homepage's ran to 279 and ended "…Upload your CV
    // and an AI…" — the snippet Google shows trailed off BEFORE the word
    // "agent", so the change that made the agent the headline never reached the
    // search result at all.
    //
    // SCOPED TO THE HOMEPAGE ON PURPOSE. A build-wide assertion would fail on
    // 769 pre-existing pages (500 company, 161 role, 74 industry — all
    // templated descriptions that predate this) and that is a backlog to decide
    // on, not a regression to block on. prerender-seo.mjs now WARNS with the
    // full list on every build, so the rest is visible rather than silent.
    const m = /<meta name="description" content="([^"]*)"/.exec(readFileSync(FALLBACK_FILE, "utf8"));
    expect(m, "homepage has no meta description").toBeTruthy();
    expect(
      m![1].endsWith("…"),
      `Homepage description was clipped by the 160-char clamp — shorten it at ` +
        `the source in prerender-seo.mjs. Got: "${m![1]}"`,
    ).toBe(false);
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
