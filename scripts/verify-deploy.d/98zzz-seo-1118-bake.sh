# shellcheck shell=bash
# ── 98zzz. THE SEO AUDIT OF 2026-11-18, LANE A: THE BAKE (phases A1 and A2),
# judged on the served documents. A FRONTEND + PRERENDER deploy: no migration
# and no edge function. Sourced by scripts/verify-deploy.sh; $SITE and $UA are
# in scope.
#
# THE CLAIMS:
#   R1 (CRAWL-M1) /posting-pages.json is served, names the day it was baked,
#      and its live set is the sitemap's posting locs, in the sitemap's order.
#   R2 (STRUCTURED-M1) no sitemap posting page serves a JobPosting whose
#      validThrough is a later day than the employer end date its ledger
#      entry carries (/prerender-ledger.json postings[path].stated
#      .employerValidThrough). INFO when no live entry carries one.
#   R4 (CRAWL-M2) no path on scripts/seo-seed/closed-at-employer.txt dated in
#      the last 14 days is in the sitemap, and each such path the site serves
#      is noindex with no JobPosting. INFO when the list names none.
#   R4b (STRUCTURED-B1, 2026-11-19) every page the newest completed
#      posting-closure run names closed at its employer (gh run list, then
#      gh run view --log) is out of the sitemap, and the site serves it
#      noindex with no JobPosting, or not at all. R4 judges only the committed
#      list, so a list nobody filled passed it while that run named 7 live
#      pages; R4b reads the run itself. INFO only when the run measured a day
#      and named no page; a run gh cannot read, or one that printed no
#      measured day, FAILs.
#   R5 (STRUCTURED-3, -5, -7, CONTENT-9) every JobPosting a sitemap posting
#      page serves: its title carries no store code in brackets, no pay
#      figure and no open application or talent pool; its addressLocality is
#      never "Client"; its description carries no line of 80 characters or
#      more exactly twice (a line carried three times or more is a list
#      repeating itself); and no two of them are one job: the same employer,
#      place and title, or the same employer name (a corporate suffix
#      dropped) and place, titles a typo apart inside one long word, and
#      descriptions 0.95 or more the same six-word runs. Whether the
#      description is HTML (STRUCTURED-M3) is printed as INFO: not built in
#      this phase.
#   R7 (CRAWL-9) no sitemap posting lastmod is an earlier day than the
#      datePosted its page serves (its JobPosting, or with none its own
#      "Posted <day>, as stated by the employer" line).
#   R3 (CONTENT-2, CONTENT-M2) /roles/rn names /roles/registered-nurse as its
#      canonical; the sitemap lists 166 /roles pages and none of the eight
#      short names that defer to a full name; no sampled role page says
#      recruiters search anything.
#   R6 (CONTENT-1) the served /explore names every role in this checkout's
#      src/data/field-roles.ts under its own field's link.
#   R8 (CONTENT-3) /cv-standards/{kuwait,qatar,bahrain,oman} each name
#      /cv-standards/saudi-arabia as canonical and are out of the sitemap,
#      which lists the Saudi page.
#   R9 (CONTENT-6) /vs/chatgpt says "are" of ChatGPT & Claude and names two
#      owners; /changelog's description is at most 160 characters and ends
#      at a word of the newest entry's title (or with no "Latest" clause).
#   R10 (CONTENT-7) when the re-check the Ghost Job Index prints is older
#      than 36 hours at bake time (the page says so, or the audit's day is
#      three or more days before /posting-pages.json's bake day), neither
#      /ghost-job-index nor /data-api says "daily" except as "scheduled
#      daily". INFO when the run was fresh at bake time.
#   R11 (CONTENT-4, OFFSITE-9) the served llms.txt's first form sentence
#      ("When the employer uses ...") names the same form vendors as
#      /agents' (the ChatGPT sentence is section 92's line, pinned to its
#      two vendors, and is not compared here); and
#      llms-full.txt carries each data page's figures, the line equal to the
#      description that page serves (INFO when no data page serves one).
#   R12 (PERFORMANCE-M2) no sampled guide, /roles, /industries, CV-standards
#      or translated page preconnects to the Supabase host (each keeps its
#      dns-prefetch); /jobs, which calls it, is printed as the control.
#
# Read-only: GETs of the site's sitemap, /posting-pages.json,
# /prerender-ledger.json, the sitemap's posting pages and the pages named
# above, reads of the committed list and field-roles file in this checkout,
# and two GitHub reads for R4b (gh run list and gh run view --log of the
# posting-closure workflow). Nothing is sent or written.
echo "== 98zzz. the SEO audit of 2026-11-18, the bake: the live posting pages manifest, carried end dates, the closed-at-employer list and the newest closure run, job titles, places, one job one page, lastmod against datePosted; role canonicals, /explore roles, GCC CV pages, /vs grammar and the changelog snippet, the re-check cadence, llms vendors and figures, preconnects =="

