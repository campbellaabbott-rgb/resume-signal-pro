# shellcheck shell=bash
# ── 98zzzz. THE SEO AUDIT OF 2026-11-18, THE BAKE LANE (built 2026-11-21 on
# seo/1121-bake), judged on the documents a crawler is served. A FRONTEND +
# PRERENDER deploy: no migration and no edge function. Sourced by
# scripts/verify-deploy.sh; $SITE and $UA are in scope.
#
# THE CLAIMS (the audit's verify lines, by their numbers):
#   B2  (STRUCTURED-B18) on up to 40 sitemap posting pages, every job type a
#       JobPosting states has its label in the page's visible text.
#   B4  (STRUCTURED-B2) no sitemap posting page serves a validThrough later
#       than the end date its line in scripts/seo-seed/employer-stated.txt
#       states. INFO when the file states none.
#   B5  (CONTENT-N2) /hiring-trends and /pay-transparency link a field lander
#       from their field tables, /entry-level-index too, /jobs/company/dominos
#       links one, and a sampled posting page with a field links its lander.
#   B6  (CONTENT-N1) across every /industries page in the sitemap, each is
#       linked by at least 4 and at most 16 of its siblings' Related nav.
#   B7  (CONTENT-N8) /industries/technology links /jobs/field/engineering,
#       /es/industrias/healthcare links /jobs/field/healthcare,
#       /jobs/field/data_ai links /industries/machine_learning, and
#       /roles/registered-nurse links /jobs/field/healthcare.
#   B8  (CRAWL18B-4) /posting-pages.json carries a row for each live page, the
#       sitemap's posting set, each with a title, a company and a field key.
#   B9  (CONTENT-N4) /fr/normes-cv/france carries "Entreprises qui recrutent"
#       and not "Companies hiring", and its skip link is French.
#   B10 (STRUCTURED-B10) on every sitemap guide, the Article dateModified day
#       is the day the page prints after "Updated".
#   B11 (STRUCTURED-B12) the four data pages and /companies carry a
#       BreadcrumbList from Home to themselves and a visible trail.
#   B12 (GEO-6) the How to cite lines on /ghost-job-index, /pay-transparency
#       and /research/ats-score-benchmarks, and llms-full.txt, name CC BY 4.0.
#   B13 (GEO-4, GEO-9, GEO-8) every Ghost Job Index section llms.txt names has
#       its heading on the served page; the llms companies line's employer
#       count is the one /companies prints; the benchmarks description holds
#       a figure.
#   B16 (CONTENT-N6) /industries/healthcare's description does not say
#       "patient, patients" and /industries/beauty's not "clients beauty".
#   B17 (OPP-1) /jobs/company/openai is indexable, in the sitemap and in
#       /landers.json.
#   B18 (OPP-2) /jobs/field/healthcare names "registered nurse" in its main
#       text. INFO when the page prints its Roles section and no baked
#       posting is titled so.
#   B19 (GEO-11) no ranked row on /entry-level-index or /pay-transparency is
#       named with a system code (an underscore in the printed name).
# Not here: B1 is section 98zzz's R4b; B3 and B15 are held by the bake's own
# tests (the classifier and the retirement rule); B14 is the bake's own WARN;
# B20 is a property of section 76, held by its test.
#
# Read-only: GETs of the site's sitemap, /posting-pages.json, /landers.json,
# the llms files and the pages named above, and a read of the committed
# employer-stated.txt and the bake module in this checkout. Nothing is sent or
# written.
echo "== 98zzzz. the SEO audit of 2026-11-18, the bake lane: job types printed, stated end dates, field lander links, industry siblings, keyword and lander links, the manifest's rows, translated shells, guide dates, data page trails, the licence, the llms promises, keyword descriptions, demand employers, lander roles, system-code rows =="

