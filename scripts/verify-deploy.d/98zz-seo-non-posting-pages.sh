# shellcheck shell=bash
# ── 98zz. THE SITEMAP'S NON-POSTING PAGES, READ AS A CRAWLER (SEO check
# 2026-11-15, F22). Every other SEO section reads posting pages or a fixed
# handful of named pages; nothing read the ~870 other pages the sitemap
# advertises (company pages, roles, industries, CV standards, the translated
# pages, the data pages, the changelog, the legal pages, /agents). A publish
# that broke one of those templates (a 404, a canonical pointing at the
# homepage, a noindex on an indexed template, a shell with no text, a data
# page that baked without its figures) would have passed every run.
# Sourced by scripts/verify-deploy.sh; $SITE and $UA are in scope.
#
# WHAT IS READ: the live sitemap (and its children, if it is ever an index),
# then a sample of its non-posting pages, with the crawler's UA, one GET at a
# time, no redirect followed:
#   - every page of one path segment (/, /pricing, /changelog, /privacy,
#     /agents, the four data pages, ...), all of them;
#   - six company pages and six role pages, evenly spaced through the
#     sitemap's order and shifted by one each day, so a week of runs reads
#     about forty of each; plus the first company page whose token is a host
#     name (its URL ends in a slash: the S14X-061 shape);
#   - two pages of every other group (/industries, /cv-standards, /es, /fr,
#     /de, /pt, /nl, /jobs/field, /vs, /ats, /guides, /research, ...).
# Then, only when pages were chosen (SEO audit 2026-11-18, CRAWL-8): the
# site's robots.txt, once, and every hreflang alternate the sampled pages
# name on this host that the sample did not already read, once each, at
# most 60.
# Five unanswered requests in a row stop the reading (the site is down); the
# pages not read are reported as unanswered.
#
# THE CLAIMS:
#   N0  the sitemap answers, names URLs on this host only, and carries
#       /changelog, /privacy, /agents and the four data pages, and at least
#       one company page and one role page.
#   N1  every sampled page answers 200 itself (a redirect is a FAIL: a
#       sitemap URL must be the page).
#   N2  every sampled page names exactly one canonical, and it is the page's
#       own URL as the sitemap spells it.
#   N3  no sampled page is noindex, by a robots or googlebot meta tag or an
#       X-Robots-Tag header (the sitemap only lists pages we want indexed).
#   N4  every sampled page has a body: at least 300 characters of text a
#       reader sees, once scripts and tags are taken out.
#   N5  every data page (the four named ones, and any page whose JSON-LD is a
#       Dataset) prints figures: no sentence saying the build could not read
#       the board's measurements, and at least one figure (a number with a
#       thousands separator, a decimal point or a percent sign) once dates
#       and times are taken out.
#   N6  (INFO) the day /ghost-job-index dates its re-check, and its age (over
#       36 hours, the page's "once a day" is not true: SEO check F07).
#   N7  no two sampled pages share a title.
#   N8  (SEO audit 2026-11-18, CRAWL-8: no post-publish check read hreflang)
#       every sampled page in an hreflang cluster names itself and an
#       x-default, gives each language one address, and names no other
#       host; every alternate answers 200 itself, names one canonical, its
#       own URL, says the language its code says in <html lang>, and lists
#       the same set of (hreflang, address) pairs (Google ignores an
#       annotation the other page does not return). A sampled page in
#       another language with no alternates at all is a FAIL; with no page
#       in a cluster and none in another language it is INFO.
#   N9  (CRAWL-6 and CRAWL-4) robots.txt: no group opens with a line that
#       allows the whole site, and every group, named and *, disallows
#       /admin/claims, /auth and /account read both by the longest match
#       (Google, Bing, RFC 9309) and by the first match (simpler readers).
#       A 200 with no User-agent group is a FAIL, and so is one with no *
#       group (a reader no group names may then read every path); a
#       robots.txt that does not answer 200 is INFO here, since no group
#       can be judged (section 63 FAILs a robots.txt that does not
#       disallow /email/unsubscribe).
#   N10 (OFFSITE-2) the homepage's one WebSite node gives the site's own
#       host as an alternateName, the backup Google's site-name rules ask
#       for. Two WebSite nodes, or a block that does not parse and hides
#       it, are a FAIL; a / with no WebSite node is INFO here (98-seo-round
#       G1 FAILs a page without its WebSite).
#
# Read-only: GETs of the site's own pages and its robots.txt. Nothing is
# sent or written; the files it keeps are under /tmp/vd_98zz, removed before
# each run.
echo "== 98zz. the sitemap's non-posting pages, read as a crawler: 200, their own canonical, indexable, a body, data pages with figures =="

