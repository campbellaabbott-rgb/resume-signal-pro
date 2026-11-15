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
#
# Read-only: GETs of the site's own pages. Nothing is sent or written; the
# files it keeps are under /tmp/vd_98zz, removed before each run.
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
const pages = rows.map(([n, path]) => {
  const h = read(`h${n}`) ?? "";
  const doc = read(`b${n}`) ?? "";
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
  return { path, status, xRobots, canon, robots, text, title, dataset: /"@type"\s*:\s*(?:"Dataset"|\[[^\]]*"Dataset")/.test(ld) };
});
if (!pages.length) { out("INFO", "N1-N5 no page was chosen, so none was read (N0 says why)"); process.exit(0); }
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
VD98ZZ_JUDGE
