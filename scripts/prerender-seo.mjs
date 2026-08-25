#!/usr/bin/env node
// Build-time prerender of the ~260 data-driven SEO routes into real HTML
// files under dist/. Runs automatically after `vite build` (see the
// prerender-seo plugin in vite.config.ts).
//
// Why: the SPA serves an empty <div id="root"> to every crawler. Google
// renders JS (slowly, via its render queue); Bing, DuckDuckGo, and most AI
// crawlers effectively don't. These files give every crawler full content
// plus correct per-route <head> tags (title/description/canonical/hreflang/
// JSON-LD) that react-helmet can only set client-side.
//
// How it stays safe:
// - Content is generated from the SAME data modules the React pages import,
//   so pages and prerender can't drift apart on facts.
// - Each file is the built index.html with head tags swapped and content
//   injected into #root — all script tags intact, so a real visitor still
//   gets the full SPA (React re-renders over the static content on load).
// - Any failure logs loudly but exits 0: a broken prerender must never block
//   a publish. Worst case is the pre-existing status quo (SPA-only).

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const SITE = "https://resumebooster.work";

try {
  // ---- Bundle the pure-data modules for Node import ----
  const entry = join(root, "scripts", ".prerender-data-entry.ts");
  writeFileSync(entry, `
export { INDUSTRY_KEYWORDS, SUB_INDUSTRY_TAXONOMY } from "../supabase/functions/free-keyword-scan/industry-detection";
export { ONET_EXPECTATIONS } from "../supabase/functions/free-keyword-scan/onet-expectations";
export { ROLE_PAGES, rolesForIndustry } from "../src/data/roles";
export { TOOL_LANDINGS } from "../src/data/tool-landings";
export { COMPETITORS } from "../src/data/competitors";
export { VENDORS } from "../src/data/ats-vendors";
export { ES_INDUSTRIES, isSpanish } from "../src/data/es-industries";
export { SCREENER_NOTES } from "../src/data/screener-notes";
export { GUIDES, guideGrounding } from "../src/data/guides";
export { buildIndustryFaqs } from "../src/data/industry-faqs";
export { COUNTRY_STANDARDS } from "../supabase/functions/free-keyword-scan/country-standards";
export { COUNTRY_SLUGS, CV_LOCALES, EN_TEMPLATE, fill, hreflangCluster } from "../src/data/cv-standards-content";
export { getAllProducts } from "../src/config/products";
export { changelog } from "../src/data/changelog";
export { default as EN_LOCALE } from "../src/i18n/locales/en.json";
`);
  const bundle = join(root, "scripts", ".prerender-data.mjs");
  execSync(`npx esbuild "${entry}" --bundle --format=esm --outfile="${bundle}" --log-level=error`, { cwd: root, stdio: "inherit" });
  const D = await import(bundle + `?t=${Date.now()}`);

  // ---- Live benchmark numbers for llms-full.txt (GEO: AI engines cite
  // numbers with provenance). Graceful skip offline/CI — the build never
  // blocks on the network. ----
  let insights = null;
  let boardFacets = null;
  try {
    // Local builds read .env; CI/hosted builders inject process.env instead.
    let envText = "";
    try { envText = readFileSync(join(root, ".env"), "utf8"); } catch { /* no .env on hosted builders */ }
    const grab = (k) => process.env[k] || (envText.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
    const supaUrl = grab("VITE_SUPABASE_URL");
    const supaKey = grab("VITE_SUPABASE_PUBLISHABLE_KEY");
    if (supaUrl && supaKey) {
      const r = await fetch(`${supaUrl}/rest/v1/rpc/get_public_scan_insights`, {
        method: "POST",
        headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) insights = await r.json();
      // Retry + shape-validate: the facets RPC is heavy over 160k+ rows and
      // occasionally returns a transient error body or times out cold. Company
      // landing pages depend on companiesFacet, so accept only a real payload and
      // give it a few tries before falling back to countless landers.
      // 5 spaced tries: since the cold-rotation throughput bump the DB has
      // busier windows, and this RPC flaked twice in one day at 3 tries (the
      // sitemap ratchet caught both — this makes the flake rare again).
      for (let attempt = 0; attempt < 5 && !boardFacets; attempt++) {
        try {
          if (attempt) await new Promise((r) => setTimeout(r, 3500));
          const fr = await fetch(`${supaUrl}/rest/v1/rpc/get_job_board_facets`, {
            method: "POST",
            headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}`, "Content-Type": "application/json" },
            body: "{}",
            signal: AbortSignal.timeout(20000),
          });
          if (fr.ok) {
            const j = await fr.json();
            if (j && typeof j.total === "number" && Array.isArray(j.companiesFacet)) boardFacets = j;
          }
        } catch { /* retry; offline/slow build ships landers with fallback counts */ }
      }
    }
  } catch { /* offline build — llms-full ships without the live-numbers section */ }

  // ---- Facets resilience ladder (2026-07-25 incident) ----
  // The get_job_board_facets RPC is a heavy live query; during a busy
  // maintenance window it failed all 5 tries ON THE HOSTED BUILDER and the
  // publish shipped ZERO company pages — 500 sitemap URLs served the home
  // shell. Two fallbacks, tried in order:
  //   1. The board FUNCTION's list response — the same facets, served from
  //      the meta cache production traffic reads all day. Cheap and warm.
  //   2. The committed snapshot of the last successful bake — counts are
  //      that bake's measurements (the lander copy already says counts are
  //      as-of-last-build).
  // Every successful live fetch refreshes the snapshot, trimmed to what the
  // pages actually consume.
  try {
    const envText2 = (() => { try { return readFileSync(join(root, ".env"), "utf8"); } catch { return ""; } })();
    const grab2 = (k) => process.env[k] || (envText2.match(new RegExp(`^${k}=(.*)$`, "m")) || [])[1]?.trim().replace(/^["']|["']$/g, "");
    const supaUrl2 = grab2("VITE_SUPABASE_URL");
    const supaKey2 = grab2("VITE_SUPABASE_PUBLISHABLE_KEY");
    if (!boardFacets && supaUrl2 && supaKey2) {
      const fr = await fetch(`${supaUrl2}/functions/v1/job-board`, {
        method: "POST",
        headers: { apikey: supaKey2, Authorization: `Bearer ${supaKey2}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", limit: 1, includeFacets: true }),
        signal: AbortSignal.timeout(15000),
      });
      if (fr.ok) {
        const j = await fr.json();
        if (j && typeof j.totalAllCompanies === "number" && Array.isArray(j.companies) && j.companies.length > 100) {
          boardFacets = {
            total: j.totalAllCompanies,
            companiesFacet: j.companies,
            companiesCount: typeof j.companiesCount === "number" ? j.companiesCount : j.companies.length,
            categoriesFacet: j.categories ?? {},
          };
          console.log("[prerender-seo] facets RPC unavailable — using the board function's cached facets");
        }
      }
    }
  } catch { /* fall through to the snapshot */ }
  const FACETS_SNAPSHOT = join(root, "scripts", "board-facets-snapshot.json");
  if (!boardFacets) {
    try {
      const snap = JSON.parse(readFileSync(FACETS_SNAPSHOT, "utf8"));
      if (snap && typeof snap.total === "number" && Array.isArray(snap.companiesFacet) && snap.companiesFacet.length > 100) {
        boardFacets = snap;
        console.log(`[prerender-seo] live facets unreachable — committed snapshot from ${snap.savedAt} (counts are that bake's measurements)`);
      }
    } catch { /* no snapshot yet — pages fall back to countless copy, sitemap ratchet guards */ }
  } else {
    try {
      const trimmed = [...(boardFacets.companiesFacet ?? [])]
        .filter((c) => c && typeof c.count === "number")
        .sort((a, b) => b.count - a.count)
        .slice(0, 600)
        .map((c) => ({ token: c.token, name: c.name, count: c.count }));
      writeFileSync(FACETS_SNAPSHOT, JSON.stringify({
        total: boardFacets.total,
        companiesCount: typeof boardFacets.companiesCount === "number"
          ? boardFacets.companiesCount
          : (Array.isArray(boardFacets.companiesFacet) ? boardFacets.companiesFacet.length : null),
        categoriesFacet: boardFacets.categoriesFacet ?? {},
        companiesFacet: trimmed,
        savedAt: new Date().toISOString().slice(0, 10),
      }));
    } catch { /* snapshot refresh is best-effort */ }
  }

  // ---- Shared live-count constants: ONE derivation for every surface that
  // states a headline number (home title, llms.txt, jobs page uses its own
  // local copy). plusClaim rounds DOWN to a "+" claim that stays literally
  // true through churn between bakes — the audit found the home title 120k
  // behind the /jobs prerender from the same deploy.
  const BOARD_TOTAL = typeof boardFacets?.total === "number" ? boardFacets.total : null;
  // companiesCount is the FULL number even when the facet array is a capped
  // slice (the function fallback serves top-1500; the RPC serves everything).
  const BOARD_COMPANIES = typeof boardFacets?.companiesCount === "number"
    ? boardFacets.companiesCount
    : (Array.isArray(boardFacets?.companiesFacet) ? boardFacets.companiesFacet.length : null);
  // CHURN MARGIN, measured, not guessed. The comment above promised the claim
  // "stays literally true through churn between bakes" — the 2026-08-17 DB
  // incident falsified it: the corpus fell 608,082 -> 583,921 (-4.0%) and
  // companies 25,065 -> 23,999 (-4.3%) between bakes, blowing through the 50k
  // floor's ~8k of slack, and the homepage title said "600,000+" over a board
  // of 583,921 — a false claim in the one tag every SERP shows. 7% covers the
  // worst observed drop with room; the floor step then rounds the honest
  // number down further. A "+" claim must be a promise, not a hope.
  const CHURN_MARGIN = 0.93;
  const plusClaim = (n, step) => `${(Math.floor((n * CHURN_MARGIN) / step) * step).toLocaleString("en-US")}+`;

  // ---- Route-chunk preload hints ----
  //
  // A prerendered page named exactly ONE script: the 808KB entry chunk. So a
  // phone had to download it, parse it, and only then let the router discover
  // Jobs-*.js (176KB) — and after parsing THAT, Footer-*.js (92KB). Three
  // sequential round trips before the board can paint, measured on the built
  // output 2026-08-24.
  //
  // modulepreload collapses that: the browser starts all three at once. It is
  // a HINT, not a behaviour change — a wrong or stale filename costs one
  // ignored request, never a broken page. Filenames are read from the build
  // output rather than hardcoded, because they carry content hashes that
  // change on every deploy.
  const assetDir = join(dist, "assets");
  const assetFiles = existsSync(assetDir) ? readdirSync(assetDir) : [];
  const chunkFor = (prefix) => assetFiles.find((f) => f.startsWith(`${prefix}-`) && f.endsWith(".js")) ?? null;
  const JOBS_CHUNK = chunkFor("Jobs");
  const FOOTER_CHUNK = chunkFor("Footer");
  const preloadFor = (path) => {
    const want = [];
    // Footer renders on every prerendered page, so it is always on the
    // critical path — it was simply discovered last.
    if (FOOTER_CHUNK) want.push(FOOTER_CHUNK);
    if (JOBS_CHUNK && (path === "/jobs" || path.startsWith("/jobs/"))) want.push(JOBS_CHUNK);
    return want.map((f) => `<link rel="modulepreload" href="/assets/${f}">`).join("");
  };
  if (!JOBS_CHUNK || !FOOTER_CHUNK) {
    console.warn(`[prerender-seo] preload hint skipped — Jobs chunk ${JOBS_CHUNK ?? "MISSING"}, Footer chunk ${FOOTER_CHUNK ?? "MISSING"}`);
  }

  const template = readFileSync(join(dist, "index.html"), "utf8");
  if (!template.includes('<div id="root"></div>')) {
    throw new Error('dist/index.html does not contain <div id="root"></div> — template shape changed');
  }

  // ---- Helpers ----
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const label = (slug) => slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const displayKeyword = (k) => (k.length <= 4 && !k.includes(" ") ? k.toUpperCase() : k);
  const uniq = (a) => [...new Set(a)];
  // The ONLY industry count: every surface computes from the engine's actual
  // table (the audit found 58 and 59 hardcoded on the same page).
  const NIND = Object.keys(D.INDUSTRY_KEYWORDS).length;
  // Hoisted from the jobs-lander block: the /explore prerender links the same
  // field pages.
  const CATEGORY_LANDERS = [
    ["engineering", "Engineering & IT"],
    ["data_ai", "Data & AI"],
    ["design", "Design"],
    ["product", "Product"],
    ["marketing", "Marketing & Comms"],
    ["sales", "Sales & Partnerships"],
    ["customer", "Customer Success & Support"],
    ["finance", "Finance & Accounting"],
    ["legal", "Legal & Compliance"],
    ["people_hr", "People & Recruiting"],
    ["operations", "Operations & Logistics"],
    ["healthcare", "Healthcare & Clinical"],
    ["science", "Science & Research"],
    ["education", "Education"],
    ["hospitality_retail", "Hospitality & Retail"],
    ["security", "Security & Trust"],
    ["admin", "Administrative"],
  ];

  const chip = (text, cls = "px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-foreground capitalize") =>
    `<span class="${cls}">${esc(text)}</span>`;
  const chips = (arr, cls) => `<div class="flex flex-wrap gap-1.5">${arr.map((k) => chip(k, cls)).join("")}</div>`;
  const kwChips = (arr) =>
    `<div class="flex flex-wrap gap-1.5">${arr
      .map((k) => chip(displayKeyword(k), `px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-foreground${k.length <= 4 && !k.includes(" ") ? "" : " capitalize"}`))
      .join("")}</div>`;
  const pill = (href, text) =>
    `<a href="${href}" class="px-3 py-1.5 rounded-full border border-border text-muted-foreground hover:text-foreground transition-colors">${esc(text)}</a>`;
  const cta = (heading, body, buttonText) => `
    <section class="rounded-2xl border-2 border-primary bg-card p-6 text-center">
      <h2 class="text-xl font-bold mb-2">${esc(heading)}</h2>
      <p class="text-sm text-muted-foreground mb-4 max-w-md mx-auto">${esc(body)}</p>
      <a href="/" class="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold">${esc(buttonText)}</a>
    </section>`;
  const onetBlock = (onet, heading = "Core skills per the U.S. Department of Labor") =>
    onet
      ? `<section class="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-6">
          <h2 class="font-semibold text-foreground mb-1">${esc(heading)}</h2>
          <p class="text-xs text-muted-foreground mb-3">Source: O*NET ${esc(onet.code)} — ${esc(onet.occupation)} (onetonline.org, public domain)</p>
          ${chips(onet.skills, "px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium capitalize")}
          <div class="mt-2">${chips(onet.technologies, "px-2.5 py-1 rounded-full border border-border text-xs text-foreground")}</div>
        </section>`
      : "";
  const breadcrumbNav = (parts) =>
    `<nav class="text-xs text-muted-foreground mb-4">${parts
      .map((p, i) => (p.href && i < parts.length - 1 ? `<a href="${p.href}" class="hover:text-foreground">${esc(p.name)}</a>` : `<span class="text-foreground">${esc(p.name)}</span>`))
      .join(" / ")}</nav>`;
  const breadcrumbLd = (items) => ({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: `${SITE}${it.path}` })),
  });
  const faqLd = (faqs) => ({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  });

  // Static shell around page content: simple header/footer so crawlers see
  // site-wide internal links. The SPA replaces all of it on hydration.
  const shell = (contentHtml, lang) => `
    <div class="min-h-screen bg-background" ${lang ? `lang="${lang}"` : ""}>
      <header class="py-4 border-b border-border"><div class="container flex items-center justify-between">
        <a href="/" class="font-bold text-foreground">Resume Booster</a>
        <nav class="flex gap-4 text-sm text-muted-foreground">
          <a href="/resume-checker" class="hover:text-foreground">Resume checker</a>
          <a href="/industries" class="hover:text-foreground">Industries</a>
          <a href="/pricing" class="hover:text-foreground">Pricing</a>
          <a href="/jobs" class="hover:text-foreground">Job board</a>
        </nav>
      </div></header>
      <main id="main-content" tabindex="-1" class="pt-10 pb-20"><div class="container max-w-3xl">${contentHtml}</div></main>
      <footer class="py-10 border-t border-border"><div class="container">
        <nav class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-muted-foreground">
          <a href="/resume-checker" class="hover:text-foreground">Free resume checker</a>
          <a href="/ats-resume-test" class="hover:text-foreground">ATS resume test</a>
          <a href="/resume-score" class="hover:text-foreground">Resume score</a>
          <a href="/industries" class="hover:text-foreground">Resume keywords by industry</a>
          <a href="/cv-standards" class="hover:text-foreground">CV standards by country</a>
          <a href="/changelog" class="hover:text-foreground">Changelog</a>
          <a href="/trust" class="hover:text-foreground">Trust &amp; privacy</a>
          <a href="/affiliates" class="hover:text-foreground">Affiliates</a>
          <a href="/shortlist" class="hover:text-foreground">Shortlist for employers</a>
          <a href="/ats/workday" class="hover:text-foreground">Workday ATS guide</a>
          <a href="/vs/jobscan" class="hover:text-foreground">vs Jobscan</a>
          <a href="/methodology" class="hover:text-foreground">Methodology</a>
          <a href="/pricing" class="hover:text-foreground">Pricing</a>
          <a href="/jobs" class="hover:text-foreground">Job board</a>
          <!-- /explore is prerendered and sitemapped at priority 0.8 daily, but
               until now no served page linked to it, so every non-JS crawler saw
               a sitemap-only orphan — the exact condition Footer.tsx warns about. -->
          <a href="/explore" class="hover:text-foreground">Explore employers</a>
        </nav>
      </div></footer>
    </div>`;

  // ---- Head surgery on the template ----
  // `isFallback` marks the root index.html, which doubles as the SPA fallback
  // for every non-prerendered route: it gets NO canonical (a canonical of "/"
  // on /pricing would tell non-Google engines /pricing is a duplicate) and an
  // inline script that clears the static homepage content immediately when
  // the browser path isn't "/" (crawlers don't run it; JS users on other
  // routes get the same blank-then-render they had before).
  // `canonical` names a DIFFERENT page as the indexable version of this one —
  // for near-duplicates that must stay reachable but must not compete. `robots`
  // sets the meta robots tag for pages that exist only to serve their own URL
  // (an auth wall, say) and should never be indexed at all.
  const renderFile = ({ path, title, description, content, jsonLd = [], hreflang = null, lang = null, isFallback = false, canonical = null, robots = null }) => {
    // SERP snippets truncate ~160 chars; clamp at a word boundary so no page
    // (current or future) ships an overlong description.
    //
    // The clamp STAYS (a 300-char description in the wild is worse than a cut
    // one) but it no longer does its work in silence. It cut the homepage's
    // description at "…Upload your CV and an AI…" and nothing said so, so the
    // headline change that made the agent the hallmark never reached the
    // snippet Google shows. A safety net that hides the fall is how you find
    // out months later.
    if (description && description.length > 160) {
      truncatedDescriptions.push({ path, len: description.length, text: description });
      description = description.slice(0, 157).replace(/\s+\S*$/, "") + "…";
    }
    let html = template;
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
    html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`);
    html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
    html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
    html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
    html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
    // Route-true share URLs: the template hardcodes the homepage, so every
    // page's og:url/twitter:url contradicted its own canonical and shares
    // canonicalized to "/" (audit 2026-07-25).
    const pageUrl = path === "/" ? `${SITE}/` : `${SITE}${path}`;
    html = html.replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${pageUrl}$2`);
    html = html.replace(/(<meta name="twitter:url" content=")[^"]*(")/, `$1${pageUrl}$2`);
    if (lang) html = html.replace(/<html lang="[^"]*"/, `<html lang="${lang}"`);

    // REPLACE the template's robots tag, never append a second one. The
    // template ships `index, follow`; appending `noindex` left both in the
    // head, and two contradictory robots directives is a page whose indexing
    // depends on which one a given crawler resolves. Caught before deploy by
    // reading the built file — the tag was correct AND the wrong one was still
    // above it.
    if (robots) {
      const tag = `<meta name="robots" content="${robots}" />`;
      html = /<meta name="robots"[^>]*>/.test(html)
        ? html.replace(/<meta name="robots"[^>]*>/, tag)
        : html.replace("</head>", `${tag}\n</head>`);
    }
    let headExtra = `${isFallback ? "" : `<link rel="canonical" href="${SITE}${publicHref(canonical || path)}" />\n`}<meta name="x-prerendered" content="1" />\n`;
    if (hreflang) {
      // hreflang is a { locale: path } map (any number of locales). Every
      // cluster member emits the SAME set of alternates (reciprocity is what
      // makes crawlers honor them) + x-default pointing at the English page.
      for (const [hl, href] of Object.entries(hreflang)) {
        headExtra += `<link rel="alternate" hreflang="${hl}" href="${SITE}${href}" />\n`;
      }
      headExtra += `<link rel="alternate" hreflang="x-default" href="${SITE}${hreflang.en}" />\n`;
    }
    for (const ld of jsonLd) headExtra += `<script type="application/ld+json">${JSON.stringify(ld)}</script>\n`;
    // Preload hints last in the head, so they cannot displace the meta tags
    // above them if the template shape ever shifts.
    headExtra += preloadFor(path);
    html = html.replace("</head>", `${headExtra}</head>`);
    const clearScript = isFallback
      ? `<script>if(location.pathname!=="/"){var r=document.getElementById("root");if(r)r.innerHTML="";}</script>`
      : "";
    html = html.replace('<div id="root"></div>', `<div id="root">${shell(content, lang)}</div>${clearScript}`);

    if (isFallback) {
      writeFileSync(join(dist, "index.html"), html);
      return;
    }
    // Write BOTH layouts: <path>/index.html (served for "/path/") and
    // <path>.html (what sirv-style servers — vite preview included — resolve
    // for the extensionless "/path" our links and sitemap actually use).
    // Together they cover every static-host convention.
    const outDir = join(dist, ...path.split("/").filter(Boolean));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "index.html"), html);
    writeFileSync(join(dist, ...path.split("/").filter(Boolean)) + ".html", html);
  };

  let count = 0;
  const writtenPaths = [];
  const truncatedDescriptions = [];

  // A PATH WHOSE LAST SEGMENT CONTAINS A DOT 404s WITHOUT A TRAILING SLASH.
  //
  // Measured live 2026-08-15: /jobs/company/careers.amd.com returns HTTP 404
  // with a 9-byte "Not found", while /jobs/company/careers.amd.com/ and
  // .../careers.amd.com.html both return 200 with the correct page. The host
  // reads the dot as a file extension, looks for a static asset by that exact
  // name, and 404s instead of falling through to the SPA. 25 of the 485
  // company URLs in the sitemap had dotted slugs — Phenom-style tokens that
  // ARE hostnames — and all 25 were dead. Not a sample: 25/25 dotted failed,
  // 460/460 plain succeeded, so this is deterministic routing, not flakiness.
  //
  // It broke humans too, not only crawlers: the same URL 404s under a normal
  // Chrome user-agent. Internal SPA navigation was fine, which is why nobody
  // saw it — only a cold load of the published URL fails, which is exactly
  // what a crawler and a pasted link both do.
  //
  // The files are already written both ways (see renderFile). This picks the
  // form that actually resolves for the sitemap and the canonical.
  const publicHref = (p) => (/\.[^/]*$/.test(p) ? `${p}/` : p);
  // A page that names another as canonical, or is marked noindex, still gets a
  // file — it has to, or the host serves it the homepage — but it stays OUT of
  // the sitemap. Submitting a URL for indexing while telling the crawler not to
  // index it is a contradiction Search Console reports as an error.
  const write = (page) => {
    renderFile(page);
    if (!page.canonical && !page.robots) writtenPaths.push(page.path);
    count++;
  };

  // ---- /industries index ----
  {
    const slugs = Object.keys(D.INDUSTRY_KEYWORDS).sort();
    write({
      path: "/industries",
      title: `Resume Keywords by Industry — ${NIND} Fields Covered`,
      description: `ATS keywords, recognized job titles, and expected certifications for ${NIND} industries — straight from the detection engine of a real resume scanner.`,
      content: `
        <h1 class="text-3xl font-bold mb-3">Resume keywords, by industry</h1>
        <p class="text-muted-foreground mb-8">Every page below is generated from the live data our scanner uses — the keywords it weights, the titles it recognizes, the certifications it anchors on, and (where available) skills sourced from the U.S. Department of Labor's O*NET database. ${slugs.length} industries, updated whenever the engine improves.</p>
        <div class="grid sm:grid-cols-2 gap-2.5">${slugs.map((s) => `<a href="/industries/${s}" class="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"><span class="capitalize">${esc(label(s))}</span></a>`).join("")}</div>
        <div class="mt-8">${cta("See how your resume scores — free", "Full diagnostic report in seconds. No signup, resume never stored.", "Scan my resume free")}</div>`,
    });
  }

  // ---- /industries/:slug (58) ----
  for (const [slug, data] of Object.entries(D.INDUSTRY_KEYWORDS)) {
    const name = label(slug);
    const keywords = uniq(data.primary).slice(0, 24);
    const titles = uniq(data.titles).slice(0, 18);
    const certs = uniq(data.certifications).slice(0, 12);
    const onet = D.ONET_EXPECTATIONS[slug];
    const subs = D.SUB_INDUSTRY_TAXONOMY[slug] || [];
    const roles = D.rolesForIndustry(slug);
    const note = D.SCREENER_NOTES[slug];
    const related = Object.keys(D.INDUSTRY_KEYWORDS).filter((s) => s !== slug).sort().slice(0, 8);
    const industryFaqs = D.buildIndustryFaqs({ name, keywords, certifications: certs, screenerNote: note });
    write({
      path: `/industries/${slug}`,
      // hreflang must be declared on BOTH sides of a language pair or
      // crawlers ignore it — the ES pages already point here.
      hreflang: D.ES_INDUSTRIES[slug] ? { en: `/industries/${slug}`, es: `/es/industrias/${slug}` } : null,
      title: `${name} Resume Keywords — What ATS Systems Look For`,
      description: `${keywords.slice(0, 6).join(", ")} and more: the actual keywords, job titles, and certifications our resume scanner's ${name.toLowerCase()} detection engine checks for. Free scan included.`,
      jsonLd: [
        breadcrumbLd([{ name: "Home", path: "/" }, { name: "Industries", path: "/industries" }, { name, path: `/industries/${slug}` }]),
        ...(industryFaqs.length ? [faqLd(industryFaqs)] : []),
      ],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Industries", href: "/industries" }, { name }])}
        <h1 class="text-3xl font-bold mb-3">${esc(name)} Resume Keywords &amp; ATS Expectations</h1>
        <p class="text-muted-foreground mb-8">This isn't an article — it's the live data our resume scanner uses to analyze ${esc(name.toLowerCase())} resumes. When the engine improves, this page updates with it.</p>
        ${onetBlock(onet)}
        <section class="mb-8"><h2 class="text-xl font-bold mb-2">Keywords ATS systems expect on ${esc(name.toLowerCase())} resumes</h2>${kwChips(keywords)}</section>
        <section class="mb-8"><h2 class="text-xl font-bold mb-2">Job titles recruiters recognize in this field</h2>${chips(titles, "px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-muted-foreground capitalize")}</section>
        ${certs.length ? `<section class="mb-8"><h2 class="text-xl font-bold mb-2">Certifications that anchor a ${esc(name.toLowerCase())} resume</h2>${chips(certs, "px-2.5 py-1 rounded-lg bg-success/5 border border-success/25 text-sm text-foreground uppercase")}</section>` : ""}
        ${subs.length ? `<section class="mb-8"><h2 class="text-xl font-bold mb-2">Specializations our scanner distinguishes within ${esc(name.toLowerCase())}</h2><div class="space-y-2">${subs.map((sub) => `<div class="rounded-xl border border-border bg-card p-3"><p class="text-sm font-medium text-foreground">${esc(sub.label)}</p><p class="text-xs text-muted-foreground capitalize">Signals: ${esc(sub.signals.slice(0, 6).join(", "))}</p></div>`).join("")}</div></section>` : ""}
        ${note ? `<section class="rounded-2xl border border-warning/30 bg-warning/5 p-5 mb-8"><h2 class="font-semibold text-foreground mb-1">What screeners check first in ${esc(name.toLowerCase())}</h2><p class="text-sm text-muted-foreground">${esc(note)}</p></section>` : ""}
        ${industryFaqs.length ? `<section class="mb-8"><h2 class="text-xl font-bold mb-3">Common questions</h2><div class="space-y-3">${industryFaqs.map((f) => `<div class="rounded-2xl border border-border bg-card p-4"><h3 class="font-semibold text-foreground text-sm mb-1.5">${esc(f.q)}</h3><p class="text-xs text-muted-foreground leading-relaxed">${esc(f.a)}</p></div>`).join("")}</div></section>` : ""}
        ${cta(`See how your resume scores against this data — free`, "A full diagnostic report in seconds: missing keywords, ATS parsing, weakest bullets rewritten, and a fix plan. No signup, resume never stored.", "Scan my resume free")}
        ${D.ES_INDUSTRIES[slug] ? `<p class="text-xs text-muted-foreground mb-4"><a href="/es/industrias/${slug}" class="text-primary">Versión en español →</a></p>` : ""}
        ${roles.length ? `<section class="mt-8"><h2 class="text-xl font-bold mb-2">Role-specific keyword guides</h2><div class="flex flex-wrap gap-1.5">${roles.map((r) => `<a href="/roles/${r.slug}" class="px-3 py-1.5 rounded-full border border-primary/40 text-primary text-sm">${esc(r.title)} resume keywords →</a>`).join("")}</div></section>` : ""}
        <nav class="mt-8 flex flex-wrap gap-2 text-xs">${related.map((s) => pill(`/industries/${s}`, `${label(s)} keywords →`)).join("")}${pill("/industries", "All industries")}</nav>
        <p class="text-xs text-muted-foreground mt-8">Methodology: keyword and title lists come directly from the detection tables our scanner runs on every ${esc(name.toLowerCase())} resume, validated by a pinned regression suite. O*NET data is public domain from the U.S. Department of Labor. See <a href="/methodology" class="underline">our methodology</a>.</p>`,
    });
  }

  // ---- /roles/:slug (~174) ----
  for (const role of Object.values(D.ROLE_PAGES)) {
    const data = D.INDUSTRY_KEYWORDS[role.industry];
    if (!data) continue;
    const indName = label(role.industry);
    const keywords = uniq(data.primary).slice(0, 20);
    const certs = uniq(data.certifications).slice(0, 10);
    const onet = D.ONET_EXPECTATIONS[role.industry];
    const relatedTitles = uniq(data.titles).filter((t) => t.toLowerCase() !== role.title.toLowerCase()).slice(0, 10);
    const siblings = D.rolesForIndustry(role.industry).filter((r) => r.slug !== role.slug);
    write({
      path: `/roles/${role.slug}`,
      title: `${role.title} Resume Keywords — What ATS Systems Look For`.length > 68 ? `${role.title} Resume Keywords — ATS Guide` : `${role.title} Resume Keywords — What ATS Systems Look For`,
      description: `${keywords.slice(0, 5).join(", ")} and more: the keywords, certifications, and titles our scanner checks on ${role.title.toLowerCase()} resumes. Free ATS scan included.`,
      jsonLd: [breadcrumbLd([{ name: "Home", path: "/" }, { name: "Industries", path: "/industries" }, { name: indName, path: `/industries/${role.industry}` }, { name: role.title, path: `/roles/${role.slug}` }])],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Industries", href: "/industries" }, { name: indName, href: `/industries/${role.industry}` }, { name: role.title }])}
        <h1 class="text-3xl font-bold mb-3">${esc(role.title)} Resume Keywords &amp; ATS Expectations</h1>
        <p class="text-muted-foreground mb-8">This is the live data our resume scanner uses when it detects a ${esc(role.title.toLowerCase())} resume — the keyword tables, certifications, and titles from our ${esc(indName.toLowerCase())} detection engine.</p>
        ${onetBlock(onet)}
        <section class="mb-8"><h2 class="text-xl font-bold mb-2">Keywords ATS systems expect on a ${esc(role.title.toLowerCase())} resume</h2>${kwChips(keywords)}</section>
        ${certs.length ? `<section class="mb-8"><h2 class="text-xl font-bold mb-2">Certifications that anchor a ${esc(role.title.toLowerCase())} resume</h2>${chips(certs, "px-2.5 py-1 rounded-lg bg-success/5 border border-success/25 text-sm text-foreground uppercase")}</section>` : ""}
        ${relatedTitles.length ? `<section class="mb-8"><h2 class="text-xl font-bold mb-2">Adjacent titles recruiters search alongside "${esc(role.title)}"</h2>${chips(relatedTitles, "px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-muted-foreground capitalize")}</section>` : ""}
        ${cta(`Scan your ${role.title.toLowerCase()} resume against this data — free`, "A full diagnostic report in seconds: missing keywords, ATS parsing, weakest bullets rewritten, and a fix plan. No signup, resume never stored.", "Scan my resume free")}
        <nav class="mt-8 flex flex-wrap gap-2 text-xs">${siblings.map((r) => pill(`/roles/${r.slug}`, `${r.title} keywords →`)).join("")}${pill(`/industries/${role.industry}`, `All ${indName} keywords →`)}</nav>
        <p class="text-xs text-muted-foreground mt-8">Methodology: these lists come directly from the detection tables our scanner runs on every ${esc(indName.toLowerCase())} resume, validated by a pinned regression suite. See <a href="/methodology" class="underline">our methodology</a>.</p>`,
    });
  }

  // ---- /vs/:slug (5) ----
  for (const c of Object.values(D.COMPETITORS)) {
    const wins = c.rows.filter((r) => r.usWins);
    const losses = c.rows.filter((r) => !r.usWins);
    const faqs = [
      { q: `Is Resume Booster a good free alternative to ${c.name}?`, a: `For resume analysis, yes: the free scan is a full diagnostic report with no sign-up. ${c.name} is stronger in other areas, so the honest answer depends on what you need most.` },
      { q: `Where does Resume Booster beat ${c.name}?`, a: wins.map((r) => `${r.dim}: ${r.us}`).join(" ") },
      { q: `Where is ${c.name} better than Resume Booster?`, a: losses.length ? losses.map((r) => `${r.dim}: ${r.them}`).join(" ") : `${c.name}'s public product changes over time; run both free tiers and compare.` },
    ];
    write({
      path: `/vs/${c.slug}`,
      title: `Resume Booster vs ${c.name} — An Honest Comparison`,
      description: `How Resume Booster's free diagnostic scan compares to ${c.name}: free-tier depth, score transparency, verified output — and where ${c.name} is genuinely stronger.`,
      jsonLd: [faqLd(faqs)],
      content: `
        <h1 class="text-3xl font-bold mb-3">Resume Booster vs ${esc(c.name)}</h1>
        <p class="text-muted-foreground mb-2">${esc(c.intro)} An honest comparison — including the rows where ${esc(c.name)} is stronger. Every claim in our column is verifiable by running one free scan; claims about ${esc(c.name)} reflect their public product as of mid-2026 and may change.</p>
        <p class="text-xs text-muted-foreground mb-8">${esc(c.name)} is a trademark of its owner; we're not affiliated.</p>
        <div class="space-y-3 mb-10">${c.rows.map((r) => `
          <div class="rounded-2xl border border-border bg-card p-4">
            <p class="text-xs font-semibold uppercase text-muted-foreground mb-2">${esc(r.dim)}</p>
            <div class="grid sm:grid-cols-2 gap-3">
              <div class="rounded-xl p-3 border ${r.usWins ? "border-success/25 bg-success/5" : "border-border"}"><p class="text-xs font-semibold text-foreground mb-1">Resume Booster</p><p class="text-xs text-muted-foreground">${esc(r.us)}</p></div>
              <div class="rounded-xl p-3 border ${!r.usWins ? "border-primary/25 bg-primary/5" : "border-border"}"><p class="text-xs font-semibold text-foreground mb-1">${esc(c.name)}</p><p class="text-xs text-muted-foreground">${esc(r.them)}</p></div>
            </div>
          </div>`).join("")}</div>
        <section class="mb-10"><h2 class="text-2xl font-bold mb-4">Common questions</h2><div class="space-y-3">${faqs.map((f) => `<div class="rounded-2xl border border-border bg-card p-4"><h3 class="font-semibold text-foreground text-sm mb-1.5">${esc(f.q)}</h3><p class="text-xs text-muted-foreground">${esc(f.a)}</p></div>`).join("")}</div></section>
        ${cta("The comparison that matters: run both, free", "Our free scan gives you the full diagnostic — no signup, no gating, resume never stored. Compare the reports yourself; that's the honest test.", "Run the free scan")}
        <nav class="mt-6 flex flex-wrap gap-2 text-xs">${Object.values(D.COMPETITORS).filter((o) => o.slug !== c.slug).map((o) => pill(`/vs/${o.slug}`, `vs ${o.name} →`)).join("")}</nav>`,
    });
  }

  // ---- /ats/:vendor (4) ----
  for (const [vendor, data] of Object.entries(D.VENDORS)) {
    write({
      path: `/ats/${vendor}`,
      title: `${data.headline} | Resume Booster`,
      description: data.behaviors[0].a.slice(0, 155),
      jsonLd: [faqLd(data.behaviors)],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "ATS guides" }, { name: data.name }])}
        <h1 class="text-3xl font-bold mb-3">${esc(data.headline)}</h1>
        <p class="text-muted-foreground mb-8">These are the documented parsing behaviors our scanner tests every resume against — not speculation. The free scan runs these exact checks on your file.</p>
        <div class="space-y-5 mb-10">${data.behaviors.map((b) => `<section class="rounded-2xl border border-border bg-card p-5"><h2 class="font-semibold text-foreground mb-2">${esc(b.q)}</h2><p class="text-sm text-muted-foreground">${esc(b.a)}</p></section>`).join("")}</div>
        ${cta(`Test your resume against ${data.name} — free`, `Our free scan checks your actual file against ${data.name}'s parsing behaviors plus 24+ other checks. No signup, resume never stored.`, "Run the free check")}
        <nav class="mt-6 flex flex-wrap gap-2 text-xs">${Object.keys(D.VENDORS).filter((v) => v !== vendor).map((v) => pill(`/ats/${v}`, `${D.VENDORS[v].name} guide →`)).join("")}</nav>`,
    });
  }

  // ---- /es/industrias/:slug (15) ----
  for (const [slug, name] of Object.entries(D.ES_INDUSTRIES)) {
    const data = D.INDUSTRY_KEYWORDS[slug];
    if (!data) continue;
    const esKeywords = uniq(data.primary.filter(D.isSpanish)).slice(0, 20);
    const esTitles = uniq(data.titles.filter(D.isSpanish)).slice(0, 14);
    const enKeywords = uniq(data.primary.filter((t) => !D.isSpanish(t))).slice(0, 14);
    write({
      path: `/es/industrias/${slug}`,
      lang: "es",
      hreflang: { en: `/industries/${slug}`, es: `/es/industrias/${slug}` },
      title: `Palabras Clave para Currículum de ${name} — Qué Buscan los ATS`.length > 68 ? `Palabras Clave para CV de ${name} — Guía ATS` : `Palabras Clave para Currículum de ${name} — Qué Buscan los ATS`,
      description: `${esKeywords.slice(0, 5).join(", ")} y más: las palabras clave, títulos y certificaciones que nuestro escáner de currículums busca en el sector de ${name.toLowerCase()}. Escaneo gratis incluido.`,
      content: `
        ${breadcrumbNav([{ name: "Inicio", href: "/" }, { name: "Industrias", href: "/industries" }, { name }])}
        <h1 class="text-3xl font-bold mb-3">Palabras clave para currículum de ${esc(name)}</h1>
        <p class="text-muted-foreground mb-8">Esto no es un artículo — son los datos reales que nuestro escáner usa para analizar currículums de ${esc(name.toLowerCase())}, incluida la detección nativa en español.</p>
        <section class="mb-8"><h2 class="text-xl font-bold mb-2">Términos en español que nuestro motor reconoce</h2>${chips(esKeywords)}</section>
        ${esTitles.length ? `<section class="mb-8"><h2 class="text-xl font-bold mb-2">Títulos profesionales reconocidos</h2>${chips(esTitles, "px-2.5 py-1 rounded-lg bg-card border border-border text-sm text-muted-foreground capitalize")}</section>` : ""}
        <section class="mb-8"><h2 class="text-xl font-bold mb-2">Términos en inglés que los ATS también esperan</h2>${chips(enKeywords)}</section>
        ${cta("Escanea tu currículum gratis — también en español", "Informe diagnóstico completo en segundos: palabras clave faltantes, cómo leen tu archivo los sistemas ATS, tus viñetas más débiles reescritas y un plan de mejoras. Sin registro; tu currículum nunca se guarda.", "Escanear mi currículum gratis")}
        <nav class="mt-8 flex flex-wrap gap-2 text-xs">${Object.entries(D.ES_INDUSTRIES).filter(([s]) => s !== slug).map(([s, n]) => pill(`/es/industrias/${s}`, `${n} →`)).join("")}${pill("/es/revisar-curriculum", "Revisar mi currículum gratis →")}${pill(`/industries/${slug}`, "English version →")}</nav>`,
    });
  }

  // ---- Tool landing pages (4, incl. Spanish) ----
  for (const cfg of Object.values(D.TOOL_LANDINGS)) {
    write({
      path: cfg.path,
      lang: cfg.lang || null,
      hreflang: cfg.alternates || null,
      title: cfg.title,
      description: cfg.description,
      jsonLd: [faqLd(cfg.faqs)],
      content: `
        <h1 class="text-3xl font-bold mb-3">${esc(cfg.heading)}</h1>
        <p class="text-muted-foreground mb-6">${esc(cfg.intro)}</p>
        <ul class="space-y-1.5 mb-8">${cfg.bullets.map((b) => `<li class="text-sm text-muted-foreground">✓ ${esc(b)}</li>`).join("")}</ul>
        ${cta(cfg.lang === "es" ? "Escanea tu currículum gratis" : "Run the free scan now", cfg.lang === "es" ? "Informe completo en unos 20 segundos. Sin registro; tu currículum nunca se guarda." : "Full diagnostic report in about 20 seconds. No sign-up, resume never stored.", cfg.lang === "es" ? "Escanear mi currículum gratis" : "Scan my resume free")}
        <section class="mt-10"><h2 class="text-2xl font-bold mb-4">${cfg.lang === "es" ? "Preguntas frecuentes" : "Common questions"}</h2><div class="space-y-4">${cfg.faqs.map((f) => `<div class="rounded-2xl border border-border bg-card p-5"><h3 class="font-semibold text-foreground mb-1.5">${esc(f.q)}</h3><p class="text-sm text-muted-foreground">${esc(f.a)}</p></div>`).join("")}</div></section>`,
    });
  }

  // ---- /guides index + articles ----
  {
    const guides = Object.values(D.GUIDES);
    write({
      path: "/guides",
      title: "Resume & ATS Guides — From Real Scanner Data",
      description: "How ATS systems actually work, how resumes really get rejected, and how to fix yours — every guide grounded in the checks our scanner runs, not folklore.",
      content: `
        <h1 class="text-3xl font-bold mb-3">Resume &amp; ATS guides</h1>
        <p class="text-muted-foreground mb-8">No recycled folklore: every guide below is grounded in the checks our scanner runs on real resumes and the documented behavior of real ATS parsers. Where the popular advice is wrong, we say so.</p>
        <div class="space-y-3">${guides.map((g) => `
          <a href="/guides/${g.slug}" class="block rounded-2xl border border-border bg-card p-5">
            <h2 class="font-semibold text-foreground mb-1">${esc(g.h1)}</h2>
            <p class="text-sm text-muted-foreground">${esc(g.description)}</p>
            <p class="text-xs text-muted-foreground mt-2">${g.minutes} min read · Updated ${g.updated}</p>
          </a>`).join("")}</div>`,
    });

    for (const g of guides) {
      const jsonLd = [{
        "@context": "https://schema.org",
        "@type": "Article",
        headline: g.h1,
        description: g.description,
        dateModified: g.updated,
        author: { "@type": "Organization", name: "Resume Booster", url: SITE },
        publisher: { "@type": "Organization", name: "Resume Booster" },
        mainEntityOfPage: `${SITE}/guides/${g.slug}`,
      },
      breadcrumbLd([{ name: "Home", path: "/" }, { name: "Guides", path: "/guides" }, { name: g.h1, path: `/guides/${g.slug}` }])];
      if (g.faqs?.length) jsonLd.push(faqLd(g.faqs));
      write({
        path: `/guides/${g.slug}`,
        title: g.title,
        description: g.description,
        jsonLd,
        content: `
          ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Guides", href: "/guides" }, { name: g.h1 }])}
          <article>
          <h1 class="text-3xl font-bold mb-3">${esc(g.h1)}</h1>
          <p class="text-xs text-muted-foreground mb-6">${g.minutes} min read · Updated ${g.updated} · ${esc(D.guideGrounding(g))}</p>
          <section class="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-8"><h2 class="text-sm font-semibold text-foreground mb-1.5">The short answer</h2><p class="text-sm text-muted-foreground leading-relaxed">${esc(g.tldr)}</p></section>
          ${g.sections.map((s) => `
            <section class="mb-8">
              <h2 class="text-xl font-bold mb-3">${esc(s.h2)}</h2>
              ${s.paras.map((p) => `<p class="text-sm text-muted-foreground leading-relaxed mb-3">${esc(p)}</p>`).join("")}
              ${s.bullets ? `<ul class="space-y-1.5 mt-1">${s.bullets.map((b) => `<li class="text-sm text-muted-foreground">✓ ${esc(b)}</li>`).join("")}</ul>` : ""}
            </section>`).join("")}
          ${g.faqs?.length ? `<section class="mb-10"><h2 class="text-xl font-bold mb-4">Common questions</h2><div class="space-y-3">${g.faqs.map((f) => `<div class="rounded-2xl border border-border bg-card p-4"><h3 class="font-semibold text-foreground text-sm mb-1.5">${esc(f.q)}</h3><p class="text-xs text-muted-foreground">${esc(f.a)}</p></div>`).join("")}</div></section>` : ""}
          ${cta("See where your resume actually stands — free", "The full diagnostic in about 20 seconds: parsing, keywords, structure, and red flags — with every finding quoted from your actual document. No signup, resume never stored.", "Run the free scan")}
          <nav class="mt-6 flex flex-wrap gap-2 text-xs">${g.related.map((r) => pill(r.href, `${r.label} →`)).join("")}</nav>
          </article>`,
      });
    }
  }

  // Bake real numbers at build time via the same public aggregate RPC the
  // browser pages call. Used by /research/ats-score-benchmarks AND the
  // homepage stats section below. If the RPC isn't reachable (migration not
  // yet published, offline build), prerender the qualitative copy only —
  // the browser fetch fills the numbers in. Never invent figures here.
  let scanInsights = null;
  let scanTotals = null;
  try {
    const env = readFileSync(join(root, ".env"), "utf8");
    const supaUrl = env.match(/^VITE_SUPABASE_URL\s*=\s*"?([^"\s]+)/m)?.[1];
    const anonKey = env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY\s*=\s*"?([^"\s]+)/m)?.[1];
    if (supaUrl && anonKey) {
      const rpc = async (fn) => {
        const res = await fetch(`${supaUrl}/rest/v1/rpc/${fn}`, {
          method: "POST",
          headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(8000),
        });
        return res.ok ? res.json() : null;
      };
      scanInsights = await rpc("get_public_scan_insights");
      if (!scanInsights?.overall?.n) scanInsights = null;
      scanTotals = await rpc("get_scan_totals").catch(() => null);
      if (!scanTotals?.total_scans) scanTotals = null;
    }
  } catch (e) {
    console.warn(`[prerender-seo] score insights unavailable at build time (${e.message}) — prerendering without numbers`);
  }

  // ---- /research/ats-score-benchmarks (live data study) ----
  {
    const ins = scanInsights;
    const o = ins?.overall;
    const studyFaqs = [
      { q: "What is a good ATS score?", a: "Judge your score against the live distribution on this page, not a folklore threshold: the median and quartiles come from real scans in the last 180 days. Scoring above the 75th percentile means most resumes being checked right now score below yours; below the 25th percentile means parsing or keyword problems are very likely holding you back." },
      { q: "Do ATS systems themselves show scores like this?", a: "Mostly no. Most ATS platforms rank and filter by recruiter searches rather than assigning a universal score. A resume score — ours included — is a diagnostic model of how well your resume will survive parsing and keyword search, not a number Workday or Greenhouse shows a recruiter." },
      { q: "Where do these numbers come from?", a: "From completed scans run by real users on this site over a rolling 180-day window. Only aggregates are published: each industry or experience bucket must contain at least 25 scans before it appears, and no individual resume, score, or location is ever exposed." },
      { q: "Why might this sample skew low or high?", a: "People who check their resume are often mid-job-search and suspect something is wrong, so the sample likely skews toward resumes with fixable problems. Treat the percentiles as a benchmark of active job seekers, not of every employed professional's resume." },
    ];
    write({
      path: "/research/ats-score-benchmarks",
      title: "What's a Good ATS Score? Live Benchmarks From Real Scans",
      description: "Real ATS score benchmarks, updated live from our scan corpus: overall median and quartiles, per-industry distributions, and experience-level medians — not folklore thresholds.",
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "Article",
          headline: "ATS resume score benchmarks from real scans",
          description: "Live score distributions from real resume scans: overall median and quartiles, per-industry benchmarks, and experience-level medians over a rolling 180-day window.",
          author: { "@type": "Organization", name: "Resume Booster", url: SITE },
          publisher: { "@type": "Organization", name: "Resume Booster" },
          mainEntityOfPage: `${SITE}/research/ats-score-benchmarks`,
        },
        {
          "@context": "https://schema.org",
          "@type": "Dataset",
          name: "Resume Booster ATS score benchmarks",
          description: "Aggregated ATS score distributions (median, quartiles, decile histogram) from real resume scans, by industry and experience level. Rolling 180-day window; buckets published only at n ≥ 25.",
          creator: { "@type": "Organization", name: "Resume Booster", url: SITE },
          url: `${SITE}/research/ats-score-benchmarks`,
          isAccessibleForFree: true,
        },
        faqLd(studyFaqs),
      ],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Guides", href: "/guides" }, { name: "ATS score benchmarks" }])}
        <article>
        <h1 class="text-3xl font-bold mb-3">What's a good ATS score? Live benchmarks from real scans</h1>
        <p class="text-xs text-muted-foreground mb-6">Computed live from our scan corpus (rolling 180-day window${ins ? `, as of ${esc(ins.as_of)}` : ""}) · Aggregates only, minimum 25 scans per bucket</p>
        <section class="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-8"><h2 class="text-sm font-semibold text-foreground mb-1.5">The short answer</h2><p class="text-sm text-muted-foreground leading-relaxed">${
          o
            ? esc(`Across the last ${o.n.toLocaleString("en-US")} completed scans, the median resume scored ${o.median}, with the middle half of resumes landing between ${o.p25} and ${o.p75}.${o.pct_80_plus != null ? ` Only ${o.pct_80_plus}% scored 80 or higher — so a score in the 80s is genuinely strong, not table stakes.` : ""} There is no universal pass mark: use the distribution below to see where you actually stand.`)
            : "There is no universal “good” ATS score — the honest benchmark is where you fall in the distribution of real resumes being scanned right now. This page computes that distribution live from our scan corpus: overall median and quartiles, per-industry benchmarks, and experience-level medians."
        }</p></section>
        ${
          ins
            ? `
        <section class="mb-10"><h2 class="text-xl font-bold mb-3">How real resumes score</h2>
          <p class="text-sm text-muted-foreground leading-relaxed mb-4">Each row is a 10-point score band across every completed scan in the current window.</p>
          <table class="w-full text-sm"><thead><tr class="text-left text-xs text-muted-foreground"><th class="p-2">Score band</th><th class="p-2">Scans</th><th class="p-2">Share</th></tr></thead><tbody>
          ${ins.histogram.map((h) => `<tr class="border-b border-border"><td class="p-2 text-foreground">${h.bucket}–${h.bucket + 9}</td><td class="p-2 text-muted-foreground">${h.n.toLocaleString("en-US")}</td><td class="p-2 text-muted-foreground">${o ? Math.round((1000 * h.n) / o.n) / 10 : 0}%</td></tr>`).join("")}
          </tbody></table></section>
        ${ins.industries.length ? `<section class="mb-10"><h2 class="text-xl font-bold mb-3">Benchmarks by industry</h2>
          <p class="text-sm text-muted-foreground leading-relaxed mb-4">Median and middle-half range (25th–75th percentile) per detected industry, minimum 25 scans each.</p>
          <table class="w-full text-sm"><thead><tr class="text-left text-xs text-muted-foreground"><th class="p-2">Industry</th><th class="p-2">Median</th><th class="p-2">Middle half</th><th class="p-2">Scans</th></tr></thead><tbody>
          ${ins.industries.map((r) => `<tr class="border-b border-border"><td class="p-2 text-foreground">${esc(label(r.industry))}</td><td class="p-2 font-semibold text-foreground">${r.median}</td><td class="p-2 text-muted-foreground">${r.p25}–${r.p75}</td><td class="p-2 text-muted-foreground">${r.n.toLocaleString("en-US")}</td></tr>`).join("")}
          </tbody></table></section>` : ""}
        ${ins.experience.length ? `<section class="mb-10"><h2 class="text-xl font-bold mb-3">By experience level</h2>
          <ul class="space-y-1.5">${ins.experience.map((r) => `<li class="text-sm text-muted-foreground">${esc(label(r.level))}: median <strong class="text-foreground">${r.median}</strong> across ${r.n.toLocaleString("en-US")} scans</li>`).join("")}</ul></section>` : ""}`
            : `<section class="mb-10"><p class="text-sm text-muted-foreground leading-relaxed">The live tables — overall distribution by 10-point band, per-industry medians with middle-half ranges, and experience-level medians — load directly from the scan corpus when this page is opened in a browser.</p></section>`
        }
        <section class="mb-10"><h2 class="text-xl font-bold mb-3">How to read these numbers honestly</h2>
          <p class="text-sm text-muted-foreground leading-relaxed mb-3">Two caveats we insist on. First, this sample self-selects: people scan resumes when they suspect a problem, so the distribution likely sits below the true population of working professionals. Second, any resume score — ours included — is a model with error bars, not a measurement; <a href="/guides/what-resume-score-means" class="text-primary">what a resume score actually means</a> explains how to read one without being fooled by false precision.</p>
          <p class="text-sm text-muted-foreground leading-relaxed">What the data is good for: ranking yourself against real peers instead of a made-up "75 is passing" threshold, and seeing that industry context matters — the same resume quality scores differently against different keyword expectations. Our <a href="/methodology" class="text-primary">methodology</a> covers how the score itself is computed.</p></section>
        <section class="mb-10"><h2 class="text-xl font-bold mb-4">Common questions</h2><div class="space-y-3">${studyFaqs.map((f) => `<div class="rounded-2xl border border-border bg-card p-4"><h3 class="font-semibold text-foreground text-sm mb-1.5">${esc(f.q)}</h3><p class="text-xs text-muted-foreground">${esc(f.a)}</p></div>`).join("")}</div></section>
        ${cta("See where your resume lands in this distribution — free", "The full diagnostic in about 20 seconds: your score with an audit trail, missing keywords, and per-vendor parsing checks. No signup, resume never stored.", "Run the free scan")}
        <nav class="mt-6 flex flex-wrap gap-2 text-xs">${pill("/guides/what-resume-score-means", "What a resume score actually means →")}${pill("/guides/why-resumes-get-rejected", "Why resumes get rejected →")}${pill("/industries", "Keywords by industry →")}</nav>
        </article>`,
    });
  }

  // ---- Homepage (also the SPA fallback — see renderFile notes) ----
  write({
    isFallback: true,
    path: "/",
    title: BOARD_TOTAL
      ? `Resume Booster — Live Job Board: ${plusClaim(BOARD_TOTAL, 50000)} Verified Openings, Zero Ghost Jobs`
      : "Resume Booster — Live Job Board: 450,000+ Verified Openings, Zero Ghost Jobs",
    // KEEP THIS UNDER 160 CHARACTERS. The previous one ran to 279 and the
    // clamp below cut it at "…Upload your CV and an AI…" — the snippet Google
    // shows literally trailed off before the word "agent", so the change that
    // made the agent the homepage's headline never reached the search result.
    description: "A live job board with zero ghost jobs — every opening straight from the employer's own hiring system. An AI agent ranks them to your CV and applies for you.",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: "Resume Booster",
        url: SITE,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: `Free diagnostic resume scan: ATS score with a full audit trail, verified quotes, per-vendor parsing checks, and a fix plan — across ${NIND} industries and 10 languages.`,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free resume scan — no signup required" },
      },
      // NO WebSite ENTITY HERE — index.html already ships one in the template,
      // so emitting a second gave the homepage TWO WebSite blocks with the same
      // name and url and only one carrying the SearchAction. Two competing
      // entities for one URL is how a sitelinks searchbox gets attributed to
      // the block that does not declare it. The SearchAction now lives on the
      // template's single block instead; see index.html.
      //
      // The agent, though, has no entity anywhere else — without this the
      // structured data described only the resume scanner while the title and
      // the page both led with the job board and the agent.
      {
        "@context": "https://schema.org",
        "@type": "Service",
        name: "AI apply agent",
        serviceType: "Automated job application assistance",
        provider: { "@type": "Organization", name: "Resume Booster", url: SITE },
        areaServed: "Worldwide",
        description: "Reads your CV, ranks live verified openings against it, writes a tailored application for each, answers the employer's own screening questions, and submits on hiring systems that permit it. It never fabricates experience and never solves a CAPTCHA or evades a bot check.",
        offers: { "@type": "Offer", priceCurrency: "USD", description: "Included with a Resume Booster account" },
      },
    ],
    content: `
      <h1 class="text-3xl font-bold mb-3">Every job here is real. The agent applies for you.</h1>
      <p class="text-muted-foreground mb-6">${BOARD_TOTAL ? `${plusClaim(BOARD_TOTAL, 50000)} verified openings` : "Verified openings"}${BOARD_COMPANIES ? ` from ${plusClaim(BOARD_COMPANIES, 1000)} companies` : ""}, every one pulled straight from the employer's own hiring system — never scraped, no dated posting older than 30 days, re-checked live at the moment you apply. Where a company publishes no date we keep the posting and show no age rather than guess one. Upload your CV and an AI apply agent ranks every opening against it, writes each application honestly (it will state what you do not have rather than invent it), and submits on the systems where employers allow it. <a href="/jobs" class="text-primary">Browse the live board →</a></p>
      <section class="mt-8 mb-8">
        <h2 class="text-xl font-bold mb-3">What the AI apply agent does</h2>
        <ul class="space-y-1.5">
          <li class="text-sm text-muted-foreground">✓ Reads your CV and scores every live opening against it</li>
          <li class="text-sm text-muted-foreground">✓ Writes a tailored application per role — never one blast sent everywhere</li>
          <li class="text-sm text-muted-foreground">✓ Answers the employer's real screening questions, harvested from the actual form</li>
          <li class="text-sm text-muted-foreground">✓ Refuses to fabricate: asked about experience you lack, it says so</li>
          <li class="text-sm text-muted-foreground">✓ Submits end-to-end where the employer's system permits; never solves a CAPTCHA or evades a bot check</li>
          <li class="text-sm text-muted-foreground">✓ Tracks every application and tells you when a role comes down</li>
        </ul>
      </section>
      <h2 class="text-xl font-bold mb-3">Your resume's real score — measured, not guessed</h2>
      <p class="text-muted-foreground mb-6">Same document, same score, every time — benchmarked against real scans in your industry, with every quoted line verified against your actual resume. Not a ChatGPT or Claude opinion: a reproducible reading with a full audit trail, missing keywords, weak bullets rewritten, and per-vendor parsing checks for Workday, Greenhouse, Lever, and iCIMS. No sign-up; your resume is never stored. <a href="/vs/chatgpt" class="text-primary">How this differs from asking a chatbot →</a></p>
      ${cta("Check my resume now — free", "Upload or paste your resume and get the complete diagnostic report. 7 scans a day free, 15 with a free account.", "Check my resume free")}
      <section class="mt-10 mb-8">
        <h2 class="text-xl font-bold mb-3">What the free scan covers</h2>
        <ul class="space-y-1.5">
          <li class="text-sm text-muted-foreground">✓ ATS parse simulation — see the text extraction from your actual file</li>
          <li class="text-sm text-muted-foreground">✓ Score with its modeling band and a point-by-point audit trail</li>
          <li class="text-sm text-muted-foreground">✓ Missing keywords from your job posting, or your occupation's O*NET profile</li>
          <li class="text-sm text-muted-foreground">✓ Weakest bullets identified and rewritten</li>
          <li class="text-sm text-muted-foreground">✓ Industry detection across ${NIND} fields, including Spanish-language resumes</li>
          <li class="text-sm text-muted-foreground">✓ Red flags: gaps, vague duties, date inconsistencies, credential visibility</li>
        </ul>
      </section>
      <section class="mb-8">
        <h2 class="text-xl font-bold mb-3">Why use this instead of ChatGPT or Claude?</h2>
        <p class="text-sm text-muted-foreground leading-relaxed mb-3">A general chatbot gives useful generic advice, and if that's all you need, use it — it's free too. This scanner does the parts a chat can't: it runs your actual file through real text extraction (the step that silently breaks resumes), checks documented per-vendor ATS behaviors, verifies every quoted finding against your document so nothing is invented, scores against a consistent rubric with a reproducible report ID, and cites its keyword sources (your posting, or U.S. Department of Labor O*NET data).</p>
      </section>
      ${scanInsights?.overall ? `<section class="mb-8">
        <h2 class="text-xl font-bold mb-3">How real resumes actually score</h2>
        <p class="text-sm text-muted-foreground leading-relaxed">Live from our scan corpus (as of ${scanInsights.as_of}, rolling ${scanInsights.window_days}-day window): across ${scanInsights.overall.n.toLocaleString("en-US")} completed scans, the median resume scored <strong class="text-foreground">${scanInsights.overall.median}</strong>, with the middle half between ${scanInsights.overall.p25} and ${scanInsights.overall.p75}${scanInsights.overall.pct_80_plus != null ? `; only ${scanInsights.overall.pct_80_plus}% scored 80 or higher` : ""}. Aggregates only, no individual resume data — full per-industry and experience-level distributions in the <a href="/research/ats-score-benchmarks" class="text-primary">live benchmark study</a>.${scanTotals ? ` All-time, the scanner has completed ${scanTotals.total_scans.toLocaleString("en-US")} scans${scanTotals.countries > 1 ? ` from ${scanTotals.countries.toLocaleString("en-US")} countries` : ""}.` : ""}</p>
      </section>` : ""}
      <section class="mb-8">
        <h2 class="text-xl font-bold mb-3">Free tools and data</h2>
        <div class="flex flex-wrap gap-2 text-xs">
          ${pill("/resume-checker", "Free resume checker →")}
          ${pill("/ats-resume-test", "ATS resume test →")}
          ${pill("/resume-score", "Resume score →")}
          ${pill("/industries", `Keywords for ${NIND} industries →`)}
          ${pill("/guides", "Resume & ATS guides →")}
          ${pill("/es/revisar-curriculum", "Revisar currículum (español) →")}
          ${pill("/builder", "Free resume builder →")}
          ${pill("/methodology", "How the scoring works →")}
        </div>
      </section>`,
  });

  // ---- /cv-standards: per-country CV norms (EN for all countries, localized per CV_LOCALES) ----
  {
    const isoList = Object.keys(D.COUNTRY_SLUGS).filter((iso) => D.COUNTRY_STANDARDS[iso]);
    const sorted = [...isoList].sort((a, b) => D.COUNTRY_STANDARDS[a].name.localeCompare(D.COUNTRY_STANDARDS[b].name));
    write({
      path: "/cv-standards",
      title: "CV & Resume Standards by Country — Photo, Length, Format Rules",
      description: `What a resume or CV actually looks like in ${isoList.length} countries: photo norms, expected length, personal-data rules, and formatting conventions — the live data our resume scanner applies per market.`,
      jsonLd: [breadcrumbLd([{ name: "Home", path: "/" }, { name: "CV Standards", path: "/cv-standards" }])],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "CV Standards" }])}
        <h1 class="text-3xl font-bold mb-3">CV &amp; resume standards by country</h1>
        <p class="text-muted-foreground mb-8">Resume rules change at every border — a photo is expected in Germany and gets you discarded in the US. These pages are the live per-country data our scanner applies when your resume targets a market: ${isoList.length} countries, updated whenever the engine improves.</p>
        <div class="grid sm:grid-cols-2 gap-2.5">${sorted.map((iso) => `<a href="/cv-standards/${D.COUNTRY_SLUGS[iso]}" class="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground"><span>${esc(D.COUNTRY_STANDARDS[iso].name)}</span></a>`).join("")}</div>`,
    });

    const sectionHtml = (t, std, notes, name) => `
      <div class="grid sm:grid-cols-2 gap-3 mb-8">
        <div class="rounded-xl border border-border bg-card p-4"><h2 class="text-sm font-semibold mb-1">${esc(t.docTermLabel)}</h2><p class="font-medium">${esc(std.docTerm)}</p><p class="text-xs text-muted-foreground mt-1">${esc(t.paperLabel)}: ${esc(std.paper)}</p></div>
        <div class="rounded-xl border border-border bg-card p-4"><h2 class="text-sm font-semibold mb-1">${esc(t.lengthLabel)}</h2><p class="font-medium">${esc(notes.lengthNote)}</p></div>
      </div>
      <section class="rounded-2xl border border-primary/25 bg-primary/5 p-5 mb-8"><h2 class="text-lg font-bold mb-1">${esc(t.photoLabel)} <span class="ml-2 px-2.5 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold">${esc(t.photoNorms[std.photo])}</span></h2><p class="text-sm text-muted-foreground">${esc(notes.photoNote)}</p></section>
      <section class="mb-8"><h2 class="text-lg font-bold mb-1">${esc(t.personalLabel)}</h2><p class="text-sm text-muted-foreground">${esc(notes.personalDataNote)}</p></section>
      ${notes.conventions.length ? `<section class="mb-8"><h2 class="text-lg font-bold mb-2">${esc(t.conventionsLabel)}</h2><ul class="space-y-2 text-sm text-muted-foreground">${notes.conventions.map((c) => `<li>• ${esc(c)}</li>`).join("")}</ul></section>` : ""}
      <section class="rounded-2xl border-2 border-primary bg-card p-6 text-center"><h2 class="text-xl font-bold mb-2">${esc(t.ctaTitle)}</h2><p class="text-sm text-muted-foreground mb-4">${esc(D.fill(t.ctaText, { name }))}</p><a href="/" class="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm">${esc(t.ctaButton)}</a></section>
      <p class="text-[11px] text-muted-foreground mt-6">${esc(t.sourceNote)}</p>`;

    // EN page per country
    for (const iso of isoList) {
      const std = D.COUNTRY_STANDARDS[iso];
      const t = D.EN_TEMPLATE;
      const name = std.name;
      const vars = { name, docTerm: std.docTerm };
      const notes = { lengthNote: std.lengthNote, photoNote: std.photoNote, personalDataNote: std.personalDataNote, conventions: std.conventions };
      write({
        path: `/cv-standards/${D.COUNTRY_SLUGS[iso]}`,
        hreflang: D.hreflangCluster(iso),
        title: D.fill(t.title, vars),
        description: D.fill(t.metaDescription, vars),
        jsonLd: [
          breadcrumbLd([{ name: "Home", path: "/" }, { name: "CV Standards", path: "/cv-standards" }, { name, path: `/cv-standards/${D.COUNTRY_SLUGS[iso]}` }]),
          faqLd([
            { q: D.fill(t.faqPhoto, vars), a: `${t.photoNorms[std.photo]}. ${std.photoNote}` },
            { q: D.fill(t.faqLength, vars), a: std.lengthNote },
          ]),
        ],
        content: `
          ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "CV Standards", href: "/cv-standards" }, { name }])}
          <h1 class="text-3xl font-bold mb-3">${esc(D.fill(t.h1, vars))}</h1>
          <p class="text-muted-foreground mb-8">${esc(D.fill(t.intro, vars))}</p>
          ${(() => { const cl = D.hreflangCluster(iso); const names = { es: "Español", fr: "Français", de: "Deutsch", pt: "Português", nl: "Nederlands" }; const alts = Object.entries(cl).filter(([l]) => l !== "en"); return alts.length ? `<p class="text-xs text-muted-foreground mb-6">${alts.map(([l, href]) => `<a href="${href}" class="text-primary mr-3">${names[l] ?? l} →</a>`).join("")}</p>` : ""; })()}
          ${sectionHtml(t, std, notes, name)}`,
      });
    }

    // Localized pages per CV_LOCALES
    for (const [locale, cfg] of Object.entries(D.CV_LOCALES)) {
      for (const [iso, slug] of Object.entries(cfg.slugs)) {
        const std = D.COUNTRY_STANDARDS[iso];
        const notes = cfg.content[iso];
        if (!std || !notes) continue;
        const t = cfg.t;
        const name = notes.countryName;
        const vars = { name, docTerm: std.docTerm };
        write({
          path: `/${cfg.pathBase}/${slug}`,
          lang: cfg.htmlLang,
          hreflang: D.hreflangCluster(iso),
          title: D.fill(t.title, vars),
          description: D.fill(t.metaDescription, vars),
          jsonLd: [faqLd([
            { q: D.fill(t.faqPhoto, vars), a: `${t.photoNorms[std.photo]}. ${notes.photoNote}` },
            { q: D.fill(t.faqLength, vars), a: notes.lengthNote },
          ])],
          content: `
            <h1 class="text-3xl font-bold mb-3">${esc(D.fill(t.h1, vars))}</h1>
            <p class="text-muted-foreground mb-8">${esc(D.fill(t.intro, vars))}</p>
            <p class="text-xs text-muted-foreground mb-6"><a href="/cv-standards/${D.COUNTRY_SLUGS[iso]}" class="text-primary">English version →</a></p>
            ${sectionHtml(t, std, notes, name)}`,
        });
      }
    }
  }

  // ---- Job-board category landers: the queries people actually type are
  // "healthcare jobs", not "job board". 17 crawlable pages, counts baked
  // from the live corpus at build time (omitted gracefully offline), copy
  // limited to what the board verifiably does.
  {
    const catCounts = boardFacets?.categoriesFacet ?? {};
    const boardTotal = typeof boardFacets?.total === "number" ? boardFacets.total : null;
    const boardCompanies = typeof boardFacets?.companiesCount === "number"
      ? boardFacets.companiesCount
      : (Array.isArray(boardFacets?.companiesFacet) ? boardFacets.companiesFacet.length : null);
    const fmt = (n) => n.toLocaleString("en-US");
    for (const [slug, label] of CATEGORY_LANDERS) {
      const n = typeof catCounts[slug] === "number" ? catCounts[slug] : null;
      const countPhrase = n ? `${fmt(n)} live ${label} openings right now` : `live ${label} openings`;
      const siblings = CATEGORY_LANDERS.filter(([s]) => s !== slug).slice(0, 6)
        .map(([s, l]) => `<a href="/jobs/field/${s}" class="underline">${l} jobs</a>`).join(" · ");
      write({
        path: `/jobs/field/${slug}`,
        title: n ? `${label} Jobs — ${fmt(n)}+ Live Openings` : `${label} Jobs — Live Openings from Company Boards`,
        description: `Browse ${countPhrase}, pulled from ${boardCompanies ? `${boardCompanies}` : "3,000+"} companies' official job boards and re-verified all day. Check your resume's fit free before you apply.`,
        content: `
          <h1>Live ${label} jobs</h1>
          <p>${countPhrase[0].toUpperCase()}${countPhrase.slice(1)}${boardTotal ? ` — part of ${fmt(boardTotal)} live postings across ${fmt(boardCompanies)} companies` : ""}, pulled directly from the official job boards companies publish on Greenhouse, Workday, Lever, Ashby, SmartRecruiters, Oracle, Workable, BambooHR, Recruitee, Teamtailor, Personio, Breezy, Rippling, and Pinpoint. No scraped listings, no aggregators, no reposts: every opening belongs to the company that published it, and applying happens on the company's own site.</p>
          <p>The largest boards are re-checked about every 10–15 minutes and the whole catalog rotates continuously — every feed re-verified within a few hours — so postings a company takes down disappear on the next pass. Counts on this page were measured when it was last built; the board's own count refreshes periodically through the day.</p>
          <p><a href="/jobs/field/${slug}">Browse ${label} openings on the live board</a> — filter by keyword, location, remote, and company; save searches with a free account; and check any posting against your resume with the <a href="/">free resume scan</a> before you spend an application on it.</p>
          <p>Other fields: ${siblings} — or see <a href="/jobs">the full job board</a>.</p>
        `,
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: `Live ${label} jobs`,
          description: `Live ${label} openings from companies' official job boards, re-verified throughout the day.`,
          url: `${SITE}/jobs/field/${slug}`,
          isPartOf: { "@type": "WebSite", name: "Resume Booster", url: SITE },
        }, {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Job board", item: `${SITE}/jobs` },
            { "@type": "ListItem", position: 2, name: `${label} jobs`, item: `${SITE}/jobs/field/${slug}` },
          ],
        }],
      });
    }

    // Company landing pages: the top employers by open-role count each get a
    // crawlable "verified roles at {Company}" page — a real seeker destination and
    // a large SEO surface, generated from the company facet already fetched above.
    // Count-gated and capped so only substantive companies get a page; if the
    // build can't reach the board, this simply produces none.
    {
      const companyFacet = Array.isArray(boardFacets?.companiesFacet) ? boardFacets.companiesFacet : [];
      const topCompanies = companyFacet
        // Tilde is allowed: Oracle/Workday compound tokens (tenant~dc~site) are
        // valid URL path segments, the list API accepts them, and the SPA route
        // serves them 200 — verified live 2026-07-26 on Hilton (efet~us2~CX_1,
        // 2,001 postings), which had no lander at all under the old filter.
        .filter((c) => c && typeof c.token === "string" && /^[A-Za-z0-9._~-]+$/.test(c.token)
          && typeof c.count === "number" && c.count >= 8 && typeof c.name === "string" && c.name.trim())
        .sort((a, b) => b.count - a.count)
        .slice(0, 500);
      // ONE EMPLOYER, TWO BOARDS, TWO IDENTICAL PAGES.
      //
      // The URL is per-BOARD (source~tenant) but the page is about the
      // EMPLOYER, so an employer running two boards got two landers with the
      // same title, the same description and the same body — abbottcareers and
      // abbottcareers2, boeing's EXTERNAL_CAREERS and external_subsidiary, two
      // HPE boards, two PwC boards (audit 2026-08-15). Both were in the
      // sitemap, so we were submitting pairs of duplicates and letting Google
      // pick which to keep, which is how a page ends up reported as "Duplicate
      // without user-selected canonical".
      //
      // The largest board becomes the indexable page for that employer; the
      // rest keep their file (they must, or the host serves them the homepage)
      // and point their canonical at it. Grouped on the same normalized display
      // name that get_size_segments merges on, so this page family and the
      // company counts agree about what "one employer" means.
      const primaryByName = new Map();
      for (const c of topCompanies) {
        const key = c.name.trim().toLowerCase();
        const prev = primaryByName.get(key);
        if (!prev || c.count > prev.count) primaryByName.set(key, c);
      }
      let consolidated = 0;
      for (const c of topCompanies) {
        const nm = c.name.trim();
        const primary = primaryByName.get(nm.toLowerCase());
        const isPrimary = primary.token === c.token;
        if (!isPrimary) consolidated++;
        write({
          path: `/jobs/company/${c.token}`,
          canonical: isPrimary ? null : `/jobs/company/${primary.token}`,
          title: `${nm} Jobs — ${fmt(c.count)} Verified Openings`,
          description: `Browse ${fmt(c.count)} open roles at ${nm}, pulled straight from ${nm}'s own job board and re-verified all day — no aggregators, no reposts. Check your resume's fit free, then apply on ${nm}'s own site.`,
          content: `
            <h1>Open roles at ${esc(nm)}</h1>
            <p>${fmt(c.count)} verified ${esc(nm)} openings right now, pulled straight from ${esc(nm)}'s own official job board (Greenhouse, Workday, Lever, Ashby, SmartRecruiters, Oracle, Workable, BambooHR, Recruitee, Teamtailor, Personio, Breezy, Rippling, or Pinpoint) and re-verified all day. No aggregators, no reposts, no scraped copies — every role belongs to ${esc(nm)}, and applying happens on ${esc(nm)}'s own site. Counts were measured when this page was last built; the board's own count refreshes periodically through the day.</p>
            <p><a href="/jobs/company/${c.token}">Browse all ${esc(nm)} openings on the live board</a> — filter by role, location, experience, and remote, and check any posting against your resume with the <a href="/">free resume scan</a> before you spend an application on it.</p>
            <p>See <a href="/jobs">the full job board</a>${boardCompanies ? ` for openings across ${fmt(boardCompanies)} companies` : ""}.</p>
          `,
          jsonLd: [{
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            name: `Open roles at ${nm}`,
            description: `Verified ${nm} openings from ${nm}'s official job board, re-verified throughout the day.`,
            url: `${SITE}/jobs/company/${c.token}`,
            isPartOf: { "@type": "WebSite", name: "Resume Booster", url: SITE },
          }, {
            "@context": "https://schema.org",
            "@type": "BreadcrumbList",
            itemListElement: [
              { "@type": "ListItem", position: 1, name: "Job board", item: `${SITE}/jobs` },
              { "@type": "ListItem", position: 2, name: `${nm} jobs`, item: `${SITE}/jobs/company/${c.token}` },
            ],
          }],
        });
      }
      console.log(`[prerender-seo] company pages: ${topCompanies.length} (${consolidated} canonicalized to a larger board of the same employer)`);
    }

    // Main board page — the parent of the field landers. Without its own write()
    // it fell back to the homepage (scanner) meta, wasting the single most
    // important jobs URL. Board-specific title/description, live counts when the
    // build can reach the board, honest '3,000+' fallback otherwise.
    {
      // PLUS-CLAIMS, not exact figures. This lander baked "608,082 openings /
      // 25,065 companies" into its title and description, and the board then
      // moved (it always moves) — by the 2026-08-17 incident's end both were
      // ~4% overstated in crawler-facing copy. An exact number that is only
      // true on build day is indistinguishable from a made-up one by the time
      // anyone reads it; the body text already says counts are measured at
      // build. Same margined plusClaim as the homepage, one honesty rule.
      const jobsPhrase = boardTotal
        ? `${plusClaim(boardTotal, 50000)} live openings across ${plusClaim(boardCompanies, 1000)} companies`
        : "live openings across 3,000+ companies";
      write({
        path: "/jobs",
        title: boardTotal
          ? `Live Job Board — ${plusClaim(boardTotal, 50000)} Openings Direct From Company Career Pages`
          : "Live Job Board — Openings Direct From Company Career Pages",
        description: `Browse ${jobsPhrase} — straight from official company job boards. No aggregators; no dated posting older than 30 days.`,
        content: `
          <h1>Live job board</h1>
          <p>${jobsPhrase[0].toUpperCase()}${jobsPhrase.slice(1)}, pulled directly from the official job boards companies publish on Greenhouse, Workday, Lever, Ashby, SmartRecruiters, Oracle, Workable, BambooHR, Recruitee, Teamtailor, Personio, Breezy, Rippling, and Pinpoint. No scraped listings, no aggregators, no reposts — every opening belongs to the company that published it, applying happens on the company's own site, and no dated posting older than 30 days stays on the board. Where a company states no date at all we can't judge the posting old, so we keep it and show no age rather than guess one. Counts were measured when this page was last built; the board's own count refreshes periodically through the day.</p>
          <p>Browse by field: ${CATEGORY_LANDERS.map(([s, l]) => `<a href="/jobs/field/${s}">${l} jobs</a>`).join(" · ")}.</p>
          <p>Check any posting against your resume with the <a href="/">free resume scan</a> before you spend an application on it, and save searches with a free account.</p>
        `,
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Live job board",
          description: "Live openings from companies' official job boards (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR), re-verified throughout the day — no aggregators, no dated posting older than 30 days.",
          url: `${SITE}/jobs`,
          isPartOf: { "@type": "WebSite", name: "Resume Booster", url: SITE },
        }],
      });
    }

    // The Ghost Job Index — the board's public transparency page. Static shell
    // only (the live stats hydrate client-side); prerendering puts the page in
    // the sitemap and gives crawlers real head/meta + explainer content.
    {
      write({
        path: "/ghost-job-index",
        title: "The Ghost Job Index — how many job postings are actually real?",
        description: "A live measure of job-posting reality: how many roles are open, how long postings stay up, how fast they fill, and who is actively hiring — audited daily.",
        content: `
          <h1>The Ghost Job Index</h1>
          <p>Ghost jobs — postings that are stale, already filled, or never real — waste job seekers' time everywhere. This page is our live, honest measure of the opposite: postings that are verified, fresh, and from companies actually hiring.</p>
          <p>Every figure is computed from the full lifecycle of postings on companies' official job boards (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR) — never an aggregator or a scrape. Any posting whose company-stated date passes 30 days is dropped automatically, we log every closure to measure which employers truly fill roles, we sample random listings daily and re-check them against the companies' own systems, and every posting is re-checked live the moment you click Apply. Where a company states no date at all we can't judge the posting old, so we keep it and show no age rather than guess one.</p>
          <p><a href="/jobs">Browse the live board</a> — or check any posting against your resume with the <a href="/">free resume scan</a> first.</p>
        `,
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "The Ghost Job Index",
          description: "A live, honest measure of job-posting freshness and which companies actually fill roles, computed from official company job boards and audited daily.",
          url: `${SITE}/ghost-job-index`,
          isPartOf: { "@type": "WebSite", name: "Resume Booster", url: SITE },
        }],
      });
    }

    // The Entry-Level Index — live ranking of who's hiring early-career.
    // Static shell like the Ghost Job Index; stats hydrate client-side.
    {
      write({
        path: "/entry-level-index",
        title: "The Entry-Level Index — who's actually hiring entry-level right now?",
        description: "A live ranking of companies with real entry-level openings — junior, graduate, and early-career roles counted from companies' official job boards, refreshed all day. No aggregators, no dated posting older than 30 days.",
        content: `
          <h1>The Entry-Level Index</h1>
          <p>"Entry-level, 5 years' experience required" is a running joke for a reason. This page counts the real thing: openings whose own titles and requirements say early-career — internships, junior, graduate, and 0–2 year roles — and ranks the companies that post the most of them.</p>
          <p>Every count comes live from companies' official job boards (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR, Recruitee, Teamtailor, Personio, Breezy, Rippling, Workday) — never an aggregator or a scrape, and no dated posting older than 30 days (undated ones show no age rather than a guessed one). A role counts as entry-level when its own title or stated requirements say so; we never guess.</p>
          <p><a href="/jobs?experience=entry">Browse all verified entry-level openings</a>, check the <a href="/hiring-trends">weekly hiring trends</a>, or scan your resume against any posting with the <a href="/">free resume scan</a>.</p>
        `,
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "The Entry-Level Index",
          description: "A live ranking of companies with real entry-level openings, counted from official company job boards.",
          url: `${SITE}/entry-level-index`,
          isPartOf: { "@type": "WebSite", name: "Resume Booster", url: SITE },
        }],
      });
    }

    // Weekly Hiring Trends — counted postings per week, trending fields.
    {
      write({
        path: "/hiring-trends",
        title: "Weekly Hiring Trends — how many jobs were really posted this week?",
        description: "Live weekly hiring data from companies' official job boards: new postings per week, which fields are hiring, entry-level and remote shares, and how many roles actually got filled — no estimates, no surveys.",
        content: `
          <h1>Weekly Hiring Trends</h1>
          <p>Is hiring up or down this week? This page answers with counted postings, not vibes: every new role companies dated this week on their own boards, which fields they're in, and how many roles actually got filled.</p>
          <p>Counts use each posting's own stated date from the company's official applicant-tracking feed. Postings from companies newly added to our catalog are excluded from weekly counts, so growth in our coverage never shows up as a fake hiring spike. Closure counts come from our lifecycle log — the moment a company takes a posting down, we record it.</p>
          <p><a href="/jobs">Browse the live board</a>, see <a href="/entry-level-index">who's hiring entry-level</a>, or check the <a href="/ghost-job-index">Ghost Job Index</a>.</p>
        `,
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "Weekly Hiring Trends",
          description: "Live weekly hiring data computed from official company job boards: new postings, trending fields, and roles actually filled.",
          url: `${SITE}/hiring-trends`,
          isPartOf: { "@type": "WebSite", name: "Resume Booster", url: SITE },
        }],
      });
    }

    // Pay Transparency Index — live ranking of fields/systems/employers by
    // stated-pay share. Static shell; stats hydrate client-side.
    {
      write({
        path: "/pay-transparency",
        title: "Pay Transparency Index — who actually states salaries?",
        description: "A live ranking of fields, hiring systems, and large employers by the share of job postings that state pay — counted from companies' own posting text and ATS fields. No estimates, no modeled ranges.",
        content: `
          <h1>The Pay Transparency Index</h1>
          <p>Which employers actually state salaries? This page counts it: the share of live postings whose own text or ATS compensation field states pay, ranked by field, by hiring system, and across large employers. Every figure is the company's verbatim words — never an estimate, never a modeled range.</p>
          <p>The same rules apply to work modes: a posting is tagged remote, hybrid, or on-site only when the employer's own ATS field or explicit posting text says so. Postings that don't say carry no tag — we show nothing rather than a guess.</p>
          <p>Placement on this page cannot be bought. Browse <a href="/jobs?mode=remote">remote roles</a>, check the <a href="/ghost-job-index">Ghost Job Index</a>, or license the underlying data at <a href="/data-api">Hiring Data &amp; API</a>.</p>
        `,
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "Pay Transparency Index",
          description: "Live ranking of fields, hiring systems, and large employers by the share of job postings stating pay, computed from official company job boards.",
          url: `${SITE}/pay-transparency`,
          isPartOf: { "@type": "WebSite", name: "Resume Booster", url: SITE },
        }],
      });
    }

    // Hiring Data & API — the B2B data-licensing page. Static shell; the few
    // live stats hydrate client-side.
    {
      write({
        path: "/data-api",
        title: "Hiring Data & API — lifecycle-tracked job posting data",
        description: "License the dataset behind our live board: lifecycle-tracked postings from official company career sites, genuine fills vs re-listing churn, stated salary ranges, and daily accuracy audits. Free for journalists with attribution.",
        content: `
          <h1>Hiring Data &amp; API</h1>
          <p>Most job data stops at "posted." Ours follows every posting to the end: when it closed, whether it was genuinely filled or quietly re-listed under a new ID, and what the company itself said it paid. Everything is collected from companies' own official career sites — never aggregators — and audited against them daily.</p>
          <p>The dataset contains zero jobseeker data: resumes are never stored on Resume Booster, so there is nothing about job seekers to license. And no license, at any price, changes what the data says about any company — including the licensee.</p>
          <p>Access is free for journalists with attribution, at cost for academic and nonprofit research, and custom-priced for commercial feeds. A live slice is already public: see the <a href="/ghost-job-index">Ghost Job Index</a>, <a href="/hiring-trends">Weekly Hiring Trends</a>, and the <a href="/entry-level-index">Entry-Level Index</a>.</p>
        `,
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "Hiring Data & API",
          description: "Lifecycle-tracked job posting data from official company career sites: fills vs re-listing churn, stated salaries, daily audits. Free for journalists with attribution.",
          url: `${SITE}/data-api`,
          isPartOf: { "@type": "WebSite", name: "Resume Booster", url: SITE },
        }],
      });
    }
  }

  // ---- /methodology, /trust, /freelance-boost, /affiliates ----
  // THE SAME BUG AS /pricing, FOUND AGAIN A YEAR LATER — and this time we were
  // the ones telling Google to index it.
  //
  // Audit 2026-08-15. All four are declared in sitemap.xml, so we actively
  // submit them for indexing. All four fell through to the homepage fallback,
  // which means a crawler fetching /trust received the HOMEPAGE's <title>,
  // <meta description>, og:title, og:description AND the homepage's rendered
  // body — byte-for-byte identical across all four URLs. Verified live against
  // a Googlebot user-agent before this fix: four sitemap URLs, one page.
  //
  // Three of them (/methodology, /trust, /freelance-boost) do carry a correct
  // <SEO> component, which is exactly what made this survive so long: open any
  // of them in a browser and the tab title is right, because React swapped it
  // after hydration. The served HTML — what a non-rendering crawler indexes,
  // and what every AI answer engine reads — was the homepage. A page whose SEO
  // is correct only after JavaScript runs is a page that is correct only for
  // the crawlers that needed no help.
  //
  // /affiliates had no <SEO> at all, so it was wrong in both renders.
  //
  // Titles and descriptions below are the pages' OWN strings, read from
  // en.json (methodologyPage.*, trustPage.*) and from the components' existing
  // <SEO> props — never freshly invented here. That is the whole failure mode
  // this file keeps hitting: a second copy of the truth that drifts from the
  // first. Where a page's copy is a literal in the component, it is quoted
  // verbatim rather than paraphrased.
  {
    const M = (D.EN_LOCALE && D.EN_LOCALE.methodologyPage) || {};
    const T = (D.EN_LOCALE && D.EN_LOCALE.trustPage) || {};
    const steps = M.steps || {};
    const sec = T.security || {};

    write({
      path: "/methodology",
      title: M.metaTitle || "Methodology — How Resume Booster Scores Resumes",
      description: M.metaDescription,
      jsonLd: [
        breadcrumbLd([{ name: "Home", path: "/" }, { name: "Methodology", path: "/methodology" }]),
        {
          "@context": "https://schema.org",
          "@type": "HowTo",
          name: "How Resume Booster analyzes your resume",
          description: M.heroSubtitle,
          step: Object.values(steps).map((s, i) => ({
            "@type": "HowToStep",
            position: i + 1,
            name: s.title,
            text: s.description,
          })),
        },
      ],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Methodology" }])}
        <h1 class="text-3xl font-bold mb-3">${esc(`${M.titlePrefix || "Our ATS Analysis"} ${M.titleHighlight || "Methodology"}`)}</h1>
        <p class="text-muted-foreground mb-8">${esc(M.heroSubtitle || "")}</p>
        <section class="mb-8"><h2 class="text-xl font-bold mb-3">${esc(M.howAnalysisWorks || "How the analysis works")}</h2>
          <ol class="space-y-3">${Object.values(steps).map((s, i) => `<li class="rounded-xl border border-border bg-card p-4"><p class="text-sm font-semibold text-foreground mb-1">${i + 1}. ${esc(s.title)}</p><p class="text-xs text-muted-foreground">${esc(s.description)}</p></li>`).join("")}</ol>
        </section>
        <section class="mb-8"><h2 class="text-xl font-bold mb-2">${esc(M.scoreCalculatedTitle || "How your ATS score is calculated")}</h2>
          <p class="text-sm text-muted-foreground">${esc(M.scoreCalculatedSubtitle || "")}</p>
        </section>
        <section class="mb-8"><h2 class="text-xl font-bold mb-2">${esc(M.atsPlatformsTitle || "ATS platforms we analyze against")}</h2>
          <p class="text-sm text-muted-foreground">${esc(M.atsPlatformsSubtitle || "")}</p>
        </section>
        ${cta("See it run on your own resume", "The full diagnostic — score with audit trail, parse checks, missing keywords — is free and needs no signup.", "Scan my resume free")}`,
    });

    write({
      path: "/trust",
      title: T.metaTitle || "Trust & Security — Resume Booster",
      description: T.metaDescription,
      jsonLd: [breadcrumbLd([{ name: "Home", path: "/" }, { name: "Trust & Security", path: "/trust" }])],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Trust & Security" }])}
        <h1 class="text-3xl font-bold mb-3">${esc(`${T.titlePrefix || "Your Resume Is"} ${T.titleHighlight || "Safe With Us"}`)}</h1>
        <p class="text-muted-foreground mb-8">${esc(T.heroSubtitle || "")}</p>
        <section class="mb-8"><h2 class="text-xl font-bold mb-3">${esc(T.protectDataTitle || "How we protect your data")}</h2>
          <div class="space-y-2">${Object.values(sec).map((s) => `<div class="rounded-xl border border-border bg-card p-4"><p class="text-sm font-semibold text-foreground mb-1">${esc(s.title)}</p><p class="text-xs text-muted-foreground">${esc(s.description)}</p></div>`).join("")}</div>
        </section>
        <section class="mb-8"><h2 class="text-xl font-bold mb-2">${esc(T.transparentScoringTitle || "Transparent scoring")}</h2>
          <p class="text-sm text-muted-foreground mb-3">${esc(T.transparentScoringSubtitle || "")}</p>
          <a href="/methodology" class="text-sm font-medium text-primary underline">${esc(T.viewMethodology || "View the methodology")}</a>
        </section>
        ${cta("Scan without an account", "No signup, no card, and nothing kept — 7 free scans a day.", "Scan my resume free")}`,
    });

    // ---- /agent ----
    // FOUND 2026-08-18 by the post-recovery SEO sweep: /agent — the page the
    // $99/mo product's checkout, the board pitch, and the welcome redirect all
    // land on — served the HOMEPAGE SHELL, byte-identical (16,183B), homepage
    // title, homepage description, no canonical. To a crawler the money page
    // was a duplicate of the front page; to an answer engine the price, the
    // trial, the four-vendor scope and the CAPTCHA boundary were INVISIBLE,
    // because they existed only in JS. The claims below are the SAME countable
    // claims the board pitch makes (Jobs.tsx, agent-is-visible-on-the-board
    // guard) — a crawler and a visitor must read the same product.
    write({
      path: "/agent",
      title: "Apply Agent — $99/mo, Applications Sent For You",
      description: "The agent matches fresh postings to your resume and submits real applications on four hiring systems. $99/mo, 7 days free. It never solves CAPTCHAs.",
      jsonLd: [breadcrumbLd([{ name: "Home", path: "/" }, { name: "Apply Agent", path: "/agent" }])],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Apply Agent" }])}
        <h1 class="text-3xl font-bold mb-3">The agent applies. You interview.</h1>
        <p class="text-muted-foreground mb-8">Tell it the roles you want and it watches the board for you — every morning it queues fresh, matching postings and submits real applications with your resume and answers, on the hiring systems it can drive end to end. You review what it sent, not what it plans to send.</p>
        <section class="mb-8"><h2 class="text-xl font-bold mb-3">What it costs, and what you get</h2>
          <div class="rounded-xl border border-border bg-card p-4 mb-2"><p class="text-sm font-semibold text-foreground mb-1">$99/month, 7 days free</p><p class="text-xs text-muted-foreground">Cancel any time. The trial runs the same pipeline as the paid plan — real applications, not samples.</p></div>
          <div class="rounded-xl border border-border bg-card p-4"><p class="text-sm font-semibold text-foreground mb-1">A morning queue, not a spray</p><p class="text-xs text-muted-foreground">Matches come from the same live board the site serves — fresh postings only, matched against your resume, deduplicated against everything already sent.</p></div>
        </section>
        <section class="mb-8"><h2 class="text-xl font-bold mb-3">The limits, stated up front</h2>
          <div class="rounded-xl border border-border bg-card p-4 mb-2"><p class="text-sm font-semibold text-foreground mb-1">Four hiring systems — about 6% of the board</p><p class="text-xs text-muted-foreground">The agent submits only where it can complete a real application end to end. The board labels every posting it can send to, so the scope is countable on the page, not a claim.</p></div>
          <div class="rounded-xl border border-border bg-card p-4"><p class="text-sm font-semibold text-foreground mb-1">It never solves CAPTCHAs or evades bot checks</p><p class="text-xs text-muted-foreground">Where a site gates applying, the agent prepares the application — answers, resume, cover note — and you press send. That boundary is permanent.</p></div>
        </section>
        ${cta("Set up the agent", "Upload a resume, pick your targets, and the first morning queue is ready tomorrow. 7 days free.", "Start free week")}`,
    });

    write({
      path: "/freelance-boost",
      // Verbatim from the page's own <SEO> props — the strings a browser
      // already renders into the tab; this puts them in the served HTML too.
      title: "Freelance Boost — Turn Projects Into Resume Experience",
      description: "Turn freelance projects, gig work, and side hustles into recruiter-grade resume experience. Built for career changers who've already done the work.",
      jsonLd: [breadcrumbLd([{ name: "Home", path: "/" }, { name: "Freelance Boost", path: "/freelance-boost" }])],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Freelance Boost" }])}
        <h1 class="text-3xl font-bold mb-3">Your freelance work counts. Make recruiters see it.</h1>
        <p class="text-muted-foreground mb-8">Freelance projects, contract gigs and side work are real experience, and they get read as a gap when they are written like a portfolio instead of a job. Freelance Boost translates the work you have already done into the structure, bullets and keywords a recruiter and an ATS both parse as employment — in about 15 seconds.</p>
        <section class="mb-8"><h2 class="text-xl font-bold mb-3">What it produces</h2>
          <ul class="space-y-2 text-sm text-muted-foreground">
            <li class="rounded-xl border border-border bg-card p-4"><span class="font-semibold text-foreground">A structured experience entry</span> — your projects grouped under one umbrella role rather than scattered one-line gigs, which is the format that stops reading as a job-hopping record.</li>
            <li class="rounded-xl border border-border bg-card p-4"><span class="font-semibold text-foreground">Recruiter-grade bullets</span> — each project rewritten as an accomplishment with the metric surfaced, in the wording your target role is actually screened on.</li>
            <li class="rounded-xl border border-border bg-card p-4"><span class="font-semibold text-foreground">A cover-letter transition paragraph</span> — the part that explains the move from independent work to the role you want, without apologising for it.</li>
          </ul>
        </section>
        <p class="text-sm text-muted-foreground mb-8">Related reading: <a href="/guides/freelance-work-on-resume" class="text-primary underline">how to put freelance work on your resume</a> and <a href="/guides/fractional-roles-on-resume" class="text-primary underline">how to put fractional roles on your resume</a>.</p>
        ${cta("Start with the free scan", "See how your resume reads today before changing anything — free, no signup.", "Scan my resume free")}`,
    });

    write({
      path: "/builder",
      // Verbatim from ResumeBuilder.tsx's own <SEO> props.
      title: "Free Resume Builder — Resume Booster",
      description: "Build an ATS-friendly resume in minutes with our free guided builder. Export to PDF, no signup required.",
      jsonLd: [
        breadcrumbLd([{ name: "Home", path: "/" }, { name: "Resume Builder", path: "/builder" }]),
        {
          "@context": "https://schema.org",
          "@type": "WebApplication",
          name: "Free Resume Builder",
          url: `${SITE}/builder`,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        },
      ],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Resume Builder" }])}
        <h1 class="text-3xl font-bold mb-3">Free resume builder</h1>
        <p class="text-muted-foreground mb-8">A guided builder that produces a resume an ATS can actually parse: standard section headings, a single-column layout, real text rather than tables or graphics, and dates in a format parsers read. Export to PDF when you are done. Free, and no signup.</p>
        <section class="mb-8"><h2 class="text-xl font-bold mb-3">Why layout decides whether you are read</h2>
          <p class="text-sm text-muted-foreground mb-3">Most resumes that never get a reply were never rejected by a person. They were parsed into the wrong fields — a two-column layout read across instead of down, experience buried in a text box, a header the parser dropped — and the recruiter saw a record with gaps that were never in the resume. The builder avoids those constructs rather than fixing them afterwards.</p>
          <p class="text-sm text-muted-foreground">If you already have a resume, run the <a href="/" class="text-primary underline">free scan</a> first — it shows what an ATS extracts from your current file, which usually tells you whether you need a rebuild or an edit. The scoring rubric behind it is documented on the <a href="/methodology" class="text-primary underline">methodology page</a>.</p>
        </section>
        ${cta("Check your current resume first", "See exactly what a parser pulls out of the file you have today — free, no signup.", "Scan my resume free")}`,
    });

    // /shortlist is an AUTH WALL, not a page: it redirects to /auth when there
    // is no session, so it has never had public content. It was in the sitemap
    // anyway, where it served the homepage fallback — we were submitting a
    // duplicate of "/" for indexing and getting nothing for it. It keeps a file
    // (the footer links to it, and without one the host serves the homepage
    // there) and is marked noindex, which is the accurate instruction: this URL
    // exists, and there is nothing here to index.
    write({
      path: "/shortlist",
      robots: "noindex, follow",
      title: "Shortlist for Employers — Resume Booster",
      description: "Sign in to manage your shortlist.",
      content: `
        <h1 class="text-2xl font-bold mb-3">Shortlist</h1>
        <p class="text-muted-foreground mb-6">This page needs an account. <a href="/auth" class="text-primary underline">Sign in</a> to continue, or <a href="/" class="text-primary underline">run the free resume scan</a> — that needs no account at all.</p>`,
    });

    write({
      path: "/affiliates",
      title: "Affiliate Program — Earn 20% on Every Referral",
      description: "Earn 20% commission on every sale you refer, with a 30-day cookie and monthly payouts. Join the Resume Booster affiliate program or sign in to your dashboard.",
      jsonLd: [breadcrumbLd([{ name: "Home", path: "/" }, { name: "Affiliate Program", path: "/affiliates" }])],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Affiliate Program" }])}
        <h1 class="text-3xl font-bold mb-3">Join the Resume Booster affiliate program</h1>
        <p class="text-muted-foreground mb-8">Earn 20% commission on every sale you refer. 30-day cookie, paid monthly, and a dashboard that shows referrals and earnings over any date range you pick.</p>
        <section class="mb-8"><h2 class="text-xl font-bold mb-3">The terms</h2>
          <ul class="space-y-2 text-sm text-muted-foreground">
            <li class="rounded-xl border border-border bg-card p-4"><span class="font-semibold text-foreground">20% commission</span> on every sale from someone you referred.</li>
            <li class="rounded-xl border border-border bg-card p-4"><span class="font-semibold text-foreground">30-day cookie</span> — you are credited if they buy within 30 days of clicking your link.</li>
            <li class="rounded-xl border border-border bg-card p-4"><span class="font-semibold text-foreground">Paid monthly</span>, with per-referral detail in your dashboard.</li>
          </ul>
        </section>
        <p class="text-sm text-muted-foreground mb-8">What you would be referring people to: a resume scanner whose full diagnostic is free with no signup, and a job board of verified openings pulled straight from employers' own hiring systems. Sign-up and login are on this page in the app.</p>
        ${cta("See the product first", "Run the free scan yourself before you recommend it — that is the honest order.", "Scan my resume free")}`,
    });
  }

  // ---- /pricing, /changelog, /explore ----
  // All three previously served the HOMEPAGE fallback prerender byte-for-byte
  // (audit 2026-07-25): the money page had no pricing title/description/
  // canonical in served HTML, and /explore wasn't in the sitemap at all.
  {
    const paid = D.getAllProducts().filter((p) => typeof p.priceUsd === "number" && p.priceUsd > 0);
    const minP = Math.min(...paid.map((p) => p.priceUsd));
    const maxP = Math.max(...paid.map((p) => p.priceUsd));
    write({
      path: "/pricing",
      title: `Pricing — Free Resume Scan, One-Time Tools from $${minP}`,
      description: `The diagnostic resume scan is free forever — 7 scans a day, no signup. Paid tools are one-time purchases ($${minP}–$${maxP}), plus an optional all-access Pro plan.`,
      jsonLd: [
        breadcrumbLd([{ name: "Home", path: "/" }, { name: "Pricing", path: "/pricing" }]),
        {
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Resume Booster",
          url: `${SITE}/pricing`,
          applicationCategory: "BusinessApplication",
          operatingSystem: "Web",
          offers: {
            "@type": "AggregateOffer",
            priceCurrency: "USD",
            lowPrice: "0",
            highPrice: String(maxP),
            offerCount: paid.length + 1,
          },
        },
      ],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Pricing" }])}
        <h1 class="text-3xl font-bold mb-3">Pricing</h1>
        <p class="text-muted-foreground mb-6">The core product is free: the full diagnostic resume scan — score with audit trail, missing keywords, weakest bullets rewritten, ATS vendor checks — costs nothing, 7 scans a day with no signup (15 with a free account). The job board and its filters are free too. Paid tools are one-time purchases, not subscriptions; an optional Pro plan covers everything for people applying at volume.</p>
        <section class="mb-8"><h2 class="text-xl font-bold mb-3">One-time tools</h2>
          <div class="space-y-2">${paid.map((p) => `<div class="rounded-xl border border-border bg-card p-4 flex items-start justify-between gap-4"><div><p class="text-sm font-semibold text-foreground">${esc(p.name)}</p><p class="text-xs text-muted-foreground mt-0.5">${esc(p.description || "")}</p></div><p class="text-sm font-bold text-foreground whitespace-nowrap">$${p.priceUsd}</p></div>`).join("")}</div>
        </section>
        <p class="text-sm text-muted-foreground mb-8">Current bundle discounts and the Pro all-access price are shown live on this page in the app.</p>
        ${cta("Start with the free scan", "See the full diagnostic before spending anything — most people need nothing else.", "Scan my resume free")}`,
    });

    const tEn = (D.EN_LOCALE && D.EN_LOCALE.changelogEntries) || {};
    const clItems = D.changelog
      .slice(0, 30)
      .map((e) => ({ ...e, title: tEn[e.id]?.title, desc: tEn[e.id]?.description }))
      .filter((e) => e.title);
    const TAG_LABEL = { new: "New", improved: "Improved", fixed: "Fixed" };
    write({
      path: "/changelog",
      title: "Changelog — Every Ship, Dated and Honest",
      description: clItems[0]
        ? `What changed and when, newest first — including honest postmortems. Latest (${clItems[0].date}): ${clItems[0].title}.`
        : "What changed and when, newest first — features, fixes, and honest postmortems.",
      jsonLd: [breadcrumbLd([{ name: "Home", path: "/" }, { name: "Changelog", path: "/changelog" }])],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Changelog" }])}
        <h1 class="text-3xl font-bold mb-3">Changelog</h1>
        <p class="text-muted-foreground mb-8">Every user-facing change, newest first. When something breaks, the postmortem ships here too.</p>
        <div class="space-y-4">${clItems.map((e) => `<article class="rounded-xl border border-border bg-card p-4"><p class="text-xs text-muted-foreground mb-1">${esc(e.date)} · ${e.tags.map((t) => TAG_LABEL[t] || t).join(" · ")}</p><h2 class="text-sm font-semibold text-foreground mb-1">${esc(e.title)}</h2>${e.desc ? `<p class="text-xs text-muted-foreground">${esc(e.desc)}</p>` : ""}</article>`).join("")}</div>`,
    });

    write({
      path: "/explore",
      // THE PAGE'S TITLE LIVES IN TWO PLACES AND ONLY ONE WAS FIXED.
      //
      // Explore.tsx has its own <SEO title=…> for the client render; this
      // object is what CRAWLERS receive. When the trending and newest
      // collections were deleted, the React copy was corrected and this was
      // not — so the served HTML kept advertising "Trending Companies" and
      // "fastest-growing employers" for sections the page no longer contains,
      // while the live page said something else entirely. Verified after
      // deploy: document.title read the new sentence and the prerendered
      // <title> read the old one.
      //
      // Whatever this says must remain true of what /explore actually renders.
      title: "Explore Employers — Who Fills Roles, Who States Pay, Who Re-posts",
      description: "Pick what you're looking for: employers that actually fill the roles they post, companies that state pay up front, entry-level friendly boards, serial re-posters to avoid, and the highest-paying fields — measured from our own daily tracking.",
      jsonLd: [
        breadcrumbLd([{ name: "Home", path: "/" }, { name: "Explore", path: "/explore" }]),
        {
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Explore employers",
          // Same correction as the title above: "trending boards" names a
          // collection that no longer exists.
          description: "Employer collections computed from the board's own daily tracking: real fill signals, pay transparency, entry-level friendly boards, re-poster flags, and salary-by-field.",
          url: `${SITE}/explore`,
          isPartOf: { "@type": "WebSite", name: "Resume Booster", url: SITE },
        },
      ],
      content: `
        ${breadcrumbNav([{ name: "Home", href: "/" }, { name: "Explore" }])}
        <h1 class="text-3xl font-bold mb-3">Explore the board by measured signal</h1>
        <p class="text-muted-foreground mb-8">Every collection below is computed from our own daily tracking of companies' official job boards — never bought, never guessed. The live lists load when the page opens in a browser.</p>
        <div class="space-y-3 mb-8">
          <div class="rounded-xl border border-border bg-card p-4"><h2 class="text-sm font-semibold text-foreground mb-1">Companies that actually fill roles</h2><p class="text-xs text-muted-foreground">Roles that stayed posted at least a week and then came down — a real fill signal from lifecycle tracking. Serial re-listers are disqualified.</p></div>
          <div class="rounded-xl border border-border bg-card p-4"><h2 class="text-sm font-semibold text-foreground mb-1">Entry-level friendly</h2><p class="text-xs text-muted-foreground">Employers ranked by what share of their open roles are open to people early in their careers — not by raw count.</p></div>
          <div class="rounded-xl border border-border bg-card p-4"><h2 class="text-sm font-semibold text-foreground mb-1">Transparent about pay</h2><p class="text-xs text-muted-foreground">Companies stating pay on at least 80% of their open roles — a badge no one can buy.</p></div>
          <div class="rounded-xl border border-border bg-card p-4"><h2 class="text-sm font-semibold text-foreground mb-1">Serial re-posters</h2><p class="text-xs text-muted-foreground">Companies that take roles down and re-list them again and again, making stale openings look brand-new.</p></div>
          <div class="rounded-xl border border-border bg-card p-4"><h2 class="text-sm font-semibold text-foreground mb-1">Where the pay is</h2><p class="text-xs text-muted-foreground">Fields ranked by median advertised salary floor, from postings that state pay — never converted, never mixed across currencies.</p></div>
        </div>
        <section class="mb-8"><h2 class="text-xl font-bold mb-3">Browse by field</h2>
          <div class="flex flex-wrap gap-2 text-xs">${CATEGORY_LANDERS.map(([slug, l]) => pill(`/jobs/field/${slug}`, `${l} jobs →`)).join("")}</div>
        </section>
        <p class="text-sm text-muted-foreground">See also the <a href="/jobs" class="text-primary">live board</a> and the <a href="/ghost-job-index" class="text-primary">Ghost Job Index</a>.</p>`,
    });
  }

  // ---- /llms-full.txt: complete citable text in one fetch ----
  // Companion to the hand-written public/llms.txt overview. AI engines that
  // find llms.txt can pull this for full guide text and the data-page map
  // without crawling 277 URLs. Generated from the same data modules as the
  // pages, so it can never go stale.
  {
    const lines = [];
    lines.push("# Resume Booster — full text for AI/answer engines");
    lines.push("");
    lines.push(`> Free diagnostic resume scanner (resumebooster.work): ATS score with a point-by-point audit trail, every quoted finding verified against the actual document, per-vendor parsing checks (Workday, Greenhouse, Lever, iCIMS), keyword expectations sourced from the U.S. Department of Labor's O*NET database. ${NIND} industries, 10 languages including native Spanish detection. Free scan, no signup, resumes never stored. See /llms.txt for the short overview.`);
    if (boardFacets?.total) {
      lines.push("");
      lines.push(`> Live job board (/jobs): ${Number(boardFacets.total).toLocaleString("en-US")} postings from ${BOARD_COMPANIES ? BOARD_COMPANIES.toLocaleString("en-US") : "3,000+"} companies' OFFICIAL job-board APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR) — no scraping, no aggregators; the largest boards re-check every 10-15 minutes and the whole catalog re-verifies within a few hours. Per-field pages at /jobs/field/{engineering,healthcare,finance,...}. Free deterministic resume-fit scoring against any posting.`);
    }
    lines.push("");
    lines.push("## Guides (full text)");
    for (const g of Object.values(D.GUIDES)) {
      lines.push("");
      lines.push(`### ${g.h1}`);
      lines.push(`URL: ${SITE}/guides/${g.slug} (updated ${g.updated})`);
      lines.push(`Short answer: ${g.tldr}`);
      for (const s of g.sections) {
        lines.push("");
        lines.push(`#### ${s.h2}`);
        for (const p of s.paras) lines.push(p);
        if (s.bullets) for (const b of s.bullets) lines.push(`- ${b}`);
      }
      if (g.faqs?.length) {
        lines.push("");
        for (const f of g.faqs) lines.push(`Q: ${f.q}\nA: ${f.a}`);
      }
    }
    lines.push("");
    lines.push("## Free tools");
    for (const cfg of Object.values(D.TOOL_LANDINGS)) {
      lines.push(`- ${SITE}${cfg.path} — ${cfg.description}`);
    }
    lines.push("");
    lines.push("## Data pages (from the scanner's live detection tables)");
    lines.push(`- Live ATS score benchmarks: ${SITE}/research/ats-score-benchmarks — real score distributions (median, quartiles, per-industry, per-experience-level) computed from the scan corpus over a rolling 180-day window; k-anonymous aggregates only.`);
    lines.push(`- Industry keyword pages (${NIND}): ${SITE}/industries/{slug} — keywords, recognized titles, certifications, O*NET-sourced skills per industry. Index: ${SITE}/industries`);
    lines.push(`- Role keyword pages (${Object.keys(D.ROLE_PAGES).length}): ${SITE}/roles/{slug} — per-job-title keyword and certification data.`);
    lines.push(`- Spanish industry pages (15): ${SITE}/es/industrias/{slug} — native Spanish keyword data with English ATS terms.`);
    lines.push(`- ATS vendor guides: ${Object.keys(D.VENDORS).map((v) => `${SITE}/ats/${v}`).join(", ")} — documented parsing behaviors.`);
    lines.push(`- CV standards by country: ${SITE}/cv-standards — photo, length, and personal-data norms for ${Object.keys(D.COUNTRY_SLUGS).length} countries (the scanner's own market rules), with localized pages in Spanish, French, German, Portuguese, and Dutch.`);
    lines.push(`- Honest comparisons: ${Object.values(D.COMPETITORS).map((c) => `${SITE}/vs/${c.slug}`).join(", ")} — each names where the competitor wins.`);
    lines.push("");
    if (insights?.overall?.n) {
      const o = insights.overall;
      lines.push("");
      lines.push(`## Live ATS score benchmarks (as of ${insights.as_of}, ${insights.window_days}-day rolling window, n=${o.n} scans)`);
      lines.push(`- Overall: median ${o.median}, 25th percentile ${o.p25}, 75th percentile ${o.p75}${o.pct_80_plus != null ? `; ${o.pct_80_plus}% of resumes score 80+` : ""}${o.pct_under_50 != null ? `; ${o.pct_under_50}% score under 50` : ""}.`);
      for (const ind of (insights.industries || []).slice(0, 8)) {
        lines.push(`- ${ind.industry}: median ${ind.median} (p25 ${ind.p25}, p75 ${ind.p75}, n=${ind.n})`);
      }
      for (const ex of insights.experience || []) {
        lines.push(`- Experience level ${ex.level}: median ${ex.median} (n=${ex.n})`);
      }
      lines.push(`Figures update continuously from real scans; cite with the as-of date. Source page: ${SITE}/research/ats-score-benchmarks`);
      lines.push("");
    }
    lines.push("Citation policy: everything above is publishable product truth — keyword tables are the scanner's real detection data, O*NET data is U.S. public domain, and vendor behaviors are the documented checks the scanner runs. Cite freely with a link.");
    writeFileSync(join(dist, "llms-full.txt"), lines.join("\n"));

    // llms.txt headline counts: rewritten from live data each bake so the
    // hand-written overview can't drift 100k+ behind the board again
    // (audit 2026-07-25: it claimed 450,000+/20,000+ against a live
    // 569k/23k). Patterns are deliberately narrow; on any miss the file
    // ships unchanged.
    try {
      let lt = readFileSync(join(root, "public/llms.txt"), "utf8");
      if (BOARD_TOTAL && BOARD_COMPANIES) {
        lt = lt.replace(/[\d,]+\+ openings from [\d,]+\+ companies/, `${plusClaim(BOARD_TOTAL, 50000)} openings from ${plusClaim(BOARD_COMPANIES, 1000)} companies`);
      }
      lt = lt.replace(/\b\d+ industries, 10 languages\b/, `${NIND} industries, 10 languages`);
      lt = lt.replace(/\b\d+ industry pages\b/, `${NIND} industry pages`);
      writeFileSync(join(root, "public/llms.txt"), lt);
      writeFileSync(join(dist, "llms.txt"), lt);
    } catch { /* llms.txt absent — nothing to refresh */ }
  }

  // ---- sitemap.xml: single source of truth ----
  // Generated from the exact set of routes this script just wrote plus the
  // static-app list, so a new page family can never drift out of the sitemap.
  // Written to BOTH public/ (committed — keeps verify:deploy's local-vs-live
  // sync check meaningful) and dist/ (what ships right now).
  {
    const STATIC_ROUTES = [
      { path: "/", changefreq: "weekly", priority: "1.0" },
      { path: "/pricing", changefreq: "weekly", priority: "0.9" },
      { path: "/freelance-boost", changefreq: "weekly", priority: "0.8" },
      { path: "/builder", changefreq: "monthly", priority: "0.8" },
      { path: "/methodology", changefreq: "monthly", priority: "0.7" },
      { path: "/trust", changefreq: "monthly", priority: "0.6" },
      { path: "/agent", changefreq: "weekly", priority: "0.9" }, // the money page — was fallback-only and sitemap-absent until 2026-08-18
      { path: "/affiliates", changefreq: "monthly", priority: "0.6" },
      // /shortlist deliberately absent: it is an auth wall with no public
      // content and now ships noindex. See its write() above.
      { path: "/jobs", changefreq: "daily", priority: "0.8" },
      { path: "/explore", changefreq: "daily", priority: "0.8" },
      { path: "/changelog", changefreq: "weekly", priority: "0.5" },
    ];
    const seen = new Set(STATIC_ROUTES.map((r) => r.path));
    const entries = [...STATIC_ROUTES];
    for (const wp of writtenPaths) {
      if (seen.has(wp)) continue;
      seen.add(wp);
      const jobsPage = wp.startsWith("/jobs/field/") || wp.startsWith("/jobs/company/");
      entries.push({ path: wp, changefreq: jobsPage ? "daily" : "monthly", priority: "0.7" });
    }
    if (entries.length < 100) throw new Error(`sitemap suspiciously small (${entries.length} URLs) — refusing to overwrite`);
    // Ratchet guard: a transient facets/board fetch failure mid-build silently
    // produced a 375-URL sitemap where 875 stood (500 company pages skipped) —
    // and public/sitemap.xml is committed, so the shrink would have shipped.
    // Never overwrite with >20% fewer URLs than the sitemap already has; a
    // REAL catalog shrink that big should be a deliberate edit, not a flake.
    try {
      const prev = readFileSync(join(root, "public/sitemap.xml"), "utf8");
      const prevCount = (prev.match(/<loc>/g) ?? []).length;
      if (prevCount > 0 && entries.length < prevCount * 0.8) {
        throw new Error(`sitemap would shrink ${prevCount} → ${entries.length} URLs — transient data-fetch failure? refusing to overwrite`);
      }
    } catch (e) {
      if (String(e).includes("refusing to overwrite")) throw e;
      /* no previous sitemap — first build, proceed */
    }
    // lastmod = bake date, honestly: every prerendered page regenerates each
    // build with fresh live counts, so the bake date IS the modification
    // date. The audit found zero lastmod across all 877 URLs — discarding
    // recrawl-priority signal on a board whose selling point is freshness.
    const LASTMOD = new Date().toISOString().slice(0, 10);
    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
      // publicHref, not e.path: a dotted last segment needs the trailing slash
      // or the host 404s it. See the comment on publicHref.
      ...entries.map((e) => `  <url>\n    <loc>${SITE}${publicHref(e.path)}</loc>\n    <lastmod>${LASTMOD}</lastmod>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`),
      `</urlset>`,
    ].join("\n");
    writeFileSync(join(root, "public/sitemap.xml"), xml);
    writeFileSync(join(dist, "sitemap.xml"), xml);
    console.log(`[prerender-seo] sitemap.xml regenerated: ${entries.length} URLs (public/ + dist/)`);
  }

  // Say out loud what the clamp had to cut. Silent truncation is how the
  // homepage shipped a snippet ending "…Upload your CV and an AI…".
  if (truncatedDescriptions.length) {
    console.warn(`[prerender-seo] ${truncatedDescriptions.length} description(s) OVER 160 CHARS and truncated for the SERP snippet — shorten them at the source:`);
    for (const t of truncatedDescriptions) console.warn(`  ${t.path} (${t.len} chars): ${t.text.slice(0, 100)}…`);
  }

  console.log(`[prerender-seo] Wrote ${count} static HTML pages into dist/ (+ homepage fallback + llms-full.txt)`);
} catch (err) {
  // Never block a publish: a failed prerender just means SPA-only pages,
  // which is the pre-existing status quo, not an outage.
  console.error("[prerender-seo] FAILED (build continues, pages stay SPA-only):", err);
}