rm -rf /tmp/vd_98zz
mkdir -p /tmp/vd_98zz
curl -s -m 60 -A "$UA" -D /tmp/vd_98zz/sitemap.hdr -o /tmp/vd_98zz/sitemap.xml "$SITE/sitemap.xml"
# A sitemap index: read each child sitemap it names (at most twenty).
if /usr/bin/grep -q '<sitemapindex' /tmp/vd_98zz/sitemap.xml 2>/dev/null; then
  VD98ZZ_I=0
  for VD98ZZ_CHILD in $(/usr/bin/grep -oE '<loc>[^<]+</loc>' /tmp/vd_98zz/sitemap.xml | sed -E 's#</?loc>##g' | head -20); do
    VD98ZZ_I=$((VD98ZZ_I + 1))
    curl -s -m 60 -A "$UA" -o "/tmp/vd_98zz/sitemap-$VD98ZZ_I.xml" "$VD98ZZ_CHILD"
  done
fi

SITE="$SITE" VD98ZZ_DIR=/tmp/vd_98zz node - <<'VD98ZZ_PICK'
const fs = require("fs");
const DIR = process.env.VD98ZZ_DIR;
const SITE = String(process.env.SITE || "").replace(/\/+$/, "");
const NAMED = ["/changelog", "/privacy", "/agents", "/ghost-job-index", "/pay-transparency", "/hiring-trends", "/entry-level-index"];
const REQUIRED_GROUPS = ["/jobs/company", "/roles"];
const PER_GROUP = { "/jobs/company": 6, "/roles": 6 };
const OTHER = 2;
const decode = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, "&");
const read = (f) => { try { return fs.readFileSync(`${DIR}/${f}`, "utf8"); } catch { return ""; } };
const hdr = read("sitemap.hdr");
const st = [...hdr.matchAll(/^HTTP\/[\d.]+\s+(\d{3})/gm)].map((m) => Number(m[1])).pop() ?? 0;
const files = fs.readdirSync(DIR).filter((f) => /^sitemap(-\d+)?\.xml$/.test(f));
const xml = files.map(read).join("\n");
const locs = [...xml.matchAll(/<url>\s*<loc>\s*([^<]+?)\s*<\/loc>/g)].map((m) => decode(m[1]));
const foreign = locs.filter((u) => !u.startsWith(SITE + "/") && u !== SITE);
const paths = [...new Set(locs.filter((u) => !foreign.includes(u)).map((u) => u.slice(SITE.length) || "/"))];
const nonPosting = paths.filter((p) => !p.startsWith("/jobs/posting/"));
const groupOf = (p) => {
  const seg = p.split("/").filter(Boolean);
  if (seg.length <= 1) return "/";
  return seg[0] === "jobs" ? `/jobs/${seg[1]}` : `/${seg[0]}`;
};
const groups = new Map();
for (const p of nonPosting) { const g = groupOf(p); if (!groups.has(g)) groups.set(g, []); groups.get(g).push(p); }
const day = Number(process.env.VD98ZZ_DAY ?? Math.floor(Date.now() / 86400000));
const picked = [];
const add = (p) => { if (p && !picked.includes(p)) picked.push(p); };
const sampled = {};
for (const [g, ps] of groups) {
  const k = g === "/" ? ps.length : (PER_GROUP[g] ?? OTHER);
  if (ps.length <= k) ps.forEach(add);
  else {
    const step = ps.length / k;
    const shift = day % Math.max(1, Math.floor(step));
    for (let i = 0; i < k; i++) add(ps[Math.min(ps.length - 1, Math.floor(i * step) + shift)]);
  }
  if (g === "/jobs/company") add(ps.find((p) => /^\/jobs\/company\/[^/]*\.[^/]*\/$/.test(p)));
  sampled[g] = [ps.filter((p) => picked.includes(p)).length, ps.length];
}
fs.writeFileSync(`${DIR}/pick.tsv`, picked.map((p, i) => `${i + 1}\t${p}\n`).join(""));
fs.writeFileSync(`${DIR}/meta.json`, JSON.stringify({
  status: st, bytes: xml.length, locs: locs.length, foreign: foreign.slice(0, 5), foreignCount: foreign.length,
  nonPosting: nonPosting.length, sampled,
  missingNamed: NAMED.filter((p) => !nonPosting.includes(p)),
  missingGroups: REQUIRED_GROUPS.filter((g) => !(groups.get(g) || []).length),
}));
VD98ZZ_PICK

