// Full-site SEO + regional-integrity audit over dist/ (the crawler-facing truth).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Repo-relative so the audit runs on any checkout/CI, not just one machine.
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const SITE = "https://resumebooster.work";

// collect all prerendered html (the <path>.html layout; skip the /index.html duplicates)
const pages = [];
(function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (f.endsWith(".html") && f !== "index.html") pages.push(p);
  }
})(DIST);
pages.push(join(DIST, "index.html")); // homepage

const issues = { critical: [], warn: [], info: [] };
const titles = new Map();
const hreflangMap = new Map(); // url -> {lang: href}
const allInternalLinks = new Set();
const pathOf = (p) => p.replace(DIST, "").replace(/\.html$/, "").replace(/\/index$/, "") || "/";

const get = (re, html) => (html.match(re) || [])[1] ?? null;

// Every audited path, so a cross-canonical can be told from a broken one: a
// canonical pointing at a page that exists in this same crawl is the
// generator's same-employer consolidation, not a defect.
const allPaths = new Set(pages.map(pathOf));

for (const p of pages) {
  const html = readFileSync(p, "utf8");
  const path = pathOf(p);
  if (!html.includes('name="x-prerendered"')) continue; // SPA shell copies

  // ---- head basics ----
  const title = get(/<title>([^<]*)<\/title>/, html);
  const desc = get(/<meta name="description" content="([^"]*)"/, html);
  const canonical = get(/<link rel="canonical" href="([^"]*)"/, html);
  const h1s = (html.match(/<h1[\s>]/g) || []).length;

  if (!title) issues.critical.push(`${path}: missing <title>`);
  else {
    if (title.length > 68) issues.warn.push(`${path}: title ${title.length} chars (truncates in SERP): "${title.slice(0, 60)}…"`);
    if (titles.has(title)) issues.critical.push(`${path}: DUPLICATE title with ${titles.get(title)}: "${title.slice(0, 60)}"`);
    else titles.set(title, path);
  }
  const noindex = /name="robots"[^>]*noindex/.test(html);
  if (!desc) issues.critical.push(`${path}: missing meta description`);
  // A noindex page's description reaches no SERP — /shortlist is an auth wall
  // with a one-line description BY DESIGN, and warning about it every audit
  // teaches the same deafness as any repeated false alarm.
  else if (desc.length < 50 && !noindex) issues.warn.push(`${path}: thin description (${desc.length} chars)`);
  else if (desc.length > 170) issues.warn.push(`${path}: long description (${desc.length} chars)`);
  if (path !== "/" && !canonical) issues.critical.push(`${path}: missing canonical`);
  // TWO SHAPES OF CROSS-CANONICAL ARE THE GENERATOR'S OWN DESIGN, not defects
  // (this check flagged 32 of them as critical on 2026-08-28 and buried the
  // real findings):
  //  * dotted (host-shaped) paths canonicalize to the trailing-slash form,
  //    because the slashless form deterministically 404s on the host
  //    (measured 25/25 — see publicHref in prerender-seo.mjs);
  //  * a smaller board of the same employer names the largest as canonical
  //    (consolidation), and such pages are excluded from the sitemap.
  // A canonical pointing at a page that EXISTS in this crawl is consolidation;
  // anything else is still critical.
  const selfForms = new Set([`${SITE}${path}`, /\.[^/]*$/.test(path) ? `${SITE}${path}/` : null].filter(Boolean));
  if (canonical && !selfForms.has(canonical)) {
    const target = canonical.replace(SITE, "").replace(/\/$/, "");
    if (allPaths.has(target)) issues.info.push(`${path}: canonicalized to ${target} (same-employer consolidation)`);
    else issues.critical.push(`${path}: canonical mismatch → ${canonical}`);
  }
  if (h1s === 0) issues.warn.push(`${path}: no <h1>`);
  if (h1s > 1) issues.warn.push(`${path}: ${h1s} <h1> tags`);

  // ---- social/OG ----
  if (!/property="og:title"/.test(html)) issues.warn.push(`${path}: no og:title`);

  // ---- JSON-LD validity ----
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch { issues.critical.push(`${path}: INVALID JSON-LD`); }
  }

  // ---- hreflang collection ----
  const cluster = {};
  for (const m of html.matchAll(/<link rel="alternate" hreflang="([^"]+)" href="([^"]+)"/g)) cluster[m[1]] = m[2];
  if (Object.keys(cluster).length) hreflangMap.set(path, cluster);

  // ---- regional integrity ----
  const isLocalized = /^\/(es|de|fr|pt|nl)\//.test(path);
  if (isLocalized) {
    if (/O\*NET|Department of Labor|Departamento de Trabajo/.test(html) && !path.includes("revisar-curriculum"))
      issues.critical.push(`${path}: US DoL content on regional page`);
    const langAttr = get(/<div class="min-h-screen bg-background" lang="([a-z]+)"/, html);
    const expected = path.split("/")[1];
    if (langAttr && langAttr !== expected) issues.critical.push(`${path}: lang="${langAttr}" but path locale is ${expected}`);
  }

  // ---- internal links (for orphan analysis) ----
  for (const m of html.matchAll(/href="(\/[a-z0-9\-_/]*)"/gi)) allInternalLinks.add(m[1].replace(/\/$/, "") || "/");
}

// ---- hreflang reciprocity + self-reference ----
for (const [path, cluster] of hreflangMap) {
  const self = Object.values(cluster).some((href) => href === `${SITE}${path}`);
  if (!self) issues.critical.push(`${path}: hreflang cluster lacks self-reference`);
  if (!cluster["x-default"]) issues.warn.push(`${path}: no x-default`);
  for (const [lang, href] of Object.entries(cluster)) {
    if (lang === "x-default") continue;
    const target = href.replace(SITE, "");
    const targetCluster = hreflangMap.get(target);
    if (!targetCluster) { issues.critical.push(`${path}: hreflang→${target} but that page has no cluster`); continue; }
    if (targetCluster[lang] !== href) issues.critical.push(`${path}: non-reciprocal hreflang with ${target} (${lang})`);
  }
}

// ---- orphans: sitemap URLs never linked from any page ----
const sitemap = readFileSync(join(DIST, "sitemap.xml"), "utf8");
const smUrls = [...sitemap.matchAll(/<loc>https:\/\/resumebooster\.work(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
const orphans = smUrls.filter((u) => u !== "/" && !allInternalLinks.has(u));
if (orphans.length) issues.warn.push(`ORPHANS (in sitemap, linked from no page): ${orphans.length} — ${orphans.slice(0, 12).join(", ")}${orphans.length > 12 ? "…" : ""}`);

// ---- report ----
console.log(`audited ${hreflangMap.size ? "" : ""}${pages.length} files, ${titles.size} unique titles, ${hreflangMap.size} pages with hreflang, ${smUrls.length} sitemap URLs\n`);
console.log(`CRITICAL (${issues.critical.length}):`);
for (const i of issues.critical.slice(0, 2000)) console.log("  ✗", i);
console.log(`\nWARN (${issues.warn.length}):`);
for (const i of issues.warn.slice(0, 2000)) console.log("  ⚠", i);
console.log(`\nINFO (${issues.info.length}) — working as designed, listed for the record:`);
for (const i of issues.info.slice(0, 50)) console.log("  ·", i);
if (issues.info.length > 50) console.log(`  … ${issues.info.length - 50} more`);
