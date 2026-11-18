# shellcheck shell=bash
# ── 98zzz. THE SEO AUDIT OF 2026-11-18, LANE A: THE BAKE (phase A1), judged
# on the served documents. A FRONTEND + PRERENDER deploy: no migration and no
# edge function. Sourced by scripts/verify-deploy.sh; $SITE and $UA are in
# scope. Phase A2 (R3, R6, R8-R12) adds its claims to this file.
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
#
# Read-only: GETs of the site's sitemap, /posting-pages.json,
# /prerender-ledger.json and the sitemap's posting pages, and a read of the
# committed list in this checkout. Nothing is sent or written.
echo "== 98zzz. the SEO audit of 2026-11-18, the bake: the live posting pages manifest, carried end dates, the closed-at-employer list, job titles, places, one job one page, lastmod against datePosted =="

SITE="$SITE" UA="$UA" VD98ZZZ_LIST="${VD98ZZZ_LIST:-scripts/seo-seed/closed-at-employer.txt}" node --input-type=module -e '
import { readFileSync } from "node:fs";
const { SITE, UA, VD98ZZZ_LIST } = process.env;
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
' || echo "FAIL  98zzz the section threw"