# One GET a page, no redirect followed; stop after five unanswered in a row.
VD98ZZ_DEAD=0
while IFS="$(printf '\t')" read -r VD98ZZ_N VD98ZZ_P; do
  [ -n "$VD98ZZ_P" ] || continue
  [ "$VD98ZZ_DEAD" -ge 5 ] && break
  curl -s -m 30 -A "$UA" -D "/tmp/vd_98zz/h$VD98ZZ_N" -o "/tmp/vd_98zz/b$VD98ZZ_N" "$SITE$VD98ZZ_P"
  if [ -s "/tmp/vd_98zz/h$VD98ZZ_N" ]; then VD98ZZ_DEAD=0; else VD98ZZ_DEAD=$((VD98ZZ_DEAD + 1)); fi
done < /tmp/vd_98zz/pick.tsv

# N8's alternates: every hreflang address on this host that a page read above
# names and the sample did not read, once each, at most 60.
: > /tmp/vd_98zz/alts.tsv
SITE="$SITE" VD98ZZ_DIR=/tmp/vd_98zz node - <<'VD98ZZ_ALTS'
const fs = require("fs");
const DIR = process.env.VD98ZZ_DIR;
const SITE = String(process.env.SITE || "").replace(/\/+$/, "");
const CAP = 60;
const read = (f) => { try { return fs.readFileSync(`${DIR}/${f}`, "utf8"); } catch { return ""; } };
const decode = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;|&#0?39;|&#x27;/gi, "'").replace(/&amp;/g, "&");
const attrs = (tag) => {
  const a = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return a;
};
const rows = read("pick.tsv").split("\n").filter(Boolean).map((l) => l.split("\t"));
const sampled = new Set(rows.map(([, p]) => p));
const want = [];
for (const [n] of rows) {
  if (!read(`h${n}`)) continue;
  const doc = read(`b${n}`);
  const cut = doc.search(/<body[\s>]/i);
  const head = cut >= 0 ? doc.slice(0, cut) : doc;
  for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
    const a = attrs(m[0]);
    if (!/(^|\s)alternate(\s|$)/i.test(a.rel || "") || !("hreflang" in a)) continue;
    const href = decode(a.href || "");
    if (href !== SITE && !href.startsWith(`${SITE}/`)) continue; // another host: N8 judges it, nobody reads it
    const p = href.slice(SITE.length) || "/";
    if (!sampled.has(p) && !want.includes(p)) want.push(p);
  }
}
fs.writeFileSync(`${DIR}/alts.tsv`, want.slice(0, CAP).map((p, i) => `${i + 1}\t${p}\n`).join(""));
fs.writeFileSync(`${DIR}/alts-meta.json`, JSON.stringify({ wanted: want.length, cap: CAP, notRead: want.slice(CAP) }));
VD98ZZ_ALTS