SITE="$SITE" UA="$UA" VD98ZZZZ_STATED="${VD98ZZZZ_STATED:-scripts/seo-seed/employer-stated.txt}" node --input-type=module -e '
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const SITE = process.env.SITE, UA = process.env.UA || "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const out = (lvl, id, msg) => console.log(`${lvl.padEnd(5)} ${id} ${msg}`);
const get = async (p) => { try { const r = await fetch(p.startsWith("http") ? p : SITE + p, { headers: { "user-agent": UA } }); return { status: r.status, text: await r.text() }; } catch (e) { return { status: 0, text: "" }; } };
const html = async (p) => (await get(p)).text;
const strip = (h) => String(h).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#39;/g, "\x27").replace(/&quot;/g, "\"").replace(/\s+/g, " ");
const body = (h) => { const i = String(h).indexOf("<body"); return i < 0 ? String(h) : String(h).slice(i); };
const hrefs = (h) => [...String(h).matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/\/$/, "") || "/");
const ld = (h) => [...String(h).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => { try { const j = JSON.parse(m[1]); return Array.isArray(j) ? j : [j]; } catch { return []; } });
const metaDesc = (h) => (/<meta name="description" content="([^"]*)"/.exec(h) || [])[1] ?? "";
const robots = (h) => (/<meta name="robots" content="([^"]*)"/.exec(h) || [])[1] ?? "";
const sitemapXml = await html("/sitemap.xml");
const locs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim().replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/");
const postingLocs = locs.filter((p) => p.startsWith("/jobs/posting/"));
if (!locs.length) out("FAIL", "98zzzz", "the sitemap could not be read; every line below would judge nothing");

// B2: the job type the markup states is printed.
{
  const LABEL = { FULL_TIME: "Full-time", PART_TIME: "Part-time", CONTRACTOR: "Contract", TEMPORARY: "Temp", INTERN: "Internship", VOLUNTEER: "Volunteer", PER_DIEM: "Per diem" };
  let typed = 0; const missing = [];
  for (const p of postingLocs.slice(0, 40)) {
    const h = await html(p);
    const jp = ld(h).find((b) => b && b["@type"] === "JobPosting");
    const types = jp ? (Array.isArray(jp.employmentType) ? jp.employmentType : jp.employmentType ? [jp.employmentType] : []) : [];
    if (!types.length) continue;
    typed++;
    const line = (/Job type: ([^.]*)\./.exec(strip(body(h))) || [])[1] ?? "";
    for (const t of types) if (LABEL[t] && !line.split(", ").includes(LABEL[t])) missing.push(`${p} (${t})`);
  }
  if (!typed) out("INFO", "B2", `none of the ${Math.min(40, postingLocs.length)} sampled posting pages states a job type`);
  else out(missing.length ? "FAIL" : "PASS", "B2", missing.length ? `${missing.length} job type(s) marked up and not printed: ${missing.slice(0, 6).join(", ")}` : `every job type on ${typed} marked-up posting page(s) is printed as "Job type: ..."`);
}

// B4: no validThrough later than the end date the daily check read.
{
  let text = "";
  try { text = readFileSync(process.env.VD98ZZZZ_STATED, "utf8"); } catch { text = ""; }
  let list = new Map();
  try { list = (await import(pathToFileURL(process.cwd() + "/scripts/employer-statements.mjs").href)).employerStatedList(text, Date.now()); } catch { list = null; }
  const stated = list ? [...list].map(([path, e]) => ({ path: path.replace(/\/$/, ""), end: e?.stated?.employerValidThrough ?? null })).filter((x) => x.end && postingLocs.includes(x.path)) : [];
  if (list === null) out("FAIL", "B4", "scripts/employer-statements.mjs could not be read from this checkout");
  else if (!stated.length) out("INFO", "B4", `employer-stated.txt states no end date for a sitemap posting page (${list.size} current line(s))`);
  else {
    const late = [];
    for (const { path, end } of stated) {
      const jp = ld(await html(path)).find((b) => b && b["@type"] === "JobPosting");
      const vt = jp && typeof jp.validThrough === "string" ? jp.validThrough.slice(0, 10) : null;
      if (vt && vt > end) late.push(`${path} validThrough ${vt} > stated ${end}`);
    }
    out(late.length ? "FAIL" : "PASS", "B4", late.length ? late.slice(0, 6).join("; ") : `${stated.length} page(s) with a stated end date serve no later validThrough`);
  }
}

