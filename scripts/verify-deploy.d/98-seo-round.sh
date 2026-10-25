# shellcheck shell=bash
# ── 98. THE SEO ROUND (branch seo/bake, 2026-10-18): what crawlers, answer
# engines and share cards read after the bake fixes of the SEO/GEO round.
# A FRONTEND + PRERENDER deploy (no edge function, no migration), so every
# claim is judged on the served documents with the Googlebot UA.
# Sourced by scripts/verify-deploy.sh; $SITE and $UA are in scope.
#
# THE CLAIMS:
#   I1  (IMG-3) /og-image.png, /favicon.png, /apple-touch-icon.png and
#       /favicon.ico answer 200 with an image type, inside their size bounds
#       (og <= 200 KB, favicon <= 10 KB, apple <= 30 KB), at their sizes
#       (og 1200x630, favicon 48-96 px square, apple 180x180), and the head's
#       og:image:width/height and apple-touch-icon href match the files.
#       FAIL until the image follow-ups (the 1200x630 card, the 180 px icon,
#       the smaller favicon) are deployed: that is the point of the line.
#   P1  (SEO-003, SEO-004, SEO-016, SEO-035) posting pages the sitemap names:
#       no baseSalary, no locality carrying a site code, a bracket, "only", a
#       work-mode word, a dash at either end or a country's name, no
#       TELECOMMUTE (the board carries no vendor flag yet: INFO once it does),
#       validThrough never more than 30 days past the datePosted it states.
#   P2  (OBS-1) no two sitemap posting pages share a title.
#   P3  (SEO-023) a posting page preloads JobPosting-*.js and not Jobs-*.js;
#       / adds Index-*.js from its "/"-only script, never in its static head
#       (the same file is every unbaked address's page, so /auth must preload
#       no Index-*.js); /pricing preloads Pricing-*.js.
#   C1  (SEO-005) company pages link no /jobs?job= address and name their own
#       hiring system, never the nineteen-system list.
#   C2  (S12-021, SEO-037) the PwC page states the sum of its boards; the
#       University of Rochester's UR_Staff board is self-canonical and noindex.
#   C3  (S13-047) a once-published company path the board still carries serves
#       the app shell, never a tombstone.
#   C4  (SEO-010) /landers.json, which every React employer link reads, answers
#       200 as JSON, names at least 400 boards and maps dominos to its page: a
#       missing or HTML manifest silently sends every employer link to the
#       generic board.
#   G1  (SEO-011a) every sampled page carries the #org Organization (no legal
#       identity) and a WebSite whose publisher is it; /agents carries the MCP
#       server's SoftwareApplication; /about is a page of its own.
#   G2  (SEO-014, SEO-015) both llms files carry the MCP address /agents
#       prints and the API host /data-api prints; /v1 and /v1/jobs are noindex
#       pages naming the API host.
#   G3  (R5a, R6a, R7a, SEO-027) no sampled page or llms file says "never an
#       aggregator", "no aggregators", "never a repost", an unconditional
#       re-check, or (on /companies, whose list holds USAJOBS and staffing
#       agencies) that every posting comes from the company's own system; /agents and the llms files name no IDE host; every llms.txt
#       URL is in the sitemap.
#   G4  (SEO-029, S12-133, SEO-034, SEO-028) /privacy and /terms carry their
#       full text; /affiliates prints no 20%; a French page says fr_FR and
#       content-language fr; the Ghost Job Index Dataset is brand-qualified.
#
# Read-only: GETs of public pages, images, the sitemap, the ledger and the
# llms files. Nothing is sent or written. Before the deploy most lines FAIL by
# design.
echo "== 98. the SEO round: markup, links, entity graph, addresses, copy and images, as crawlers read them =="