# N9's robots.txt, then N8's alternates: only when pages were chosen, and
# under the same stop after five unanswered requests in a row. A file aa<n>
# marks an alternate that was asked for, so an unanswered one is told apart
# from one the stop left unread.
if [ -s /tmp/vd_98zz/pick.tsv ] && [ "$VD98ZZ_DEAD" -lt 5 ]; then
  curl -s -m 30 -A "$UA" -D /tmp/vd_98zz/robots.h -o /tmp/vd_98zz/robots.txt "$SITE/robots.txt"
  if [ -s /tmp/vd_98zz/robots.h ]; then VD98ZZ_DEAD=0; else VD98ZZ_DEAD=$((VD98ZZ_DEAD + 1)); fi
fi
while IFS="$(printf '\t')" read -r VD98ZZ_N VD98ZZ_P; do
  [ -n "$VD98ZZ_P" ] || continue
  [ "$VD98ZZ_DEAD" -ge 5 ] && break
  : > "/tmp/vd_98zz/aa$VD98ZZ_N"
  curl -s -m 30 -A "$UA" -D "/tmp/vd_98zz/ah$VD98ZZ_N" -o "/tmp/vd_98zz/ab$VD98ZZ_N" "$SITE$VD98ZZ_P"
  if [ -s "/tmp/vd_98zz/ah$VD98ZZ_N" ]; then VD98ZZ_DEAD=0; else VD98ZZ_DEAD=$((VD98ZZ_DEAD + 1)); fi
done < /tmp/vd_98zz/alts.tsv

SITE="$SITE" VD98ZZ_DIR=/tmp/vd_98zz node - <<'VD98ZZ_JUDGE'
const fs = require("fs");
const DIR = process.env.VD98ZZ_DIR;
const SITE = String(process.env.SITE || "").replace(/\/+$/, "");
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
const read = (f) => { try { return fs.readFileSync(`${DIR}/${f}`, "utf8"); } catch { return null; } };
const eg = (xs) => (xs.length ? `; e.g. ${xs.slice(0, 5).join("; ")}` : "");
const DATA_PAGES = ["/ghost-job-index", "/pay-transparency", "/hiring-trends", "/entry-level-index"];
let meta = null;
try { meta = JSON.parse(read("meta.json") ?? ""); } catch { meta = null; }
if (!meta) { out("FAIL", "N0 the sitemap step wrote no record, so no page was chosen to read"); process.exit(0); }

// N0: the sitemap itself.
{
  const groups = Object.entries(meta.sampled).map(([g, [n, of]]) => `${g} ${n} of ${of}`).join(", ");
  if (meta.status !== 200 || !meta.bytes) out("FAIL", `N0 ${SITE}/sitemap.xml answered HTTP ${meta.status} with ${meta.bytes} bytes: no page could be chosen`);
  else if (!meta.locs) out("FAIL", "N0 the sitemap names no URL");
  else {
    const problems = [];
    if (meta.foreignCount) problems.push(`${meta.foreignCount} URL(s) on another host (${meta.foreign.join(", ")})`);
    if (meta.missingNamed.length) problems.push(`it leaves out ${meta.missingNamed.join(", ")}`);
    if (meta.missingGroups.length) problems.push(`it names no ${meta.missingGroups.map((g) => `${g}/ page`).join(" and no ")}`);
    out(problems.length ? "FAIL" : "PASS", `N0 the sitemap names ${meta.locs} URLs, ${meta.nonPosting} of them not posting pages${problems.length ? `, but ${problems.join("; ")}` : ", on this host only, with /changelog, /privacy, /agents, the four data pages, company pages and role pages"}`);
    out("INFO", `N0 read this run: ${groups || "nothing"}`);
  }
}

