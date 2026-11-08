import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { skipWithoutDist } from "./helpers/built-output";
import { codeOf as codeOfSource } from "./helpers/strip-comments";
import { APP_FOOTER_LINKS, BAKED_FOOTER_LINKS, BAKED_HEADER_LINKS, DATA_PAGE_LINKS } from "@/lib/site-links";
import { HOME_ROWS_WINDOW_DAYS } from "@/lib/home/rows";
import { REDATING_SOURCES } from "@/lib/listing/age";
import { bracketsBalanced } from "../../scripts/prerender-copy.mjs";

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
  // The market-pulse confirmation page: opened only from the single-use link
  // in a confirmation mail (#t=...), noindex, nothing to bake for a crawler.
  "/market-pulse/confirm",
  // The fix-plan confirmation page: opened only from the button in a report
  // mail (#d=...), noindex, nothing to bake for a crawler.
  "/fix-plan/confirm",
  // The unsubscribe page: opened only from the link in one of our mails
  // (#list=...&token=...), noindex, nothing to bake for a crawler.
  "/email/unsubscribe",
];
/** Route families whose every member is private (dev tooling, admin, affiliate redirects). */
const PRIVATE_PREFIXES = ["/dev/", "/admin/", "/r/"];
/**
 * Public routes the prerender does not write and the sitemap does not list.
 * Each one is a debt, named so it cannot hide: legal pages whose text lives
 * only in the component. Adding to this list is a decision, not a default.
 */