SITE="$SITE" UA="$UA" node --input-type=module -e '
const { SITE, UA } = process.env;
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
const get = async (path, ms = 30000, binary = false) => {
  try {
    const r = await fetch(path.startsWith("http") ? path : SITE + path, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(ms) });
    const type = (r.headers && r.headers.get && r.headers.get("content-type")) || "";
    if (binary) { const buf = new Uint8Array(await r.arrayBuffer()); return { status: r.status, type, buf, body: "" }; }
    return { status: r.status, type, body: await r.text() };
  } catch (e) { return { status: 0, type: "", body: "", buf: new Uint8Array(0), err: String(e).slice(0, 80) }; }
};
const ld = (h) => [...String(h).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1].replace(/\\u003c/g, "<")); } catch { return {}; } });
const titleOf = (h) => (String(h).match(/<title>([^<]*)<\/title>/) || [])[1] || "";
// A LOCALITY NO ONE WOULD CALL A TOWN, judged here without the bake\x27s code:
// country names come from the runtime\x27s own region names.
const COUNTRY_NAMES = (() => {
  const names = new Set(["usa", "uk", "america", "england", "scotland", "wales", "holland", "the netherlands", "czech republic", "russia", "south korea", "korea", "turkey", "uae"]);
  try { const dn = new Intl.DisplayNames(["en"], { type: "region" }); for (let a = 65; a < 91; a++) for (let b = 65; b < 91; b++) { const c = String.fromCharCode(a, b); let n; try { n = dn.of(c); } catch { n = undefined; } if (n && n !== c) names.add(n.toLowerCase().replace(/\s*\(.*\)\s*$/, "")); } } catch {}
  return names;
})();
const localityProblem = (s) => {
  const t = String(s).trim();
  if (/[/_()|]|\bonly\b|\b(?:remote|hybrid|on-?site)\b/i.test(t)) return "a site code, a bracket, only or a work mode";
  if (/^[-\u2013_/,.:]|[-\u2013_/,.:]$/.test(t)) return "a dash or a mark at one end";
  const w = t.toLowerCase().split(/\s+/).map((x) => x.replace(/^[-\u2013_/,.:]+|[-\u2013_/,.:]+$/g, "")).filter(Boolean);
  for (let i = 0; i < w.length; i++) for (let n = 1; n <= 4 && i + n <= w.length; n++) {
    if (!COUNTRY_NAMES.has(w.slice(i, i + n).join(" "))) continue;
    const rest = [...w.slice(0, i), ...w.slice(i + n)];
    if (rest.length === 1 && /^(?:city|town|west|east|north|south|new|port|fort|lake|mount|mt|saint|st)$/.test(rest[0])) continue;
    return "a country\x27s name";
  }
  return null;
};
const robotsOf = (h) => (String(h).match(/<meta name="robots" content="([^"]*)"/) || [])[1] || "";
const canonOf = (h) => (String(h).match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || "";
const text = (h) => String(h).replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&quot;/g, "\"").replace(/&#39;/g, "\x27").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const pathOf = (u) => u.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/";
const urlOf = (p) => (/\.[^/]*$/.test(p) ? `${p}/` : p);

// ---- I1: the images ----
{
  const png = (buf) => (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    ? { w: (buf[16] << 24 | buf[17] << 16 | buf[18] << 8 | buf[19]) >>> 0, h: (buf[20] << 24 | buf[21] << 16 | buf[22] << 8 | buf[23]) >>> 0 } : null);
  const home = await get("/");
  const meta = (re) => (home.body.match(re) || [])[1] || null;
  const ogW = meta(/<meta property="og:image:width" content="([^"]*)"/), ogH = meta(/<meta property="og:image:height" content="([^"]*)"/);
  const appleHref = meta(/<link rel="apple-touch-icon"[^>]*href="([^"]*)"/);
  const specs = [
    ["/og-image.png", { type: /^image\/png/, max: 200 * 1024, dims: (d) => d && d.w === 1200 && d.h === 630, want: "1200x630" }],
    ["/favicon.png", { type: /^image\/png/, max: 10 * 1024, dims: (d) => d && d.w === d.h && d.w >= 48 && d.w <= 96, want: "48-96 px square" }],
    ["/apple-touch-icon.png", { type: /^image\/png/, max: 30 * 1024, dims: (d) => d && d.w === 180 && d.h === 180, want: "180x180" }],
    ["/favicon.ico", { type: /^image\/(?:vnd\.microsoft\.icon|x-icon)/, max: 30 * 1024, dims: null, want: "an icon" }],
  ];
  for (const [p, s] of specs) {
    const r = await get(p, 30000, true);
    const d = png(r.buf || new Uint8Array(0));
    const bad = [];
    if (r.status !== 200) bad.push(`HTTP ${r.status}`);
    if (!s.type.test(r.type)) bad.push(`content-type "${r.type}"`);
    if ((r.buf || []).length > s.max) bad.push(`${(r.buf.length / 1024).toFixed(1)} KB over ${(s.max / 1024)} KB`);
    if (s.dims && !s.dims(d)) bad.push(`${d ? `${d.w}x${d.h}` : "not a PNG"}, want ${s.want}`);
    if (bad.length) out("FAIL", `I1 ${p}: ${bad.join("; ")}`);
    else out("PASS", `I1 ${p}: 200 ${r.type}, ${((r.buf || []).length / 1024).toFixed(1)} KB${d ? `, ${d.w}x${d.h}` : ""}`);
  }
  const og = await get("/og-image.png", 30000, true);
  const od = png(og.buf || new Uint8Array(0));
  if (od && ogW === String(od.w) && ogH === String(od.h)) out("PASS", `I1 the head says og:image ${ogW}x${ogH}, the file is ${od.w}x${od.h}`);
  else out("FAIL", `I1 the head says og:image ${ogW}x${ogH}, the file is ${od ? `${od.w}x${od.h}` : "unreadable"}`);
  if (appleHref && /apple-touch-icon\.png$/.test(appleHref)) out("PASS", `I1 the head links its apple-touch-icon at ${appleHref}`);
  else out("FAIL", `I1 the head links apple-touch-icon at ${appleHref || "nothing"}, not /apple-touch-icon.png (favicon.png doubled as it)`);
}