SITE="$SITE" UA="$UA" VD98ZZZ_LIST="${VD98ZZZ_LIST:-scripts/seo-seed/closed-at-employer.txt}" VD98ZZZ_FIELD_ROLES="${VD98ZZZ_FIELD_ROLES:-src/data/field-roles.ts}" node --input-type=module -e '
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const { SITE, UA, VD98ZZZ_LIST, VD98ZZZ_FIELD_ROLES } = process.env;
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
const get = async (path, ms = 30000) => {
  try {
    const r = await fetch(path.startsWith("http") ? path : SITE + path, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(ms) });
    return { status: r.status, body: await r.text() };
  } catch (e) { return { status: 0, body: "" }; }
};
const jobBlocks = (h) => [...String(h).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)]
  .map((m) => { try { return JSON.parse(m[1].replace(/\\u003c/g, "<")); } catch { return {}; } })
  .filter((d) => d && d["@type"] === "JobPosting");
const TODAY = new Date().toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

const sitemapRes = await get("/sitemap.xml");
const sitemap = sitemapRes.body;
const urls = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({
  path: ((/<loc>([^<]+)<\/loc>/.exec(m[1]) ?? [])[1] ?? "").trim().replace(/^https?:\/\/[^/]+/, ""),
  lastmod: ((/<lastmod>([^<]+)<\/lastmod>/.exec(m[1]) ?? [])[1] ?? "").trim(),
}));
const postingUrls = urls.filter((u) => u.path.startsWith("/jobs/posting/"));
const paths = postingUrls.map((u) => u.path);
let ledger = {};
try { ledger = JSON.parse((await get("/prerender-ledger.json")).body).postings ?? {}; } catch { ledger = {}; }

// R1: the manifest is the sitemap.
{
  const r = await get("/posting-pages.json");
  let m = null;
  try { m = JSON.parse(r.body); } catch { m = null; }
  if (sitemapRes.status !== 200) out("FAIL", `R1 /sitemap.xml answered HTTP ${sitemapRes.status}`);
  else if (r.status !== 200 || !m || !Array.isArray(m.live)) out("FAIL", `R1 /posting-pages.json is not served as a manifest (HTTP ${r.status})`);
  else {
    const extra = m.live.filter((p) => !paths.includes(p));
    const missing = paths.filter((p) => !m.live.includes(p));
    const sameOrder = !extra.length && !missing.length && m.live.every((p, i) => p === paths[i]);
    const dated = /^\d{4}-\d{2}-\d{2}$/.test(String(m.at ?? ""));
    if (!dated) out("FAIL", `R1 /posting-pages.json names no bake day (at: ${JSON.stringify(m.at ?? null)})`);
    else if (extra.length || missing.length || !sameOrder) out("FAIL", `R1 /posting-pages.json of ${m.at} is not the sitemap: ${extra.length} live there and not in the sitemap, ${missing.length} in the sitemap and not there${extra.length + missing.length ? `; e.g. ${[...extra, ...missing].slice(0, 3).join(", ")}` : "; the order differs"}`);
    else out("PASS", `R1 /posting-pages.json of ${m.at} names the sitemap\u0027s ${paths.length} posting pages, in its order`);
  }
}

// One walk of the sitemap posting pages, for R2, R5 and R7.
const pages = [];
for (let i = 0; i < postingUrls.length; i += 8) {
  await Promise.all(postingUrls.slice(i, i + 8).map(async (u) => {
    const r = await get(u.path);
    const posted = (/Posted (\d{4}-\d{2}-\d{2}), as stated by the employer/.exec(r.body) ?? [])[1] ?? null;
    pages.push({ ...u, status: r.status, blocks: jobBlocks(r.body), posted });
  }));
}
pages.sort((a, b) => paths.indexOf(a.path) - paths.indexOf(b.path));
const marked = pages.flatMap((p) => p.blocks.map((b) => ({ path: p.path, b })));