const rows = (read("pick.tsv") ?? "").split("\n").filter(Boolean).map((l) => l.split("\t"));
const decode = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;|&#0?39;|&#x27;/gi, "'").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&");
const attrs = (tag) => {
  const a = {};
  for (const m of tag.matchAll(/([a-zA-Z:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/g)) a[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? "";
  return a;
};
/** One page as a crawler reads it, from its saved headers and body. */
const parse = (path, h, doc) => {
  const status = [...h.matchAll(/^HTTP\/[\d.]+\s+(\d{3})/gm)].map((m) => Number(m[1])).pop() ?? 0;
  const xRobots = [...h.matchAll(/^x-robots-tag:\s*(.*)$/gim)].map((m) => m[1].trim());
  const cut = doc.search(/<body[\s>]/i);
  const head = cut >= 0 ? doc.slice(0, cut) : doc;
  const body = cut >= 0 ? doc.slice(cut) : doc;
  const canon = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0])).filter((a) => /(^|\s)canonical(\s|$)/i.test(a.rel || "")).map((a) => decode(a.href || ""));
  const robots = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => attrs(m[0])).filter((a) => /^(robots|googlebot)$/i.test(a.name || "")).map((a) => a.content || "");
  const text = decode(body.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
  const ld = [...doc.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n");
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head) || [])[1] || "").replace(/\s+/g, " ").trim();
  // N8: the page's language and its hreflang alternates, each code lower-cased.
  const lang = String(attrs((/<html\b[^>]*>/i.exec(doc) || [""])[0]).lang || "").toLowerCase();
  const hreflang = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]))
    .filter((a) => /(^|\s)alternate(\s|$)/i.test(a.rel || "") && "hreflang" in a)
    .map((a) => ({ code: String(a.hreflang).toLowerCase(), href: decode(a.href || "") }));
  return { path, status, xRobots, canon, robots, text, title, dataset: /"@type"\s*:\s*(?:"Dataset"|\[[^\]]*"Dataset")/.test(ld), lang, hreflang, doc };
};
const pages = rows.map(([n, path]) => parse(path, read(`h${n}`) ?? "", read(`b${n}`) ?? ""));
if (!pages.length) { out("INFO", "N1-N10 no page was chosen, so none was read (N0 says why)"); process.exit(0); }
const n = pages.length;

