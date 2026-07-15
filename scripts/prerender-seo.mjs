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

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
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
export { GUIDES } from "../src/data/guides";
export { buildIndustryFaqs } from "../src/data/industry-faqs";
export { COUNTRY_STANDARDS } from "../supabase/functions/free-keyword-scan/country-standards";
export { COUNTRY_SLUGS, CV_LOCALES, EN_TEMPLATE, fill, hreflangCluster } from "../src/data/cv-standards-content";
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
      for (let attempt = 0; attempt < 3 && !boardFacets; attempt++) {
        try {
          if (attempt) await new Promise((r) => setTimeout(r, 1500));
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

  const template = readFileSync(join(dist, "index.html"), "utf8");
  if (!template.includes('<div id="root"></div>')) {
    throw new Error('dist/index.html does not contain <div id="root"></div> — template shape changed');
  }

  // ---- Helpers ----
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const label = (slug) => slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const displayKeyword = (k) => (k.length <= 4 && !k.includes(" ") ? k.toUpperCase() : k);
  const uniq = (a) => [...new Set(a)];

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
      <main class="pt-10 pb-20"><div class="container max-w-3xl">${contentHtml}</div></main>
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
  const renderFile = ({ path, title, description, content, jsonLd = [], hreflang = null, lang = null, isFallback = false }) => {
    // SERP snippets truncate ~160 chars; clamp at a word boundary so no page
    // (current or future) ships an overlong description.
    if (description && description.length > 160) {
      description = description.slice(0, 157).replace(/\s+\S*$/, "") + "…";
    }
    let html = template;
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(title)}</title>`);
    html = html.replace(/(<meta name="description" content=")[^"]*(")/, `$1${esc(description)}$2`);
    html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
    html = html.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
    html = html.replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${esc(title)}$2`);
    html = html.replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${esc(description)}$2`);
    if (lang) html = html.replace(/<html lang="[^"]*"/, `<html lang="${lang}"`);

    let headExtra = `${isFallback ? "" : `<link rel="canonical" href="${SITE}${path}" />\n`}<meta name="x-prerendered" content="1" />\n`;
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
  const write = (page) => { renderFile(page); writtenPaths.push(page.path); count++; };

  // ---- /industries index ----
  {
    const slugs = Object.keys(D.INDUSTRY_KEYWORDS).sort();
    write({
      path: "/industries",
      title: "Resume Keywords by Industry — 59 Fields Covered",
      description: "ATS keywords, recognized job titles, and expected certifications for 59 industries — straight from the detection engine of a real resume scanner. Nursing to software to skilled trades.",
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
          <p class="text-xs text-muted-foreground mb-6">${g.minutes} min read · Updated ${g.updated} · Grounded in the checks our scanner runs on every resume</p>
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
    title: "Resume Booster | Free ATS Resume Scan — Measured, Not Guessed",
    description: "Free resume scan with a reproducible score, benchmarked against real scans in your industry. Every quote verified, per-vendor ATS checks — not another chatbot opinion. No sign-up, resume never stored.",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebApplication",
        name: "Resume Booster",
        url: SITE,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        description: "Free diagnostic resume scan: ATS score with a full audit trail, verified quotes, per-vendor parsing checks, and a fix plan — across 59 industries and 10 languages.",
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", description: "Free resume scan — no signup required" },
      },
    ],
    content: `
      <h1 class="text-3xl font-bold mb-3">Your resume's real score — measured, not guessed</h1>
      <p class="text-muted-foreground mb-6">Same document, same score, every time — benchmarked against real scans in your industry, with every quoted line verified against your actual resume. Not a ChatGPT or Claude opinion: a reproducible reading with a full audit trail, missing keywords, weak bullets rewritten, and per-vendor parsing checks for Workday, Greenhouse, Lever, and iCIMS. No sign-up; your resume is never stored. <a href="/vs/chatgpt" class="text-primary">How this differs from asking a chatbot →</a></p>
      ${cta("Check my resume now — free", "Upload or paste your resume and get the complete diagnostic report. 7 scans a day free, 15 with a free account.", "Check my resume free")}
      <section class="mt-10 mb-8">
        <h2 class="text-xl font-bold mb-3">What the free scan covers</h2>
        <ul class="space-y-1.5">
          <li class="text-sm text-muted-foreground">✓ ATS parse simulation — see the text extraction from your actual file</li>
          <li class="text-sm text-muted-foreground">✓ Score with its modeling band and a point-by-point audit trail</li>
          <li class="text-sm text-muted-foreground">✓ Missing keywords from your job posting, or your occupation's O*NET profile</li>
          <li class="text-sm text-muted-foreground">✓ Weakest bullets identified and rewritten</li>
          <li class="text-sm text-muted-foreground">✓ Industry detection across 58 fields, including Spanish-language resumes</li>
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
          ${pill("/industries", "Keywords for 58 industries →")}
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
    const catCounts = boardFacets?.categoriesFacet ?? {};
    const boardTotal = typeof boardFacets?.total === "number" ? boardFacets.total : null;
    const boardCompanies = Array.isArray(boardFacets?.companiesFacet) ? boardFacets.companiesFacet.length : null;
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
          <p>${countPhrase[0].toUpperCase()}${countPhrase.slice(1)}${boardTotal ? ` — part of ${fmt(boardTotal)} live postings across ${fmt(boardCompanies)} companies` : ""}, pulled directly from the official job boards companies publish on Greenhouse, Lever, Ashby, SmartRecruiters, Workable, and BambooHR. No scraped listings, no aggregators, no reposts: every opening belongs to the company that published it, and applying happens on the company's own site.</p>
          <p>The largest boards are re-checked about every 10–15 minutes and the whole catalog is re-verified within about an hour, so postings a company takes down disappear on the next pass. Counts on this page were measured when it was last built; the live board always shows the current number.</p>
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
        .filter((c) => c && typeof c.token === "string" && /^[A-Za-z0-9._-]+$/.test(c.token)
          && typeof c.count === "number" && c.count >= 8 && typeof c.name === "string" && c.name.trim())
        .sort((a, b) => b.count - a.count)
        .slice(0, 500);
      for (const c of topCompanies) {
        const nm = c.name.trim();
        write({
          path: `/jobs/company/${c.token}`,
          title: `${nm} Jobs — ${fmt(c.count)} Verified Openings`,
          description: `Browse ${fmt(c.count)} open roles at ${nm}, pulled straight from ${nm}'s own job board and re-verified all day — no aggregators, no reposts. Check your resume's fit free, then apply on ${nm}'s own site.`,
          content: `
            <h1>Open roles at ${esc(nm)}</h1>
            <p>${fmt(c.count)} verified ${esc(nm)} openings right now, pulled straight from ${esc(nm)}'s own official job board (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, or BambooHR) and re-verified all day. No aggregators, no reposts, no scraped copies — every role belongs to ${esc(nm)}, and applying happens on ${esc(nm)}'s own site. Counts were measured when this page was last built; the live board always shows the current number.</p>
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
      console.log(`[prerender-seo] company pages: ${topCompanies.length}`);
    }

    // Main board page — the parent of the field landers. Without its own write()
    // it fell back to the homepage (scanner) meta, wasting the single most
    // important jobs URL. Board-specific title/description, live counts when the
    // build can reach the board, honest '3,000+' fallback otherwise.
    {
      const jobsPhrase = boardTotal
        ? `${fmt(boardTotal)} live openings across ${fmt(boardCompanies)} companies`
        : "live openings across 3,000+ companies";
      write({
        path: "/jobs",
        title: boardTotal
          ? `Live Job Board — ${fmt(boardTotal)} Openings Direct From Company Career Pages`
          : "Live Job Board — Openings Direct From Company Career Pages",
        description: `Browse ${jobsPhrase}, pulled from official job boards on Greenhouse, Lever, Ashby, SmartRecruiters, Workable, and BambooHR — no aggregators, nothing older than 30 days. Check your resume's fit against any posting free, then apply on the company's own site.`,
        content: `
          <h1>Live job board</h1>
          <p>${jobsPhrase[0].toUpperCase()}${jobsPhrase.slice(1)}, pulled directly from the official job boards companies publish on Greenhouse, Lever, Ashby, SmartRecruiters, Workable, and BambooHR. No scraped listings, no aggregators, no reposts — every opening belongs to the company that published it, applying happens on the company's own site, and nothing older than 30 days stays on the board.</p>
          <p>Browse by field: ${CATEGORY_LANDERS.map(([s, l]) => `<a href="/jobs/field/${s}">${l} jobs</a>`).join(" · ")}.</p>
          <p>Check any posting against your resume with the <a href="/">free resume scan</a> before you spend an application on it, and save searches with a free account.</p>
        `,
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Live job board",
          description: "Live openings from companies' official job boards (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR), re-verified throughout the day — no aggregators, nothing older than 30 days.",
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
        description: "A live, honest look at job-posting freshness: how many roles are open right now, how long postings stay up, how fast roles actually get filled, and which companies are actively hiring — computed from companies' official job boards and audited daily.",
        content: `
          <h1>The Ghost Job Index</h1>
          <p>Ghost jobs — postings that are stale, already filled, or never real — waste job seekers' time everywhere. This page is our live, honest measure of the opposite: postings that are verified, fresh, and from companies actually hiring.</p>
          <p>Every figure is computed from the full lifecycle of postings on companies' official job boards (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR) — never an aggregator or a scrape. Any role whose posting date passes 30 days is automatically dropped, we log every closure to measure which employers truly fill roles, we sample random listings daily and re-check them against the companies' own systems, and every posting is re-checked live the moment you click Apply.</p>
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
    lines.push("> Free diagnostic resume scanner (resumebooster.work): ATS score with a point-by-point audit trail, every quoted finding verified against the actual document, per-vendor parsing checks (Workday, Greenhouse, Lever, iCIMS), keyword expectations sourced from the U.S. Department of Labor's O*NET database. 58 industries, 10 languages including native Spanish detection. Free scan, no signup, resumes never stored. See /llms.txt for the short overview.");
    if (boardFacets?.total) {
      lines.push("");
      lines.push(`> Live job board (/jobs): ${Number(boardFacets.total).toLocaleString("en-US")} postings from ${Array.isArray(boardFacets.companiesFacet) ? boardFacets.companiesFacet.length : "3,000+"} companies' OFFICIAL job-board APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, BambooHR) — no scraping, no aggregators; the largest boards re-check every 10-15 minutes and the whole catalog re-verifies within about an hour. Per-field pages at /jobs/field/{engineering,healthcare,finance,...}. Free deterministic resume-fit scoring against any posting.`);
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
    lines.push(`- Industry keyword pages (58): ${SITE}/industries/{slug} — keywords, recognized titles, certifications, O*NET-sourced skills per industry. Index: ${SITE}/industries`);
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
      { path: "/affiliates", changefreq: "monthly", priority: "0.6" },
      { path: "/shortlist", changefreq: "monthly", priority: "0.6" },
      { path: "/jobs", changefreq: "daily", priority: "0.8" },
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
    const xml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
      ...entries.map((e) => `  <url>\n    <loc>${SITE}${e.path}</loc>\n    <changefreq>${e.changefreq}</changefreq>\n    <priority>${e.priority}</priority>\n  </url>`),
      `</urlset>`,
    ].join("\n");
    writeFileSync(join(root, "public/sitemap.xml"), xml);
    writeFileSync(join(dist, "sitemap.xml"), xml);
    console.log(`[prerender-seo] sitemap.xml regenerated: ${entries.length} URLs (public/ + dist/)`);
  }

  console.log(`[prerender-seo] Wrote ${count} static HTML pages into dist/ (+ homepage fallback + llms-full.txt)`);
} catch (err) {
  // Never block a publish: a failed prerender just means SPA-only pages,
  // which is the pre-existing status quo, not an outage.
  console.error("[prerender-seo] FAILED (build continues, pages stay SPA-only):", err);
}