// R2: validThrough never past the carried employer end.
{
  const carried = pages.map((p) => [p, ledger[p.path]?.stated?.employerValidThrough]).filter(([, end]) => typeof end === "string" && /^\d{4}-\d{2}-\d{2}/.test(end));
  const late = [];
  for (const [p, end] of carried) {
    for (const b of p.blocks) {
      const vt = String(b.validThrough ?? "").slice(0, 10);
      if (vt && vt > end.slice(0, 10)) late.push(`${p.path} validThrough ${vt}, employer end ${end.slice(0, 10)}`);
    }
  }
  if (!paths.length) out("FAIL", "R2 the sitemap names no posting page");
  else if (!carried.length) out("INFO", "R2 no live ledger entry carries an employer end date (nothing to judge)");
  else out(late.length ? "FAIL" : "PASS", `R2 ${carried.length - new Set(late.map((l) => l.split(" ")[0])).size} of ${carried.length} live pages with a carried employer end date serve no later validThrough${late.length ? `; e.g. ${late.slice(0, 3).join("; ")}` : ""}`);
}

// R4: the committed closed-at-employer list.
{
  let text = "";
  try { text = readFileSync(VD98ZZZ_LIST, "utf8"); } catch { text = null; }
  if (text === null) out("FAIL", `R4 ${VD98ZZZ_LIST} is not in this checkout`);
  else {
    const listed = [];
    for (const raw of text.split("\n")) {
      const line = raw.replace(/#.*$/, "").trim();
      const m = /^(\/jobs\/posting\/\S+)\s+(\d{4}-\d{2}-\d{2})\b/.exec(line);
      if (!m) continue;
      const age = daysBetween(m[2], TODAY);
      if (age >= 0 && age <= 14) listed.push(m[1].replace(/\/+$/, ""));
    }
    if (!listed.length) out("INFO", "R4 the closed-at-employer list names no page dated in the last 14 days (nothing to judge)");
    else {
      const bad = [];
      for (const p of listed) {
        if (paths.includes(p)) { bad.push(`${p} is in the sitemap`); continue; }
        const r = await get(p);
        if (r.status !== 200) continue;
        const robots = (/<meta name="robots" content="([^"]+)"/.exec(r.body) ?? [])[1] ?? "";
        if (!/noindex/.test(robots)) bad.push(`${p} serves no noindex`);
        if (jobBlocks(r.body).length) bad.push(`${p} serves a JobPosting`);
      }
      out(bad.length ? "FAIL" : "PASS", `R4 ${listed.length} page(s) the daily check found closed at the employer: ${bad.length ? bad.slice(0, 3).join("; ") : "none in the sitemap, none served with a JobPosting or without noindex"}`);
    }
  }
}

// R4b: the pages the newest posting-closure run found closed (STRUCTURED-B1).
// R4 reads the committed list, so an empty list passed it while run
// 44431382185 named 7 live pages closed. This reads the run itself, through
// the two gh reads the header names and nothing else.
{
  const gh = (args) => {
    try { return execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 60000, maxBuffer: 64 * 1024 * 1024 }); } catch { return null; }
  };
  let runs = null;
  try { runs = JSON.parse(gh(["run", "list", "--workflow", "posting-closure.yml", "--limit", "5", "--json", "databaseId,createdAt,status,conclusion"]) ?? ""); } catch { runs = null; }
  const run = Array.isArray(runs) ? runs.find((r) => r && r.status === "completed" && r.databaseId) ?? null : null;
  const log = run ? gh(["run", "view", String(run.databaseId), "--log"]) : null;
  const name = run ? `run ${run.databaseId} (${String(run.createdAt ?? "").slice(0, 16).replace("T", " ")}Z, ${run.conclusion || "no conclusion"})` : "";
  if (!Array.isArray(runs)) out("FAIL", "R4b gh run list answered nothing (gh is not installed, not signed in, or GitHub did not answer), so the pages the daily check found closed are not judged");
  else if (!run) out("FAIL", `R4b gh lists no completed posting-closure run (${runs.length} listed), so the pages the daily check found closed are not judged`);
  else if (!log) out("FAIL", `R4b gh run view ${run.databaseId} --log answered nothing, so the pages the daily check found closed are not judged`);
  else {
    const day = (/posting closure: (\d{4}-\d{2}-\d{2}) checked \d+:/.exec(log) ?? [])[1] ?? null;
    const closed = [...new Set([...log.matchAll(/posting closure:\s+closed at the employer: (\/jobs\/posting\/\S+)/g)].map((m) => m[1].replace(/\/+$/, "")))];
    if (!day) out("FAIL", `R4b the newest posting-closure ${name} printed no measured day, so it judged no page`);
    else if (!closed.length) out("INFO", `R4b the newest posting-closure ${name} measured ${day} and named no page closed at its employer (nothing to judge)`);
    else {
      const bad = [];
      for (const p of closed) {
        const why = [];
        if (paths.includes(p)) why.push("is in the sitemap");
        const r = await get(p);
        if (r.status === 200) {
          const robots = (/<meta name="robots" content="([^"]+)"/.exec(r.body) ?? [])[1] ?? "";
          if (!/noindex/.test(robots)) why.push("serves no noindex");
          if (jobBlocks(r.body).length) why.push("serves a JobPosting");
        } else if (r.status !== 404 && r.status !== 410) why.push(`answered HTTP ${r.status}`);
        if (why.length) bad.push(`${p} ${why.join(", ")}`);
      }
      out(bad.length ? "FAIL" : "PASS", `R4b the newest posting-closure ${name} measured ${day} and named ${closed.length} page(s) closed at the employer: ${bad.length ? `${bad.length} still served as open; ${bad.slice(0, 3).join("; ")}` : "none in the sitemap, none served with a JobPosting or without noindex"}`);
    }
    if (day && daysBetween(day, TODAY) > 2) out("INFO", `R4b the newest run measured ${day}, ${daysBetween(day, TODAY)} days before today: the daily check may have stopped running`);
  }
}