//
// /about (SEO-011b) left this list in the SEO round's integration
// (2026-10-24): the React route and the bake's write({ path: "/about" })
// landed together, and the honesty test below asked for it.
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
  // The /v1 guidance pages are written from a list of [path, what] pairs
  // (SEO-015), so they count as written only where that loop writes them.
  const apiPages = /for \(const \[path, what\] of \[\s*\["\/v1", /.test(src)
    ? [...src.matchAll(/\["(\/v1(?:\/[a-z]+)?)", "/g)].map((m) => m[1])
    : [];
  return new Set([...literal, ...landings, ...apiPages]);
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

describe.skipIf(skipWithoutDist(built))("sitemap URLs serve their own prerendered HTML", () => {
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

// ---- B04 / B09 (2026-11-08): what a crawler that runs no JavaScript can reach, and what it is told ----

/**
 * (a) ONE LIST FOR BOTH FOOTERS (B04, LINK-03). The footer the app renders and
 * the one the bake writes into every page were two typed lists, and on
 * 2026-11-07 the baked one linked none of /guides, the three ATS guides beside
 * Workday's, /builder, /data-api, /privacy or /terms. Both now render
 * src/lib/site-links.ts; neither may type a list of its own again.
 */
describe("B04 (a): the app's footer and the bake's shell render one list", () => {
  const footer = codeOfSource(readFileSync(resolve(ROOT, "src/components/Footer.tsx"), "utf8"));
  const bake = codeOfSource(readFileSync(resolve(ROOT, "scripts/prerender-seo.mjs"), "utf8"));

  it("Footer.tsx renders the lists from src/lib/site-links.ts and types no path but /explore", () => {
    expect(footer).toMatch(/import \{[^}]*\bFOOTER_RESOURCES\b[^}]*\bFOOTER_BOTTOM\b|import \{[^}]*\bFOOTER_BOTTOM\b[^}]*\bFOOTER_RESOURCES\b/);
    expect(footer).toMatch(/from "@\/lib\/site-links"/);
    const typed = [...footer.matchAll(/\b(?:to|href)=\{?["'`](\/[^"'`]*)/g)].map((m) => m[1]);
    expect(typed).toEqual(["/explore"]);
    expect(footer).not.toMatch(/\bto:\s*["']\//);
  });

  it("the bake's header and footer render the same module's lists and type no link of their own", () => {
    expect(bake).toMatch(/export \{[^}]*\bBAKED_FOOTER_LINKS\b[^}]*\} from "\.\.\/src\/lib\/site-links"/);
    const shellAt = bake.indexOf("const shell = (contentHtml, lang) =>");
    expect(shellAt).toBeGreaterThan(-1);
    const shell = bake.slice(shellAt, bake.indexOf("</div>`;", shellAt));
    const footerHtml = shell.slice(shell.indexOf("<footer"), shell.indexOf("</footer>"));
    const navHtml = shell.slice(shell.indexOf("<nav"), shell.indexOf("</nav>"));
    expect(footerHtml).toContain("${SHELL_FOOTER_NAV}");
    expect(navHtml).toContain("${SHELL_HEADER_NAV}");
    expect(footerHtml).not.toMatch(/href="\//);
    expect(navHtml).not.toMatch(/href="\//);
    expect(bake).toMatch(/const SHELL_FOOTER_NAV = D\.BAKED_FOOTER_LINKS\.map/);
    expect(bake).toMatch(/const SHELL_HEADER_NAV = D\.BAKED_HEADER_LINKS\.map/);
  });

  it("the baked footer carries every link the app's carries, the guides, the data pages and the legal pages; the baked header carries /guides", () => {
    const baked = BAKED_FOOTER_LINKS.map((l) => l.to);
    for (const l of APP_FOOTER_LINKS) expect(baked, l.to).toContain(l.to);
    for (const p of ["/guides", "/ats/workday", "/ats/greenhouse", "/ats/lever", "/ats/icims", "/builder", "/data-api", "/privacy", "/terms", "/research/ats-score-benchmarks", ...DATA_PAGE_LINKS.map((l) => l.to)]) {
      expect(baked, p).toContain(p);
    }
    expect(BAKED_HEADER_LINKS.map((l) => l.to)).toContain("/guides");
    expect(new Set(baked).size).toBe(baked.length);
  });
});

/** The family a path belongs to: its first segment, or its first two under /jobs and the localized trees. */
const familyOf = (p: string): string => {
  if (p === "/") return "/";
  const seg = p.replace(/^\/|\/$/g, "").split("/");
  return seg.length > 1 && ["jobs", "es", "fr", "pt", "de", "nl", "hi", "tl"].includes(seg[0]) ? seg.slice(0, 2).join("/") : seg[0];
};
const norm = (p: string) => p.replace(/\/$/, "") || "/";
const sitemapLastmods = (): Map<string, string> => {
  const xml = readFileSync(resolve(ROOT, "dist/sitemap.xml"), "utf8");
  return new Map([...xml.matchAll(/<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)].map((m) => [norm(m[1].trim().slice(SITE.length) || "/"), m[2].trim().slice(0, 10)]));
};
const jsonLdOf = (html: string): Array<Record<string, unknown>> =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((m) => { try { return JSON.parse(m[1]); } catch { return null; } })
    .flatMap((d) => (Array.isArray(d) ? d : d && Array.isArray(d["@graph"]) ? d["@graph"] : [d]))
    .filter((d): d is Record<string, unknown> => !!d && typeof d === "object");
const unescapeAttr = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

describe.skipIf(skipWithoutDist(built))("B04 (b, c) and B09: what the built pages link and say", () => {
  it("(b) every standalone sitemap page has 2 inbound links from pages outside its family; every company and posting page has 1", () => {
    const paths = sitemapPaths().map(norm);
    const size = new Map<string, number>();
    for (const p of paths) size.set(familyOf(p), (size.get(familyOf(p)) ?? 0) + 1);
    const inbound = new Map<string, Set<string>>();
    for (const p of paths) {
      const f = servedFile(p);
      if (!f) continue;
      for (const m of readFileSync(f, "utf8").matchAll(/href="(\/[^"#?]*)/g)) {
        const t = norm(m[1]);
        if (familyOf(t) === familyOf(p)) continue;
        if (!inbound.has(t)) inbound.set(t, new Set());
        inbound.get(t)!.add(p);
      }
    }
    const short: string[] = [];
    for (const p of paths) {
      if (p === "/") continue;
      const n = inbound.get(p)?.size ?? 0;
      const need = /^\/jobs\/(?:company|posting)\//.test(p) ? 1 : size.get(familyOf(p)) === 1 ? 2 : 0;
      if (n < need) short.push(`${p} (${n} of ${need})`);
    }
    expect(short, "sitemap pages a crawler that runs no script reaches almost only from the sitemap").toEqual([]);
  });

  it("(c) the homepage prints its strip's heading only over rows, each a posting page this bake wrote, dated as the employer stated", () => {
    const home = readFileSync(FALLBACK_FILE, "utf8");
    const strip = /<ul data-home-strip="">([\s\S]*?)<\/ul>/.exec(home);
    const rows = strip ? [...strip[1].matchAll(/<a href="(\/jobs\/posting\/[^"]+)"/g)].map((m) => m[1]) : [];
    expect(home.includes("On the board now"), "the heading is printed exactly when rows are").toBe(rows.length > 0);
    for (const r of rows) expect(servedFile(norm(r)), r).not.toBeNull();
    if (strip) expect(strip[1]).toMatch(/as stated by the employer/);
    // When the bake wrote a page the strip's rule keeps (dated inside the
    // window by a source that keeps its dates), the strip is not empty.
    const today = [...sitemapLastmods().values()].sort().pop() ?? "";
    const windowStart = new Date(Date.parse(`${today}T00:00:00Z`) - HOME_ROWS_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
    const inWindow = sitemapPaths().map(norm).filter((p) => p.startsWith("/jobs/posting/") && !REDATING_SOURCES.includes(p.split("/")[3] ?? "")).filter((p) => {
      const f = servedFile(p);
      const job = f ? jsonLdOf(readFileSync(f, "utf8")).find((b) => b["@type"] === "JobPosting") : undefined;
      const posted = typeof job?.datePosted === "string" ? job.datePosted.slice(0, 10) : "";
      return posted >= windowStart && posted <= today;
    });
    if (inWindow.length) expect(rows.length, `${inWindow.length} posting pages dated inside the window, none on the homepage`).toBeGreaterThan(0);
  });

  it("B09: a page's sitemap lastmod is the day its own Article or Dataset says it was modified", () => {
    const lastmods = sitemapLastmods();
    const off: string[] = [];
    let dated = 0;
    for (const [p, lm] of lastmods) {
      const f = servedFile(p);
      if (!f) continue;
      for (const b of jsonLdOf(readFileSync(f, "utf8"))) {
        if ((b["@type"] === "Article" || b["@type"] === "Dataset") && typeof b.dateModified === "string") {
          dated++;
          if (b.dateModified.slice(0, 10) !== lm) off.push(`${p}: ${b["@type"]} ${b.dateModified} vs sitemap ${lm}`);
        }
      }
    }
    expect(dated).toBeGreaterThan(5);
    expect(off).toEqual([]);
  });

  it("B09: every sitemap page's description is 70 characters or more, ends a sentence and closes its brackets", () => {
    const bad: string[] = [];
    for (const p of sitemapPaths().map(norm)) {
      const f = servedFile(p);
      if (!f) continue;
      const d = unescapeAttr(/<meta name="description" content="([^"]*)"/.exec(readFileSync(f, "utf8"))?.[1] ?? "");
      // A posting page's description quotes the employer's own title, brackets and all.
      const balanced = p.startsWith("/jobs/posting/") || bracketsBalanced(d);
      if (d.length < 70 || !/[.!?…]["'”’)\]]*$/.test(d) || !balanced) bad.push(`${p} (${d.length}): ${d.slice(-60)}`);
    }
    expect(bad).toEqual([]);
  });

  it("B09: the stray address search engines hold has a file of its own, marked noindex, out of the sitemap", () => {
    const stray = "/jobs/company/0ebd29d1-d85b-444e-b36b-430da3d7bc58";
    const f = servedFile(stray);
    expect(f, "the seeded path fell through to the homepage").not.toBeNull();
    expect(f).not.toBe(FALLBACK_FILE);
    const h = readFileSync(f!, "utf8");
    expect(h).toMatch(/<meta name="robots" content="noindex/);
    expect(/<title>([\s\S]*?)<\/title>/.exec(h)?.[1]).not.toBe(/<title>([\s\S]*?)<\/title>/.exec(readFileSync(FALLBACK_FILE, "utf8"))?.[1]);
    expect(sitemapPaths().map(norm)).not.toContain(stray);
  });
});