// B5: the field landers are linked from the data pages, a company page and a posting page.
{
  const fieldLinks = (h) => hrefs(body(h)).filter((x) => /^\/jobs\/field\/[a-z_]+$/.test(x)).length;
  const bad = [];
  for (const p of ["/hiring-trends", "/pay-transparency", "/entry-level-index", "/jobs/company/dominos"]) {
    const h = await html(p);
    if (!h) { bad.push(`${p} unread`); continue; }
    if (!fieldLinks(h)) bad.push(`${p} links no field lander`);
  }
  let postingOk = null;
  for (const p of postingLocs.slice(0, 15)) { const h = await html(p); if (/>More [^<]+ jobs<\/a>/.test(h)) { postingOk = fieldLinks(h) > 0 ? p : null; break; } }
  if (postingOk === null && postingLocs.length) bad.push("none of 15 sampled posting pages links its field lander (\"More <field> jobs\")");
  out(bad.length ? "FAIL" : "PASS", "B5", bad.length ? bad.join("; ") : `the three data pages, /jobs/company/dominos and ${postingOk ?? "(no posting page sampled)"} link field landers`);
}

// B6: every industry page is linked by 4 to 16 siblings.
{
  const inds = locs.filter((p) => /^\/industries\/[^/]+$/.test(p));
  const incoming = new Map(inds.map((p) => [p, 0]));
  for (const p of inds) {
    const nav = (/<nav class="mt-8 flex flex-wrap gap-2 text-xs">([\s\S]*?)<\/nav>/.exec(await html(p)) || [])[1] ?? "";
    for (const x of new Set(hrefs(nav))) if (incoming.has(x) && x !== p) incoming.set(x, incoming.get(x) + 1);
  }
  const off = [...incoming].filter(([, n]) => n < 4 || n > 16);
  if (!inds.length) out("FAIL", "B6", "the sitemap lists no /industries page");
  else out(off.length ? "FAIL" : "PASS", "B6", off.length ? `${off.length} of ${inds.length} industry pages linked by fewer than 4 or more than 16 siblings: ${off.slice(0, 8).map(([p, n]) => `${p} ${n}`).join(", ")}` : `each of ${inds.length} industry pages is linked by 4 to 16 siblings`);
}

// B7: keyword pages and landers link each other.
{
  const want = [["/industries/technology", "/jobs/field/engineering"], ["/es/industrias/healthcare", "/jobs/field/healthcare"], ["/jobs/field/data_ai", "/industries/machine_learning"], ["/roles/registered-nurse", "/jobs/field/healthcare"]];
  const miss = [];
  for (const [p, to] of want) if (!hrefs(body(await html(p))).includes(to)) miss.push(`${p} -> ${to}`);
  out(miss.length ? "FAIL" : "PASS", "B7", miss.length ? `missing: ${miss.join(", ")}` : "all four links are served");
}

// B8: the manifest names each live posting page.
{
  let m = null; try { m = JSON.parse((await get("/posting-pages.json")).text); } catch { m = null; }
  const rows = Array.isArray(m?.rows) ? m.rows : null;
  if (!rows) out("FAIL", "B8", "/posting-pages.json carries no rows");
  else {
    const paths = rows.map((r) => String(r?.path ?? "").replace(/\/$/, ""));
    const same = paths.length === postingLocs.length && paths.every((p, i) => p === postingLocs[i]);
    const thin = rows.filter((r) => !(typeof r.title === "string" && r.title && typeof r.company === "string" && r.company && "field" in r));
    out(same && !thin.length ? "PASS" : "FAIL", "B8", `${rows.length} row(s) against ${postingLocs.length} sitemap posting page(s)${same ? ", the same set in order" : ", NOT the sitemap set"}; ${thin.length} without a title, a company or a field key`);
  }
}