// R5: what each JobPosting says.
{
  const OPEN = /\b(?:spontaneous|unsolicited|speculative|open|general)\s+application\b|\bcandidatura\s+(?:spontanea|espont[aá]nea|spont[aâ]nea)\b|\bcandidature\s+spontan[ée]e\b|\bsolicitud\s+espont[aá]nea\b|\b(?:initiativ|spontan|blind)bewerbung\b|\bopen\s+sollicitatie\b|\btalent\s+(?:pool|community)\b/i;
  const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const fold = (s) => norm(s).replace(/[\u2018\u2019\u02bc]/g, "\u0027").replace(/[\u201c\u201d]/g, "\"");
  const SUFFIX = /\s+(?:inc|incorporated|llc|l\.l\.c|ltd|limited|plc|gmbh|ag|se|sa|s\.a|sas|sarl|bv|b\.v|nv|n\.v|ab|a\/s|oy|spa|s\.p\.a|srl|co|company|corp|corporation|group|holdings?|software|technologies|technology|systems|solutions)\.?$/i;
  const core = (n) => { let s = norm(n).replace(/,/g, " ").replace(/\s+/g, " ").trim(); for (let i = 0; i < 3 && SUFFIX.test(s); i++) s = s.replace(SUFFIX, "").trim(); return s; };
  const edits = (a, b) => {
    const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) { let prev = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
    return d[b.length];
  };
  const typoApart = (a, b) => {
    if (a === b) return true;
    if (Math.abs(a.length - b.length) > 2 || edits(a, b) > 2) return false;
    const wa = a.split(" "), wb = b.split(" ");
    return wa.length === wb.length && wa.every((w, i) => w === wb[i] || (!/\d/.test(w + wb[i]) && Math.min(w.length, wb[i].length) >= 5));
  };
  const textOf = (d) => String(d ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>\s*<p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const shingles = (d) => { const w = textOf(d).toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []; const s = new Set(); if (w.length < 6) s.add(w.join(" ")); for (let i = 0; i + 6 <= w.length; i++) s.add(w.slice(i, i + 6).join(" ")); return s; };
  const jaccard = (x, y) => { let both = 0; for (const s of x) if (y.has(s)) both++; const either = x.size + y.size - both; return either ? both / either : 0; };
  const bad = [];
  const rows = [];
  for (const { path, b } of marked) {
    const title = String(b.title ?? "");
    if (/\((?!(?:19|20)\d{2}\))\d{4,5}\)/.test(title)) bad.push(`${path} title carries a store code: "${title}"`);
    if (/[$£€]\s?\d/.test(title)) bad.push(`${path} title carries pay: "${title}"`);
    if (OPEN.test(title)) bad.push(`${path} is an open application: "${title}"`);
    const loc = b.jobLocation?.address?.addressLocality;
    if (typeof loc === "string" && /^client$/i.test(loc.trim())) bad.push(`${path} addressLocality "${loc}"`);
    const times = new Map();
    for (const line of textOf(b.description).split("\n")) { const k = fold(line); if (k.length >= 80 && /\p{L}/u.test(k)) times.set(k, (times.get(k) ?? 0) + 1); }
    const twice = [...times].filter(([, n]) => n === 2);
    if (twice.length) bad.push(`${path} description repeats ${twice.length} paragraph(s), e.g. "${twice[0][0].slice(0, 60)}"`);
    const a = b.jobLocation?.address ?? {};
    rows.push({ path, org: core(b.hiringOrganization?.name), exactOrg: norm(b.hiringOrganization?.name), title: norm(title), place: `${norm(a.addressLocality)}|${norm(a.addressRegion)}|${norm(a.addressCountry ?? b.applicantLocationRequirements?.name)}`, desc: b.description });
  }
  const dupes = [];
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const x = rows[i], y = rows[j];
      if (x.place !== y.place) continue;
      if (x.exactOrg === y.exactOrg && x.title === y.title) { dupes.push(`${x.path} and ${y.path} (same employer, title and place)`); continue; }
      if (x.org.length >= 2 && x.org === y.org && typoApart(x.title, y.title)) {
        x.sh ??= shingles(x.desc); y.sh ??= shingles(y.desc);
        const s = jaccard(x.sh, y.sh);
        if (s >= 0.95) dupes.push(`${x.path} and ${y.path} (one job: descriptions ${s.toFixed(2)} the same)`);
      }
    }
  }
  for (const d of dupes) bad.push(d);
  if (!marked.length) out(paths.length ? "INFO" : "FAIL", `R5 ${paths.length ? "no sitemap posting page serves a JobPosting (nothing to judge)" : "the sitemap names no posting page"}`);
  else out(bad.length ? "FAIL" : "PASS", `R5 ${marked.length} JobPostings: ${bad.length ? `${bad.length} problem(s); e.g. ${bad.slice(0, 3).join("; ")}` : "no store code, pay or open application in a title, no locality \"Client\", no paragraph printed twice, and no two of them one job"}`);
  const html = marked.filter(({ b }) => /<p>/.test(String(b.description ?? ""))).length;
  out("INFO", `R5 ${html} of ${marked.length} JobPosting descriptions are HTML paragraphs (STRUCTURED-M3 is not built in this phase)`);
}