const sm = await get("/sitemap.xml", 60000);
const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => pathOf(m[1].trim()));
if (!locs.length) out("FAIL", `/sitemap.xml answered ${sm.status} with no URL: the samples below come from it`);
const postings = locs.filter((p) => p.startsWith("/jobs/posting/"));
const companies = locs.filter((p) => p.startsWith("/jobs/company/"));
const pick = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, i) => arr[Math.floor((i * arr.length) / n)]));

// ---- P1/P2/P3: posting pages ----
{
  const sample = pick(postings, 40);
  const docs = new Map();
  for (let i = 0; i < sample.length; i += 8) await Promise.all(sample.slice(i, i + 8).map(async (p) => docs.set(p, await get(urlOf(p)))));
  const bad = [], info = [];
  let read = 0;
  for (const p of sample) {
    const d = docs.get(p);
    if (!d || d.status !== 200) { bad.push(`${p}: HTTP ${d ? d.status : 0}`); continue; }
    const jp = ld(d.body).find((b) => b && b["@type"] === "JobPosting");
    if (!jp) continue;
    read++;
    if ("baseSalary" in jp) bad.push(`${p}: baseSalary`);
    const a = (jp.jobLocation && jp.jobLocation.address) || {};
    const why = typeof a.addressLocality === "string" ? localityProblem(a.addressLocality) : null;
    if (why) bad.push(`${p}: locality "${a.addressLocality}" (${why})`);
    if (jp.jobLocationType === "TELECOMMUTE") info.push(`${p}: TELECOMMUTE${a.addressLocality || a.addressRegion ? ` beside ${a.addressLocality || a.addressRegion}` : ""}`);
    // The markup\x27s own window: validThrough is counted from the day its
    // datePosted states (an employer\x27s "tomorrow" is the bake\x27s day in both).
    const dp = Date.parse(String(jp.datePosted).slice(0, 10)), vt = Date.parse(String(jp.validThrough).slice(0, 10));
    if (Number.isFinite(dp) && Number.isFinite(vt) && (vt - dp) / 86400000 > 30) bad.push(`${p}: validThrough ${String(jp.validThrough).slice(0, 10)} more than 30 days past datePosted ${String(jp.datePosted).slice(0, 10)}`);
  }
  if (!sample.length) out("INFO", "P1 the sitemap names no posting page");
  else if (bad.length) out("FAIL", `P1 ${bad.length} posting page(s): ${bad.slice(0, 10).join("; ")}`);
  else out(read ? "PASS" : "INFO", `P1 ${read} of ${sample.length} sampled posting pages carry job markup: no baseSalary, no junk locality, no window over 30 days`);
  if (info.length) out("FAIL", `P1 TELECOMMUTE while the board carries no vendor remote flag (SEO-003): ${info.slice(0, 6).join("; ")} — INFO once the board returns workModeSource`);
  else if (read) out("PASS", "P1 no sampled page says TELECOMMUTE (only the hiring system\x27s own remote field may, and the board carries none yet)");
  // P2 over every sitemap posting title.
  const titles = new Map();
  const all = postings.slice(0, 600);
  for (let i = 0; i < all.length; i += 12) await Promise.all(all.slice(i, i + 12).map(async (p) => { const d = docs.get(p) || await get(urlOf(p)); const t = titleOf(d.body); if (t) titles.set(t, [...(titles.get(t) || []), p]); }));
  const dup = [...titles.entries()].filter(([, ps]) => ps.length > 1);
  if (!all.length) out("INFO", "P2 no posting page to compare");
  else if (dup.length) out("FAIL", `P2 ${dup.length} title(s) shared by sitemap posting pages: ${dup.slice(0, 3).map(([t, ps]) => `"${t}" x${ps.length}`).join("; ")}`);
  else out("PASS", `P2 ${titles.size} sitemap posting pages, ${titles.size} distinct titles`);
  // P3 preloads.
  const pre = (h) => [...String(h).matchAll(/<link rel="modulepreload" href="\/assets\/([^"]+)"/g)].map((m) => m[1]);
  const one = sample.find((p) => docs.get(p) && docs.get(p).status === 200);
  if (one) {
    const hints = pre(docs.get(one).body);
    if (hints.some((h) => h.startsWith("JobPosting-")) && !hints.some((h) => h.startsWith("Jobs-"))) out("PASS", `P3 ${one} preloads ${hints.filter((h) => /^JobPosting-/.test(h)).join(", ")} and not the Jobs chunk`);
    else out("FAIL", `P3 ${one} preloads ${hints.join(", ") || "nothing"}: want JobPosting-*.js and not Jobs-*.js`);
  }
  {
    const p = "/pricing", want = "Pricing-";
    const hints = pre((await get(p)).body);
    if (hints.some((h) => h.startsWith(want))) out("PASS", `P3 ${p} preloads its route chunk (${hints.filter((h) => h.startsWith(want)).join(", ")})`);
    else out("FAIL", `P3 ${p} preloads ${hints.join(", ") || "nothing"}: want ${want}*.js`);
  }
  // The root file is also the SPA fallback: the homepage\x27s chunks come from
  // its "/"-only script, and a fallback address preloads none of them.
  {
    const home = (await get("/")).body;
    const scripted = ((/<script data-home-preload="1">if\(location\.pathname==="\/"\)\{(\[[^\]]*\])/.exec(home) || [])[1]) || "[]";
    let list = [];
    try { list = JSON.parse(scripted); } catch { list = []; }
    const staticIndex = pre(home).filter((h) => h.startsWith("Index-"));
    if (list.some((h) => String(h).startsWith("Index-")) && !staticIndex.length) out("PASS", `P3 / adds ${list.filter((h) => String(h).startsWith("Index-")).join(", ")} from its "/"-only script, not its static head`);
    else out("FAIL", `P3 / static head preloads ${staticIndex.join(", ") || "no Index chunk"}, its "/"-only script names ${list.join(", ") || "nothing"}: want Index-*.js from the script only`);
    for (const fb of ["/auth", "/some-unknown-route-xyz"]) {
      const d = await get(fb);
      const idx = pre(d.body).filter((h) => !h.startsWith("Footer-"));
      out(d.status === 200 && !idx.length ? "PASS" : "FAIL", `P3 fallback ${fb}: HTTP ${d.status}, static preloads ${pre(d.body).join(", ") || "none"}${idx.length ? " (the homepage\x27s chunks on a page that never runs them)" : ""}`);
    }
  }
}