// N1: 200, itself.
{
  const bad = pages.filter((p) => p.status !== 200).map((p) => `${p.path} (HTTP ${p.status || "no answer"})`);
  out(bad.length ? "FAIL" : "PASS", `N1 ${n - bad.length} of ${n} sampled non-posting sitemap pages answer 200 themselves, no redirect${eg(bad)}`);
}
const answered = pages.filter((p) => p.status === 200);
// N2: one canonical, its own.
{
  const bad = answered.filter((p) => p.canon.length !== 1 || p.canon[0] !== SITE + p.path)
    .map((p) => `${p.path} (${p.canon.length ? `canonical ${p.canon.join(" + ")}` : "no canonical"})`);
  if (!answered.length) out("INFO", "N2 no sampled page answered 200, so no canonical could be read");
  else out(bad.length ? "FAIL" : "PASS", `N2 ${answered.length - bad.length} of ${answered.length} pages that answered name one canonical, their own URL${eg(bad)}`);
}
// N3: none is noindex.
{
  const bad = answered.filter((p) => [...p.robots, ...p.xRobots].some((v) => /noindex|\bnone\b/i.test(v)))
    .map((p) => `${p.path} (${[...p.robots.map((r) => `meta "${r}"`), ...p.xRobots.map((x) => `X-Robots-Tag "${x}"`)].join(", ")})`);
  if (!answered.length) out("INFO", "N3 no sampled page answered 200, so no robots line could be read");
  else out(bad.length ? "FAIL" : "PASS", `N3 ${answered.length - bad.length} of ${answered.length} pages in the sitemap are indexable (no noindex by meta tag or header)${eg(bad)}`);
}
// N4: a body.
{
  const bad = answered.filter((p) => p.text.length < 300).map((p) => `${p.path} (${p.text.length} characters of text)`);
  if (!answered.length) out("INFO", "N4 no sampled page answered 200, so no body could be read");
  else out(bad.length ? "FAIL" : "PASS", `N4 ${answered.length - bad.length} of ${answered.length} pages carry a body of at least 300 characters a reader sees${eg(bad)}`);
}
// N5: data pages print figures.
{
  const data = answered.filter((p) => DATA_PAGES.includes(p.path) || p.dataset);
  const FIGURE = /\d{1,3}(?:,\d{3})+|\d+\.\d+|\d+(?:\.\d+)?\s?%/;
  const UNREAD = /could not read the board(?:'|\u2019)s own measurements/i;
  const bad = [];
  for (const p of data) {
    const rest = p.text.replace(/\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b/g, " ").replace(/\b\d{1,2}:\d{2}\b/g, " ");
    if (UNREAD.test(p.text)) bad.push(`${p.path} (says the build could not read its measurements)`);
    else if (!FIGURE.test(rest)) bad.push(`${p.path} (no figure in its text)`);
  }
  if (!data.length) out("INFO", "N5 no data page was read (N0 and N1 say why)");
  else out(bad.length ? "FAIL" : "PASS", `N5 ${data.length - bad.length} of ${data.length} data pages (${data.map((p) => p.path).join(", ")}) print their figures${eg(bad)}`);
}
// N6 (INFO): the Ghost Job Index's dated re-check, and its age.
{
  const g = answered.find((p) => p.path === "/ghost-job-index");
  const day = g ? (/re-check[^.]*?(\d{4}-\d{2}-\d{2})/i.exec(g.text) || [])[1] : null;
  if (!g) out("INFO", "N6 /ghost-job-index was not read");
  else if (!day) out("INFO", "N6 /ghost-job-index prints no dated re-check");
  else {
    const now = Number(process.env.VD98ZZ_NOW_MS || Date.now());
    const h = Math.round((now - Date.parse(`${day}T12:00:00Z`)) / 3600000);
    out("INFO", `N6 /ghost-job-index dates its re-check ${day}, about ${h} h before this run${h > 36 ? ": over 36 h, so its once-a-day sentence is not true (SEO check F07)" : ""}`);
  }
}
// N7: no two pages share a title.
{
  const by = new Map();
  for (const p of answered) if (p.title) by.set(p.title, [...(by.get(p.title) || []), p.path]);
  const dup = [...by].filter(([, ps]) => ps.length > 1).map(([t, ps]) => `"${t}" on ${ps.join(" and ")}`);
  const untitled = answered.filter((p) => !p.title).map((p) => `${p.path} (no title)`);
  if (!answered.length) out("INFO", "N7 no sampled page answered 200, so no title could be read");
  else out(dup.length || untitled.length ? "FAIL" : "PASS", `N7 ${answered.length} pages that answered carry ${by.size} different titles${eg([...dup, ...untitled])}`);
}
// N8: every hreflang cluster the sample touches is whole (SEO audit 2026-11-18, CRAWL-8).
{
  const altRows = (read("alts.tsv") ?? "").split("\n").filter(Boolean).map((l) => l.split("\t"));
  let altMeta = null;
  try { altMeta = JSON.parse(read("alts-meta.json") ?? ""); } catch { altMeta = null; }
  const byPath = new Map(pages.map((p) => [p.path, p]));
  let altsRead = 0;
  for (const [k, path] of altRows) {
    if (read(`aa${k}`) === null) continue; // never asked for: the stop came first
    byPath.set(path, parse(path, read(`ah${k}`) ?? "", read(`ab${k}`) ?? ""));
    altsRead++;
  }
  const primary = (code) => String(code || "").split("-")[0];
  const onHost = (href) => href === SITE || href.startsWith(`${SITE}/`);
  const pathOf = (href) => href.slice(SITE.length) || "/";
  const pairs = (p) => [...new Set(p.hreflang.map((a) => `${a.code} ${a.href}`))].sort();
  const cluster = answered.filter((p) => p.hreflang.length || (p.lang && primary(p.lang) !== "en"));
  const bad = new Set();
  const unread = new Set();
  for (const p of cluster) {
    if (!p.hreflang.length) { bad.add(`${p.path} (in "${p.lang}" with no hreflang alternates)`); continue; }
    const self = SITE + p.path;
    const codes = new Map();
    for (const a of p.hreflang) codes.set(a.code, [...new Set([...(codes.get(a.code) || []), a.href])]);
    if (!codes.has("x-default")) bad.add(`${p.path} (no x-default)`);
    for (const [c, hs] of codes) if (hs.length > 1) bad.add(`${p.path} (hreflang ${c} names ${hs.length} addresses)`);
    if (!p.hreflang.some((a) => a.href === self)) bad.add(`${p.path} (does not name itself among its alternates)`);
    const mine = pairs(p);
    for (const a of p.hreflang) {
      if (!onHost(a.href)) { bad.add(`${p.path} (names an alternate on another host: ${a.href})`); continue; }
      const q = a.href === self ? p : byPath.get(pathOf(a.href));
      if (!q) { unread.add(pathOf(a.href)); continue; }
      const where = `${q.path} (hreflang ${a.code} of ${p.path})`;
      if (q.status !== 200) { bad.add(`${where} answered HTTP ${q.status || "no answer"}`); continue; }
      if (q.canon.length !== 1 || q.canon[0] !== a.href) bad.add(`${where} names ${q.canon.length ? `canonical ${q.canon.join(" + ")}` : "no canonical"}`);
      if (a.code !== "x-default" && primary(q.lang) !== primary(a.code)) bad.add(`${where} says <html lang="${q.lang}">`);
      if (q !== p) {
        const theirs = pairs(q);
        const missing = mine.filter((x) => !theirs.includes(x));
        const extra = theirs.filter((x) => !mine.includes(x));
        if (missing.length || extra.length) bad.add(`${where} does not return the same alternates${missing.length ? `, lacks ${missing.join(", ")}` : ""}${extra.length ? `, adds ${extra.join(", ")}` : ""}`);
      }
    }
  }
  // One broken page shows up from every page of its cluster, so ten examples, not five.
  const eg10 = (xs) => (xs.length ? `; e.g. ${xs.slice(0, 10).join("; ")}` : "");
  if (!cluster.length) out("INFO", "N8 no sampled page carries hreflang alternates or is in another language, so no cluster was judged");
  else out(bad.size ? "FAIL" : "PASS", `N8 ${cluster.length} sampled page(s) in hreflang clusters, ${altsRead} alternate(s) read beside them${bad.size ? `: ${bad.size} problem(s)${eg10([...bad])}` : ": each names itself and an x-default, and every alternate answers 200 with its own canonical, the language its code says and the same set of alternates"}`);
  if (unread.size) out("INFO", `N8 ${unread.size} alternate(s) not read (the read stops at ${altMeta?.cap ?? 60}, or the site stopped answering), so not judged${eg([...unread])}`);
}
// N9: robots.txt read the two ways readers read it (SEO audit 2026-11-18, CRAWL-6 and CRAWL-4).
{
  /** RFC 9309 groups: consecutive User-agent lines share the rules after them; comments are not rules. */
  const groupsOf = (txt) => {
    const groups = [];
    let agentRun = false;
    for (const raw of String(txt).split("\n")) {
      const m = /^\s*([A-Za-z-]+)\s*:\s*(.*?)\s*$/.exec(raw.replace(/#.*$/, ""));
      if (!m) continue;
      const key = m[1].toLowerCase();
      if (key === "user-agent") {
        if (!agentRun) groups.push({ agents: [], rules: [] });
        groups[groups.length - 1].agents.push(m[2]);
        agentRun = true;
      } else {
        agentRun = false;
        if ((key === "allow" || key === "disallow") && groups.length && m[2]) groups[groups.length - 1].rules.push({ allow: key === "allow", path: m[2] });
      }
    }
    return groups;
  };
  const matches = (rule, path) => {
    const end = rule.endsWith("$");
    const body = (end ? rule.slice(0, -1) : rule).split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
    return new RegExp(`^${body}${end ? "$" : ""}`).test(path);
  };
  const longest = (rules, path) => {
    let best = null;
    for (const r of rules) if (matches(r.path, path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
    return best ? best.allow : true;
  };
  const first = (rules, path) => { const r = rules.find((x) => matches(x.path, path)); return r ? r.allow : true; };
  const PROBES = ["/admin/claims", "/auth", "/account"];
  const h = read("robots.h");
  const st = h === null ? null : ([...h.matchAll(/^HTTP\/[\d.]+\s+(\d{3})/gm)].map((m) => Number(m[1])).pop() ?? 0);
  if (st === null) out("INFO", "N9 robots.txt was not read: the site stopped answering before it was asked for (N1 says why)");
  else if (st !== 200) out("INFO", `N9 robots.txt answered HTTP ${st || "no answer"}, so no group could be judged here (section 63 FAILs a robots.txt that does not disallow /email/unsubscribe)`);
  else {
    const groups = groupsOf(read("robots.txt") ?? "");
    if (!groups.length) out("FAIL", "N9 robots.txt answered 200 with no User-agent group in it, so it tells no reader anything (is it the app's page?)");
    else if (!groups.some((g) => g.agents.includes("*"))) out("FAIL", `N9 robots.txt: none of its ${groups.length} group(s) names *, so a reader no group names may read ${PROBES.join(", ")} and the whole site (RFC 9309: with no * group, every path is allowed)`);
    else {
      const opens = [];
      const leaks = [];
      for (const g of groups) {
        const who = g.agents.join(", ");
        if (g.rules.some((r) => r.allow && r.path === "/")) opens.push(who);
        for (const p of PROBES) for (const [name, allows] of [["longest", longest], ["first", first]]) if (allows(g.rules, p)) leaks.push(`${who} allows ${p} by the ${name} match`);
      }
      if (opens.length || leaks.length) out("FAIL", `N9 robots.txt: ${opens.length} of its ${groups.length} groups open with a line allowing the whole site${opens.length ? ` (${opens.slice(0, 6).join(", ")}${opens.length > 6 ? ", ..." : ""})` : ""}, and ${leaks.length} reading(s) of ${PROBES.join(", ")} come out allowed${eg(leaks)}`);
      else out("PASS", `N9 robots.txt: none of its ${groups.length} groups opens with a line allowing the whole site, and every one disallows ${PROBES.join(", ")} by the longest match (Google, Bing, RFC 9309) and by the first match`);
    }
  }
}
// N10: the homepage's WebSite node gives the domain as its backup name (SEO audit 2026-11-18, OFFSITE-2).
{
  const home = pages.find((p) => p.path === "/");
  const host = (() => { try { return new URL(SITE).hostname; } catch { return ""; } })();
  if (!home || home.status !== 200) out("INFO", `N10 / was not read${home ? ` (HTTP ${home.status || "no answer"})` : ""}, so its site name could not be judged (N1 says why)`);
  else {
    const nodes = [];
    let unparsed = 0;
    const walk = (x) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") { if (Array.isArray(x["@graph"])) walk(x["@graph"]); else nodes.push(x); }
    };
    for (const m of home.doc.matchAll(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try { walk(JSON.parse(m[1])); } catch { unparsed++; }
    }
    const sites = nodes.filter((x) => [].concat(x["@type"] ?? []).includes("WebSite"));
    const names = [].concat(sites[0]?.alternateName ?? []).filter((x) => typeof x === "string");
    if (!sites.length && unparsed) out("FAIL", `N10 / carries ${unparsed} JSON-LD block(s) that do not parse, and no WebSite node in the rest`);
    else if (!sites.length) out("INFO", "N10 / carries no WebSite node, so its name could not be judged here (98-seo-round G1 FAILs a page without its WebSite)");
    else if (sites.length > 1) out("FAIL", `N10 / carries ${sites.length} WebSite nodes; one URL is one entity`);
    else if (!names.includes(host)) out("FAIL", `N10 /'s WebSite node gives no alternateName naming ${host} (it has ${JSON.stringify(sites[0].alternateName ?? null)}), so the site name has no domain to fall back on`);
    else out("PASS", `N10 /'s one WebSite node, "${sites[0].name}", gives ${host} as its alternateName, the backup Google's site-name rules ask for`);
  }
}
VD98ZZ_JUDGE