// R7: lastmod never before the posting date.
{
  const early = [];
  let judged = 0;
  for (const p of pages) {
    const posted = String(p.blocks[0]?.datePosted ?? p.posted ?? "").slice(0, 10);
    const lm = p.lastmod.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(posted) || !/^\d{4}-\d{2}-\d{2}$/.test(lm)) continue;
    judged++;
    if (lm < posted) early.push(`${p.path} lastmod ${lm}, datePosted ${posted}`);
  }
  if (!judged) out("FAIL", `R7 ${paths.length ? "no sitemap posting page has both a lastmod and a posting date to compare" : "the sitemap names no posting page"}`);
  else out(early.length ? "FAIL" : "PASS", `R7 ${judged - early.length} of ${judged} sitemap posting pages carry a lastmod no earlier than their datePosted${early.length ? `; e.g. ${early.slice(0, 3).join("; ")}` : ""}`);
}

// ---- Phase A2 ----
const decode = (s) => String(s ?? "").replace(/&quot;/g, "\"").replace(/&#39;/g, "\u0027").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const canonicalPath = (h) => ((/<link rel="canonical" href="([^"]+)"/.exec(String(h)) ?? [])[1] ?? "").replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "") || null;
const metaDesc = (h) => decode((/<meta name="description" content="([^"]*)"/.exec(String(h)) ?? [])[1] ?? "");
const textOfPage = (h) => decode(String(h).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ");
const inSitemap = new Set(urls.map((u) => u.path.replace(/\/+$/, "")));

// R3: a short role name defers to the full name; the role pages claim no recruiter searches.
{
  const SHORT = ["admin-assistant", "e-commerce-manager", "hr-manager", "lab-technician", "ml-engineer", "project-manager-construction", "rn", "vet-tech"];
  const rn = await get("/roles/rn");
  const rnCanon = canonicalPath(rn.body);
  const roleLocs = [...inSitemap].filter((p) => p.startsWith("/roles/"));
  const listedShort = SHORT.filter((s) => inSitemap.has(`/roles/${s}`));
  const sample = ["/roles/rn", "/roles/registered-nurse", ...roleLocs.slice(0, 3)];
  const claiming = [];
  for (const p of sample) { const r = p === "/roles/rn" ? rn : await get(p); if (r.status === 200 && /recruiters?\s+search/i.test(textOfPage(r.body))) claiming.push(p); }
  const problems = [];
  if (rn.status !== 200) problems.push(`/roles/rn answered HTTP ${rn.status}`);
  else if (rnCanon !== "/roles/registered-nurse") problems.push(`/roles/rn names ${rnCanon ?? "no canonical"}, not /roles/registered-nurse`);
  if (roleLocs.length !== 166) problems.push(`the sitemap lists ${roleLocs.length} /roles pages, not 166`);
  if (listedShort.length) problems.push(`the sitemap lists ${listedShort.length} short name(s) that defer: ${listedShort.slice(0, 3).join(", ")}`);
  if (claiming.length) problems.push(`${claiming.join(", ")} say recruiters search`);
  out(problems.length ? "FAIL" : "PASS", `R3 ${problems.length ? problems.join("; ") : `/roles/rn names /roles/registered-nurse; the sitemap lists 166 /roles pages and none of the ${SHORT.length} short names; ${sample.length} sampled role pages say nothing of recruiter searches`}`);
}

// R6: /explore names the field roles, each under its own field.
{
  let src = null;
  try { src = readFileSync(VD98ZZZ_FIELD_ROLES, "utf8"); } catch { src = null; }
  const fields = src ? [...src.matchAll(/^\s*([a-z_]+):\s*\[([^\]]*)\]/gm)].map((m) => [m[1], [...m[2].matchAll(/"([^"]+)"/g)].map((x) => x[1])]) : [];
  const ex = await get("/explore");
  const section = (/<section[^>]*data-field-roles=""[^>]*>([\s\S]*?)<\/section>/.exec(ex.body) ?? [])[1] ?? "";
  const served = new Map([...section.matchAll(/<a href="\/jobs\/field\/([a-z_]+)">[^<]*<\/a><\/h3><ul[^>]*>([\s\S]*?)<\/ul>/g)].map((m) => [m[1], [...m[2].matchAll(/<li>([^<]*)<\/li>/g)].map((x) => decode(x[1]))]));
  const total = fields.reduce((n, [, names]) => n + names.length, 0);
  const missing = fields.flatMap(([f, names]) => names.filter((n) => !(served.get(f) ?? []).includes(n)).map((n) => `${f}: ${n}`));
  if (!fields.length) out("FAIL", `R6 ${VD98ZZZ_FIELD_ROLES} names no field roles in this checkout`);
  else if (ex.status !== 200) out("FAIL", `R6 /explore answered HTTP ${ex.status}`);
  else if (!section) out("FAIL", `R6 /explore serves no field-roles section: 0 of the ${total} role names in ${VD98ZZZ_FIELD_ROLES}`);
  else out(missing.length ? "FAIL" : "PASS", `R6 /explore names ${total - missing.length} of the ${total} role names in ${fields.length} fields${missing.length ? `; missing e.g. ${missing.slice(0, 3).join("; ")}` : ", each under its own field\u0027s link"}`);
}

// R8: the GCC CV pages defer to the Saudi page.
{
  const SAUDI = "/cv-standards/saudi-arabia";
  const problems = [];
  for (const slug of ["kuwait", "qatar", "bahrain", "oman"]) {
    const p = `/cv-standards/${slug}`;
    const r = await get(p);
    if (r.status !== 200) { problems.push(`${p} answered HTTP ${r.status}`); continue; }
    const c = canonicalPath(r.body);
    if (c !== SAUDI) problems.push(`${p} names ${c ?? "no canonical"}`);
    if (inSitemap.has(p)) problems.push(`${p} is in the sitemap`);
  }
  if (!inSitemap.has(SAUDI)) problems.push(`the sitemap does not list ${SAUDI}`);
  out(problems.length ? "FAIL" : "PASS", `R8 ${problems.length ? problems.join("; ") : `Kuwait, Qatar, Bahrain and Oman name ${SAUDI} as canonical and are out of the sitemap, which lists it`}`);
}

// R9: two products named as two; the changelog snippet ends where a word ends.
{
  const vs = await get("/vs/chatgpt");
  const t = textOfPage(vs.body) + " " + metaDesc(vs.body);
  const singular = /ChatGPT & Claude (?:is|uses)\b|Where is ChatGPT & Claude\b|ChatGPT & Claude\u0027s public product changes/.exec(t);
  const problems = [];
  if (vs.status !== 200) problems.push(`/vs/chatgpt answered HTTP ${vs.status}`);
  else {
    if (singular) problems.push(`/vs/chatgpt says "${singular[0]}"`);
    if (!/ChatGPT & Claude are trademarks of their owners/.test(t)) problems.push("/vs/chatgpt does not name two owners");
  }
  const cl = await get("/changelog");
  const d = metaDesc(cl.body);
  const newest = decode(((/<h2[^>]*>([^<]+)<\/h2>/.exec(cl.body) ?? [])[1] ?? "").trim());
  const m = /Latest \(\d{4}-\d{2}-\d{2}\): (.*)$/.exec(d);
  if (cl.status !== 200) problems.push(`/changelog answered HTTP ${cl.status}`);
  else if (d.length > 160) problems.push(`/changelog\u0027s description is ${d.length} characters`);
  else if (m && m[1].endsWith("…")) {
    const said = m[1].slice(0, -1);
    if (!newest.startsWith(said) || !/\s/.test(newest.charAt(said.length))) problems.push(`/changelog\u0027s description ends mid-word: "…${said.slice(-24)}…" (newest entry "${newest.slice(0, 60)}")`);
    else if (said.length < 30) problems.push(`/changelog\u0027s description keeps a Latest clause of ${said.length} characters`);
  } else if (m && newest && m[1].replace(/\.$/, "") !== newest.replace(/[.!?…]+$/, "")) problems.push(`/changelog\u0027s description names "${m[1].slice(0, 40)}", not the newest entry`);
  out(problems.length ? "FAIL" : "PASS", `R9 ${problems.length ? problems.join("; ") : `/vs/chatgpt says "are" and names two owners; /changelog\u0027s description (${d.length} characters) ends ${m ? (m[1].endsWith("…") ? "where a word of the newest title ends" : "with the newest title whole") : "with no Latest clause"}`}`);
}

// R10: a stale re-check is not called daily.
{
  const g = await get("/ghost-job-index");
  const a = await get("/data-api");
  let bakeDay = null;
  try { bakeDay = JSON.parse((await get("/posting-pages.json")).body).at ?? null; } catch { bakeDay = null; }
  const gt = textOfPage(g.body);
  const auditDay = (/(?:latest run on record is from |latest re-check on record, |daily re-check on |sampled on )(\d{4}-\d{2}-\d{2})/.exec(gt) ?? [])[1] ?? null;
  const saysStale = /older than this page\u0027s build/.test(gt);
  const daysOld = bakeDay && auditDay ? daysBetween(auditDay, bakeDay) : null;
  const stale = saysStale || (daysOld !== null && daysOld >= 3);
  const daily = (h) => [...String(h).matchAll(/(.{0,40})\bdaily\b(.{0,30})/gi)].filter((x) => !/scheduled\s*$/i.test(x[1])).map((x) => x[0].replace(/\s+/g, " ").trim());
  const said = [...daily(g.body).map((x) => `/ghost-job-index: "${x}"`), ...daily(a.body).map((x) => `/data-api: "${x}"`)];
  if (g.status !== 200 || a.status !== 200) out("FAIL", `R10 /ghost-job-index answered HTTP ${g.status}, /data-api ${a.status}`);
  else if (!auditDay) out(said.length ? "FAIL" : "PASS", `R10 the Ghost Job Index prints no re-check run${said.length ? `, and the pages still say "daily" ${said.length} time(s): ${said.slice(0, 2).join("; ")}` : "; neither page says \"daily\" except as \"scheduled daily\""}`);
  else if (!stale) out("INFO", `R10 the re-check of ${auditDay} was fresh at bake time (${bakeDay ?? "bake day unread"}): "daily" stands (${said.length} time(s))`);
  else out(said.length ? "FAIL" : "PASS", `R10 the re-check of ${auditDay} was over 36 hours old at bake time (${saysStale ? "the page says so" : `bake day ${bakeDay}`}): ${said.length ? `"daily" is said ${said.length} time(s): ${said.slice(0, 2).join("; ")}` : "neither page says \"daily\" except as \"scheduled daily\""}`);
}

// R11: llms.txt names /agents\u0027 form vendors; llms-full carries the data pages\u0027 figures.
{
  const names = (list) => String(list ?? "").split(/,\s*(?:or\s+)?|\s+or\s+/).map((x) => x.trim()).filter(Boolean).sort();
  const lt = await get("/llms.txt");
  const ag = await get("/agents");
  const onLlms = (/When the employer uses ([^.;]*?), your AI can read the employer\u0027s published application form/.exec(lt.body) ?? [])[1];
  const onAgents = (/When the employer uses ([^.;<]*?), it returns the employer\u0027s real application form/.exec(decode(ag.body)) ?? [])[1];
  if (lt.status !== 200 || ag.status !== 200) out("FAIL", `R11 /llms.txt answered HTTP ${lt.status}, /agents ${ag.status}`);
  else if (!onLlms || !onAgents) out("FAIL", `R11 ${!onLlms ? "llms.txt" : "/agents"} carries no form-vendor sentence`);
  else {
    const x = names(onLlms), y = names(onAgents);
    const same = x.length === y.length && x.every((v, i) => v === y[i]);
    out(same ? "PASS" : "FAIL", `R11 llms.txt names ${x.length} form vendors, /agents ${y.length}${same ? ", the same ones" : `: llms.txt lacks ${y.filter((v) => !x.includes(v)).join(", ") || "none"}, /agents lacks ${x.filter((v) => !y.includes(v)).join(", ") || "none"}`}`);
  }
  const full = await get("/llms-full.txt");
  const pages = [["Ghost Job Index", "/ghost-job-index"], ["Weekly Hiring Trends", "/hiring-trends"], ["Entry-Level Index", "/entry-level-index"], ["Pay Transparency Index", "/pay-transparency"]];
  const judged = [];
  const wrong = [];
  for (const [name, p] of pages) {
    const r = await get(p);
    const desc = metaDesc(r.body);
    if (r.status !== 200 || !/\d/.test(desc)) continue;
    judged.push(name);
    const line = String(full.body).split("\n").find((l) => l.startsWith(`- ${name} (`));
    if (!line) wrong.push(`${name}: no line`);
    else if (!line.endsWith(`: ${desc}`)) wrong.push(`${name}: "${line.slice(0, 80)}" against "${desc.slice(0, 60)}"`);
    else if (!/measured \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/.test(line)) wrong.push(`${name}: undated`);
  }
  if (full.status !== 200) out("FAIL", `R11 /llms-full.txt answered HTTP ${full.status}`);
  else if (!judged.length) out("INFO", "R11 no data page serves a figure in its description (nothing for llms-full to carry)");
  else out(wrong.length ? "FAIL" : "PASS", `R11 llms-full carries ${judged.length - wrong.length} of ${judged.length} data pages\u0027 figures, each its page\u0027s description, dated${wrong.length ? `; ${wrong.slice(0, 3).join("; ")}` : ""}`);
}

// R12: no preconnect where nothing calls Supabase.
{
  const PRE = /<link rel="preconnect" href="https:\/\/[a-z0-9]+\.supabase\.co"[^>]*>/;
  const PREFETCH = /<link rel="dns-prefetch" href="https:\/\/[a-z0-9]+\.supabase\.co"[^>]*>/;
  const pick = (re) => [...inSitemap].find((p) => re.test(p));
  const sample = [
    pick(/^\/guides\/[^/]+$/), pick(/^\/roles\/[^/]+$/), pick(/^\/industries\/[^/]+$/), pick(/^\/cv-standards\/[^/]+$/),
    pick(/^\/(?:es|fr|de|pt|nl)\/[^/]+\/[^/]+$/),
  ].filter(Boolean);
  const bad = [];
  let read = 0;
  for (const p of sample) {
    const r = await get(p);
    if (r.status !== 200) { bad.push(`${p} answered HTTP ${r.status}`); continue; }
    read++;
    if (PRE.test(r.body)) bad.push(`${p} preconnects`);
    else if (!PREFETCH.test(r.body)) bad.push(`${p} lost its dns-prefetch too`);
  }
  const jobs = await get("/jobs");
  const control = jobs.status === 200 ? (PRE.test(jobs.body) ? "/jobs keeps its preconnect" : "/jobs carries no preconnect either") : `/jobs answered HTTP ${jobs.status}`;
  if (sample.length < 5) out("FAIL", `R12 the sitemap lists ${sample.length} of the five page kinds to sample (a guide, a role, an industry, a CV-standards and a translated page)`);
  else out(bad.length ? "FAIL" : "PASS", `R12 ${bad.length ? bad.slice(0, 3).join("; ") : `${read} sampled pages (${sample.join(", ")}) carry no Supabase preconnect and keep the dns-prefetch`}`);
  out("INFO", `R12 control: ${control}`);
}
' || echo "FAIL  98zzz the section threw"