// ---- C1/C2/C3: company pages ----
{
  const sample = pick(companies, 12);
  const bad = [];
  let read = 0;
  for (const p of sample) {
    const d = await get(urlOf(p));
    if (d.status !== 200) { bad.push(`${p}: HTTP ${d.status}`); continue; }
    read++;
    if (/href="\/jobs\?job=/.test(d.body)) bad.push(`${p}: links /jobs?job=`);
    if (/\(one of Workday, [^)]*JazzHR\)/.test(d.body)) bad.push(`${p}: names all nineteen hiring systems`);
    if (/re-checks a posting when you open it(?!, where the employer)/.test(text(d.body))) bad.push(`${p}: an unconditional re-check`);
  }
  if (bad.length) out("FAIL", `C1 ${bad.join("; ")}`);
  else out(read ? "PASS" : "INFO", `C1 ${read} sampled company pages: no /jobs?job= link, no nineteen-system list, the re-check conditional`);
  const pwc = await get("/jobs/company/pwc~wd3~crm_experienced_careers_site");
  const pwcT = titleOf(pwc.body);
  if (pwc.status === 200 && / open roles across \d+ (?:hiring-system )?boards$/.test(pwcT)) out("PASS", `C2 the PwC page states its boards summed: "${pwcT}"`);
  else out(pwc.status === 200 && robotsOf(pwc.body).includes("noindex") ? "INFO" : "FAIL", `C2 the PwC page reads "${pwcT}" (want the sum "across N hiring-system boards")`);
  const ur = await get("/jobs/company/rochester~wd5~UR_Staff");
  if (ur.status === 200 && pathOf(canonOf(ur.body)) === "/jobs/company/rochester~wd5~UR_Staff" && /noindex/.test(robotsOf(ur.body))) out("PASS", "C2 UR_Staff is self-canonical and noindex, with no cross-employer canonical");
  else out(ur.status === 200 && /no longer has a page/.test(ur.body) ? "INFO" : "FAIL", `C2 UR_Staff canonical ${canonOf(ur.body) || "none"}, robots "${robotsOf(ur.body)}"`);
  // C3: a carried company path the board still carries.
  const led = await get("/prerender-ledger.json", 60000);
  let ledger = null;
  try { ledger = JSON.parse(led.body); } catch { ledger = null; }
  const carried = ledger && ledger.companies ? Object.entries(ledger.companies).filter(([, e]) => e && (e.state === "stub" || e.state === "noindex")).map(([p]) => p) : [];
  if (!carried.length) out("INFO", "C3 the served ledger names no carried company path");
  else {
    const p = carried[Math.floor(carried.length / 2)];
    const d = await get(urlOf(p));
    if (d.status === 200 && /<script type="module"[^>]*src="\/assets\//.test(d.body) && !/No longer a page on this site/.test(d.body)) out("PASS", `C3 carried ${p} serves the app shell, not a tombstone`);
    else out("FAIL", `C3 carried ${p} answered ${d.status} ${/No longer a page on this site/.test(d.body) ? "with a tombstone" : "without the app"}`);
  }
  // C4: the landers manifest the React employer links read.
  const lm = await get("/landers.json", 60000);
  let man = null;
  try { man = /json/.test(lm.type) ? JSON.parse(lm.body) : null; } catch { man = null; }
  const body = man && typeof man === "object" && !Array.isArray(man) ? (["pages", "landers"].map((k) => man[k]).find((v) => v && typeof v === "object" && !Array.isArray(v)) || man) : null;
  const n = body ? Object.keys(body).length : 0;
  const dom = body ? body.dominos : undefined;
  const domOk = dom === "dominos" || dom === "/jobs/company/dominos";
  if (lm.status === 200 && body && n >= 400 && domOk) out("PASS", `C4 /landers.json: 200 ${lm.type}, ${n} boards, dominos -> ${dom}`);
  else out("FAIL", `C4 /landers.json: HTTP ${lm.status} "${lm.type}", ${body ? `${n} boards, dominos -> ${JSON.stringify(dom)}` : "not a JSON object"} (want 200 JSON, at least 400 boards, dominos -> its page: without it every employer link falls back to the generic board)`);
}

// ---- G1-G4: the entity graph, the addresses, the copy ----
{
  const pages = ["/", "/about", "/agents", "/data-api", "/jobs", "/companies", "/ghost-job-index", "/entry-level-index", "/research/ats-score-benchmarks", "/privacy", "/terms", "/affiliates", "/fr/normes-cv/france", "/jobs/field/engineering", ...pick(companies, 2), ...pick(postings, 2)];
  const docs = new Map();
  for (let i = 0; i < pages.length; i += 6) await Promise.all(pages.slice(i, i + 6).map(async (p) => docs.set(p, await get(urlOf(p)))));
  const graphBad = [];
  for (const p of pages) {
    const d = docs.get(p);
    if (!d || d.status !== 200) { graphBad.push(`${p}: HTTP ${d ? d.status : 0}`); continue; }
    const blocks = ld(d.body);
    const org = blocks.find((b) => b["@type"] === "Organization" && b["@id"] === `${SITE}/#org`);
    const site = blocks.find((b) => b["@type"] === "WebSite");
    if (!org) graphBad.push(`${p}: no #org`);
    else if (["legalName", "address", "contactPoint", "sameAs"].some((k) => k in org)) graphBad.push(`${p}: #org carries a legal identity the owner has not supplied`);
    if (!site || !site.publisher || site.publisher["@id"] !== `${SITE}/#org`) graphBad.push(`${p}: WebSite without the #org publisher`);
  }
  if (graphBad.length) out("FAIL", `G1 ${graphBad.slice(0, 10).join("; ")}`);
  else out("PASS", `G1 ${pages.length} pages carry the #org Organization (no legal identity) and a WebSite published by it`);
  const agents = docs.get("/agents") || { body: "" };
  const sw = ld(agents.body).find((b) => b["@type"] === "SoftwareApplication");
  out(sw && Array.isArray(sw.sameAs) && sw.sameAs.some((u) => /github\.com/.test(u)) ? "PASS" : "FAIL", `G1 /agents carries the MCP server SoftwareApplication${sw ? ` (sameAs ${JSON.stringify(sw.sameAs)})` : ": missing"}`);
  const about = docs.get("/about") || { status: 0, body: "" };
  out(about.status === 200 && pathOf(canonOf(about.body)) === "/about" && !robotsOf(about.body).includes("noindex") && locs.includes("/about") ? "PASS" : "FAIL", `G1 /about: HTTP ${about.status}, canonical ${canonOf(about.body) || "none"}, ${locs.includes("/about") ? "in" : "NOT in"} the sitemap`);
  // G2 addresses.
  const mcp = (agents.body.match(/<code>(https:\/\/[^<]*\/functions\/v1\/agent-mcp)<\/code>/) || [])[1];
  const api = ((docs.get("/data-api") || { body: "" }).body.match(/<code>(https:\/\/[^<]*\/functions\/v1\/public-api)<\/code>/) || [])[1];
  const lt = await get("/llms.txt", 60000), lf = await get("/llms-full.txt", 60000);
  for (const [f, d] of [["/llms.txt", lt], ["/llms-full.txt", lf]]) {
    const ok = mcp && d.body.includes(`MCP server address (Streamable HTTP): ${mcp}`) && api && d.body.includes(`${api}/v1`);
    out(ok ? "PASS" : "FAIL", `G2 ${f} carries the MCP address /agents prints (${mcp || "none on /agents"}) and the API host /data-api prints (${api || "none on /data-api"})`);
  }
  for (const p of ["/v1", "/v1/jobs"]) {
    const d = await get(p);
    out(d.status === 200 && /noindex/.test(robotsOf(d.body)) && api && d.body.includes(api) ? "PASS" : "FAIL", `G2 ${p}: HTTP ${d.status}, robots "${robotsOf(d.body)}", ${api && d.body.includes(api) ? "names the API host" : "does NOT name the API host"} (it served the homepage copy before)`);
  }
  // G3 copy.
  const BANNED = [/\bnever an aggregator\b/i, /\bno aggregators\b/i, /\bnever a repost\b/i, /\bnever aggregators\b/i, /\bre-checks a posting when you open it(?!, where the employer)/i, /\bevery posting comes from the company\x27s own hiring system\b/i, /\beach read from the employer\x27s own hiring system\b/i];
  const IDE = /\b(?:Cursor(?! pagination)|VS Code|Visual Studio Code|Cline|Windsurf|Gemini CLI|Codex CLI)\b/;
  const copyBad = [];
  for (const p of pages) {
    const d = docs.get(p);
    if (!d || d.status !== 200) continue;
    let t = text(d.body);
    if (p.startsWith("/jobs/posting/")) t = t.replace(/The employer\x27s own description[\s\S]*?(?=Read from )/, " ");
    for (const re of BANNED) { const m = re.exec(t); if (m) copyBad.push(`${p}: "${m[0]}"`); }
  }
  for (const [f, d] of [["/llms.txt", lt], ["/llms-full.txt", lf]]) for (const re of BANNED) { const m = re.exec(d.body); if (m) copyBad.push(`${f}: "${m[0]}"`); }
  for (const [f, body] of [["/agents", text(agents.body)], ["/llms.txt", lt.body], ["/llms-full.txt", lf.body]]) { const m = IDE.exec(body); if (m) copyBad.push(`${f}: names ${m[0]}`); }
  if (copyBad.length) out("FAIL", `G3 ${copyBad.slice(0, 10).join("; ")}`);
  else out("PASS", `G3 ${pages.length} pages and both llms files: no aggregator promise, no repost promise, the re-check conditional, no IDE host on /agents or the llms files`);
  const llmsUrls = [...lt.body.matchAll(/https:\/\/resumebooster\.work(\/[^\s)#]*)?/g)].map((m) => (m[1] || "/").replace(/\/$/, "") || "/");
  const notIn = [...new Set(llmsUrls.filter((p) => p !== "/llms-full.txt" && !locs.includes(p)))];
  out(notIn.length ? "FAIL" : "PASS", `G3 llms.txt: ${notIn.length ? `URLs not in the sitemap: ${notIn.slice(0, 6).join(", ")}` : `all ${llmsUrls.length} URLs are in the sitemap`}`);
  // G4 the rest.
  const terms = text((docs.get("/terms") || { body: "" }).body), privacy = text((docs.get("/privacy") || { body: "" }).body);
  out(terms.length > 8000 && privacy.length > 8000 && /Refund Policy/.test(terms) ? "PASS" : "FAIL", `G4 /terms ${terms.length} and /privacy ${privacy.length} characters of body, the refund section ${/Refund Policy/.test(terms) ? "present" : "MISSING"}`);
  const aff = docs.get("/affiliates") || { body: "" };
  out(!/\b20%/.test(`${titleOf(aff.body)} ${text(aff.body)}`) ? "PASS" : "FAIL", `G4 /affiliates title "${titleOf(aff.body)}" ${/\b20%/.test(text(aff.body)) ? "still says 20%" : "states no percentage"}`);
  const fr = (docs.get("/fr/normes-cv/france") || { body: "" }).body;
  const ogl = (fr.match(/<meta property="og:locale" content="([^"]*)"/) || [])[1], cl = (fr.match(/<meta http-equiv="content-language" content="([^"]*)"/) || [])[1];
  out(ogl === "fr_FR" && cl === "fr" ? "PASS" : "FAIL", `G4 /fr/normes-cv/france og:locale ${ogl}, content-language ${cl || "none"}`);
  const gji = ld((docs.get("/ghost-job-index") || { body: "" }).body).find((b) => b["@type"] === "Dataset");
  out(gji && gji.name === "Resume Booster Ghost Job Index" && gji["@id"] ? "PASS" : "FAIL", `G4 the Ghost Job Index Dataset is "${gji ? gji.name : "missing"}"${gji && gji.temporalCoverage ? `, covering ${gji.temporalCoverage}` : ""}`);
}
'