// B9: a translated page has its shell in its own language.
{
  const h = await html("/fr/normes-cv/france");
  const fr = h.includes("Entreprises qui recrutent"), en = h.includes("Companies hiring"), skip = /<a href="#main-content"[^>]* lang="fr">[^<]+<\/a>/.test(h);
  out(fr && !en && skip ? "PASS" : "FAIL", "B9", `/fr/normes-cv/france: "Entreprises qui recrutent" ${fr ? "present" : "ABSENT"}, "Companies hiring" ${en ? "PRESENT" : "absent"}, skip link ${skip ? "French" : "NOT French"}`);
}

// B10: a guide dates its markup the day it prints.
{
  const guides = locs.filter((p) => /^\/guides\/[^/]+$/.test(p));
  const off = [];
  for (const p of guides) {
    const h = await html(p);
    const printed = (/Updated (\d{4}-\d{2}-\d{2})/.exec(strip(body(h))) || [])[1] ?? null;
    const art = ld(h).find((b) => b && (b["@type"] === "Article" || b["@type"] === "BlogPosting" || b["@type"] === "TechArticle"));
    const mod = art && typeof art.dateModified === "string" ? art.dateModified.slice(0, 10) : null;
    if (!printed || !mod || printed !== mod) off.push(`${p} printed ${printed ?? "none"}, markup ${mod ?? "none"}`);
  }
  if (!guides.length) out("FAIL", "B10", "the sitemap lists no guide");
  else out(off.length ? "FAIL" : "PASS", "B10", off.length ? off.slice(0, 6).join("; ") : `${guides.length} guide(s): dateModified is the printed Updated day`);
}

// B11: the data pages and /companies show the trail they mark up.
{
  const bad = [];
  for (const p of ["/ghost-job-index", "/entry-level-index", "/hiring-trends", "/pay-transparency", "/companies"]) {
    const h = await html(p);
    const bc = ld(h).find((b) => b && b["@type"] === "BreadcrumbList");
    const items = Array.isArray(bc?.itemListElement) ? bc.itemListElement.map((x) => String(x?.item ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/") : [];
    const nav = /<nav[^>]*>\s*<a href="\/"[^>]*>Home<\/a>/.test(body(h));
    if (items[0] !== "/" || items[items.length - 1] !== p || !nav) bad.push(`${p} (markup ${items.join(" > ") || "none"}, trail ${nav ? "shown" : "NOT shown"})`);
  }
  out(bad.length ? "FAIL" : "PASS", "B11", bad.length ? bad.join("; ") : "the four data pages and /companies mark up and show Home > page");
}

// B12: the cite lines name the licence.
{
  const bad = [];
  for (const p of ["/ghost-job-index", "/pay-transparency", "/research/ats-score-benchmarks"]) {
    const cite = (/<strong>How to cite:<\/strong>([\s\S]*?)<\/p>/.exec(await html(p)) || [])[1] ?? "";
    if (!cite.includes("CC BY 4.0")) bad.push(`${p} ${cite ? "cites without CC BY 4.0" : "prints no How to cite line"}`);
  }
  if (!(await html("/llms-full.txt")).includes("CC BY 4.0")) bad.push("llms-full.txt names no CC BY 4.0");
  out(bad.length ? "FAIL" : "PASS", "B12", bad.length ? bad.join("; ") : "three cite lines and llms-full.txt name CC BY 4.0");
}

// B13: the llms files promise only what the pages serve.
{
  const bad = [];
  const llms = await html("/llms.txt");
  let sections = [];
  try { sections = (await import(pathToFileURL(process.cwd() + "/scripts/prerender-seo.mjs").href)).GHOST_LLMS_SECTIONS ?? []; } catch { sections = []; }
  const ghost = await html("/ghost-job-index");
  const ghostLine = (llms.split("\n").find((l) => l.includes("/ghost-job-index")) ?? "");
  if (!sections.length) bad.push("the checkout names no Ghost Job Index sections");
  for (const s of sections) if (ghostLine.includes(s.clause) && !ghost.includes(`>${s.h2}</h2>`)) bad.push(`llms.txt promises "${s.clause}" and /ghost-job-index prints no "${s.h2}" heading`);
  const llmsN = (/\b([\d,]+) employers?\b/.exec(llms.split("\n").find((l) => /\/companies\b/.test(l)) ?? "") || [])[1] ?? null;
  const companiesText = strip(body(await html("/companies")));
  if (llmsN && !companiesText.includes(llmsN)) bad.push(`llms.txt counts ${llmsN} employers, /companies does not print that number`);
  if (!llmsN) bad.push("llms.txt has no companies line with an employer count");
  const bench = metaDesc(await html("/research/ats-score-benchmarks"));
  if (!/\d/.test(bench)) bad.push(`the benchmarks description holds no figure ("${bench.slice(0, 80)}")`);
  out(bad.length ? "FAIL" : "PASS", "B13", bad.length ? bad.join("; ") : `the Ghost line names only served sections, the employer count (${llmsN}) is the one /companies prints, the benchmarks description leads with a figure`);
}

// B16: keyword descriptions name each keyword once.
{
  const hc = metaDesc(await html("/industries/healthcare")), be = metaDesc(await html("/industries/beauty"));
  const bad = [];
  if (!hc || /patient, patients/i.test(hc)) bad.push(`/industries/healthcare: "${hc.slice(0, 90)}"`);
  if (!be || /clients beauty/i.test(be)) bad.push(`/industries/beauty: "${be.slice(0, 90)}"`);
  out(bad.length ? "FAIL" : "PASS", "B16", bad.length ? bad.join("; ") : "neither description repeats a keyword or leads with a narrowing token");
}

// B17: a demand employer has an indexable page.
{
  const h = await html("/jobs/company/openai");
  let landers = null; try { landers = JSON.parse((await get("/landers.json")).text); } catch { landers = null; }
  const inLanders = JSON.stringify(landers ?? "").includes("/jobs/company/openai\"") || JSON.stringify(landers ?? "").includes("\"openai\"");
  const ok = /index, follow/.test(robots(h)) && locs.includes("/jobs/company/openai") && inLanders;
  out(ok ? "PASS" : "FAIL", "B17", `/jobs/company/openai robots "${robots(h) || "none"}", ${locs.includes("/jobs/company/openai") ? "in" : "NOT in"} the sitemap, ${inLanders ? "in" : "NOT in"} /landers.json`);
}

// B18: the healthcare lander names a role.
{
  const h = await html("/jobs/field/healthcare");
  const main = strip((/<main[\s\S]*?<\/main>/.exec(h) || [""])[0]).toLowerCase();
  if (main.includes("registered nurse")) out("PASS", "B18", "/jobs/field/healthcare names registered nurse");
  else if (/<h2>Roles in this field<\/h2>/.test(h)) out("INFO", "B18", "/jobs/field/healthcare prints its Roles section, and no baked posting is titled registered nurse this bake");
  else out("FAIL", "B18", "/jobs/field/healthcare names no registered nurse and prints no Roles in this field section");
}

// B19: no ranked row under a system code.
{
  const bad = [];
  for (const p of ["/entry-level-index", "/pay-transparency"]) {
    const rows = [...(await html(p)).matchAll(/<tr>\s*<td[^>]*>\s*<a href="[^"]*"[^>]*>([^<]+)<\/a>/g)].map((m) => m[1]);
    for (const n of rows) if (/_/.test(n)) bad.push(`${p} ranks "${n}"`);
  }
  out(bad.length ? "FAIL" : "PASS", "B19", bad.length ? bad.slice(0, 6).join("; ") : "no ranked row on /entry-level-index or /pay-transparency prints a system code");
}
'
