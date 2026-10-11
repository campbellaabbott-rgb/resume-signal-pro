# Wave 3, seo-content (branch wave3/seo-content): what crawlers and answer
# engines are served. A FRONTEND + PRERENDER deploy (no edge function, no
# migration), so every claim is judged on the served documents with the
# Googlebot UA, exactly as the SEO report of 2026-10-08 measured them.
# Read-only: GETs of public pages, the sitemap, the ledger, llms files and a
# static image. Nothing is sent or written. Pre-deploy the new claims FAIL by
# design; nothing here may crash.
# F2a judges the URLs the PREVIOUS publish named, so save the live sitemap
# BEFORE each publish:
#   curl -s https://resumebooster.work/sitemap.xml > ~/.config/resumebooster/seo/last-sitemap.xml
# and the F2a line checks every posting URL it named, eight at a time. Without
# that file (or with one saved after the publish, identical to the live
# sitemap) F2a prints INFO "cannot judge" and only the live sitemap's own
# posting URLs are checked (S11-154: a sitemap the new bake wrote cannot show
# what became of the old one's URLs).
echo "== 76. wave 3 seo-content: names, published URLs, company pages, data pages, claims =="

REPO_ROOT76="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE="$SITE" UA="$UA" LAST_SITEMAP="$HOME/.config/resumebooster/seo/last-sitemap.xml" REPO_ROOT="$REPO_ROOT76" node -e '
const { SITE, UA, LAST_SITEMAP, REPO_ROOT } = process.env;
const fs = require("fs");
const crypto = require("crypto");
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
const get = async (path, ms = 30000) => {
  try {
    const r = await fetch(path.startsWith("http") ? path : SITE + path, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(ms) });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, body: buf.toString("utf8"), bytes: buf };
  } catch (e) { return { status: 0, body: "", bytes: Buffer.alloc(0), err: String(e).slice(0, 80) }; }
};
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const titleOf = (h) => (h.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
const canonOf = (h) => (h.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || "";
const robotsOf = (h) => (h.match(/<meta name="robots" content="([^"]*)"/) || [])[1] || "";
const lds = (h) => [...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1].replace(/\\u003c/g, "<")); } catch { return null; } }).filter(Boolean);
const textOf = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "\x27").replace(/\s+/g, " ");
(async () => {
  const home = await get("/");
  if (home.status !== 200) { out("FAIL", `/ answered ${home.status} ${home.err || ""}: nothing below can be judged`); return; }
  const homeMd5 = md5(home.body);
  // A homepage copy: the same bytes, or the homepage file under another path
  // (the host can vary a byte or two; the title cannot).
  const isHomeCopy = (b) => b === home.body || md5(b) === homeMd5 || titleOf(b) === titleOf(home.body);

  // ---- Owner decision 2 + F2d: the homepage head ----
  const ht = titleOf(home.body);
  if (/Live Jobs Straight From Employers/.test(ht) && !/Zero Ghost/i.test(ht)) out("PASS", `homepage title says where the jobs come from: "${ht}"`);
  else out("FAIL", `homepage title is still "${ht}" (owner decision 2: no "Zero Ghost Jobs")`);
  if (/zero ghost|every job here is real|never scraped|bank-level/i.test(textOf(home.body) + home.body.slice(0, 6000))) out("FAIL", "the homepage still carries a retired absolute claim (zero ghost / every job is real / never scraped / bank-level)");
  else out("PASS", "the homepage carries none of the retired absolute claims");
  if (canonOf(home.body) === `${SITE}/`) out("PASS", "the homepage file names itself canonical (an unknown address is no longer an indexable copy of /)");
  else out("FAIL", `the homepage canonical is "${canonOf(home.body) || "absent"}" (F2d)`);
  // L1-08: the agent Service carries its prices.
  const svc = lds(home.body).find((j) => j["@type"] === "Service");
  const prices = svc && Array.isArray(svc.offers) ? svc.offers.map((o) => o.price) : [];
  if (prices.includes("99") && prices.includes("29")) out("PASS", "the homepage apply-agent Service offers carry $99 and $29 (L1-08)");
  else out("FAIL", `the homepage Service offers carry ${JSON.stringify(prices)} (L1-08: was "Included with an account")`);

  // ---- F1: employers by the name they use ----
  const ms = [];
  for (const t of ["ms~wd5~external", "ms~wd5~private"]) { const r = await get(`/jobs/company/${t}`); if (r.status === 200 && !isHomeCopy(r.body)) ms.push([t, titleOf(r.body)]); }
  if (ms.length === 0) out("INFO", "no Morgan Stanley company page is written this publish (ms~wd5~external / ms~wd5~private)");
  else if (ms.every(([, t]) => /Morgan Stanley/.test(t) && !/^Ms Jobs/.test(t))) out("PASS", `Morgan Stanley pages are named Morgan Stanley: ${ms.map(([t, x]) => `${t} "${x}"`).join("; ")}`);
  else out("FAIL", `a Morgan Stanley page still names its tenant code: ${ms.map(([t, x]) => `${t} "${x}"`).join("; ")}`);
  const dom = await get("/jobs/company/dominos");
  if (dom.status === 200 && !isHomeCopy(dom.body)) {
    if (/Domino(?:\x27|&#39;)s(?:\x27|&#39;)s/.test(dom.body)) out("FAIL", "/jobs/company/dominos still says Domino\x27s\x27s");
    else out("PASS", "/jobs/company/dominos never doubles the possessive");
    // S1 / L4-12: its own openings, linked to posting pages or to the posting
    // on the live board. A ?country= or ?category= link is this same page to
    // a crawler, so it is not counted.
    const pagesN = (dom.body.match(/href="\/jobs\/posting\//g) || []).length;
    const jobsN = (dom.body.match(/href="\/jobs\?job=/g) || []).length;
    if (pagesN + jobsN >= 10) out("PASS", `/jobs/company/dominos lists ${pagesN + jobsN} of its own openings (${pagesN} posting pages, ${jobsN} board postings) (S1)`);
    else out("FAIL", `/jobs/company/dominos links ${pagesN + jobsN} openings of its own (${pagesN} posting pages, ${jobsN} board postings); the bar is 10 (S1)`);
    if (/THE COUNT\x27S BASIS/.test(dom.body)) out("FAIL", "/jobs/company/dominos still prints the THE COUNT\x27S BASIS annotation (L4-12)");
    else out("PASS", "the company page states its count basis as prose (L4-12)");
  } else out("INFO", `/jobs/company/dominos answered ${dom.status}; F1/S1 judged on other pages only`);

  // ---- the sitemap, the ledger, F2a/F2b/F2c, S3 ----
  const sm = await get("/sitemap.xml");
  const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
  const urlRows = [...sm.body.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => ({ loc: ((m[1].match(/<loc>([^<]+)<\/loc>/) || [])[1] || "").trim(), lastmod: ((m[1].match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1] || "").trim() })).filter((u) => u.loc);
  const led = await get("/prerender-ledger.json");
  let ledger = null; try { ledger = JSON.parse(led.body); } catch {}
  const ledgerOk = led.status === 200 && ledger && typeof ledger.builtAt === "string";
  if (ledgerOk) {
    const st = {}; for (const e of Object.values(ledger.postings || {})) st[e.state] = (st[e.state] || 0) + 1;
    out("PASS", `/prerender-ledger.json is served (built ${ledger.builtAt}): posting URLs by state ${JSON.stringify(st)}, ${Object.keys(ledger.pages || {}).length} pages`);
  } else out("FAIL", `/prerender-ledger.json answered ${led.status} with no ledger (F2a: the next publish has no record of this one)`);
  // S3: lastmod by content, judged on the pages the ledger dates, never on
  // /guides/ (each guide states its own date, so guides alone made "more than
  // one distinct date" true on any sitemap; S11-154).
  const pathOf = (u) => { let p = u.startsWith(SITE) ? u.slice(SITE.length) || "/" : u; try { p = decodeURI(p); } catch {} return p; };
  const pages = (ledgerOk && ledger.pages && typeof ledger.pages === "object") ? ledger.pages : {};
  const dated = urlRows.filter((u) => !pathOf(u.loc).startsWith("/guides/") && pages[pathOf(u.loc)] && typeof pages[pathOf(u.loc)].lastmod === "string");
  const offLedger = dated.filter((u) => u.lastmod !== pages[pathOf(u.loc)].lastmod);
  const s3dates = new Set(dated.map((u) => u.lastmod));
  if (!ledgerOk) out("INFO", "S3 not judged: no ledger to read page dates from");
  else if (!dated.length) out("INFO", `S3 not judged: none of the sitemap\x27s ${urlRows.length} non-guide URLs is a page the ledger dates`);
  else if (offLedger.length) out("FAIL", `${offLedger.length} of ${dated.length} sitemap URLs carry a lastmod that is not their ledger date, e.g. ${offLedger.slice(0, 3).map((u) => `${pathOf(u.loc)} ${u.lastmod} vs ${pages[pathOf(u.loc)].lastmod}`).join("; ")} (S3)`);
  else if (s3dates.size > 1) out("PASS", `${dated.length} non-guide sitemap URLs carry ${s3dates.size} distinct lastmod dates, each its page\x27s ledger date (S3: was one publish date on all)`);
  else out("INFO", `S3 not judged: all ${dated.length} non-guide pages the ledger dates carry ${[...s3dates][0]}${[...s3dates][0] === ledger.builtAt ? ", this bake\x27s date (a first bake with a ledger, or every page changed)" : ""}; a later bake that carries unchanged pages forward can show lastmod by content`);
  // F2a: what became of the URLs the PREVIOUS publish named. The live sitemap
  // is the new bake\x27s own, so it cannot answer that (S11-154).
  let prevRaw = "";
  try { prevRaw = fs.readFileSync(LAST_SITEMAP, "utf8"); } catch {}
  const prevPostings = [...prevRaw.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()).filter((u) => u.includes("/jobs/posting/"));
  const prevIsLive = prevRaw && md5(prevRaw) === md5(sm.body);
  const judgePrev = prevPostings.length > 0 && !prevIsLive;
  if (!judgePrev) out("INFO", `F2a cannot judge the previous publish\x27s posting URLs: ${!prevRaw ? `no saved sitemap at ${LAST_SITEMAP}` : prevIsLive ? "the saved sitemap is this publish\x27s own (saved after it)" : "the saved sitemap names no posting URL"}. Save the live sitemap there BEFORE each publish: curl -s ${SITE}/sitemap.xml > ${LAST_SITEMAP}`);
  const basis = judgePrev ? "the previous publish\x27s sitemap" : "the live sitemap\x27s own";
  const sample = judgePrev ? prevPostings : locs.filter((u) => u.includes("/jobs/posting/"));
  let homeCopies = 0, stubs = 0, live = 0, failed = 0;
  for (let i = 0; i < sample.length; i += 8) {
    await Promise.all(sample.slice(i, i + 8).map(async (u) => {
      const r = await get(u, 20000);
      if (r.status !== 200) { failed++; return; }
      if (isHomeCopy(r.body)) homeCopies++;
      else if (/noindex/.test(robotsOf(r.body))) stubs++;
      else live++;
    }));
  }
  const claim = judgePrev ? "F2a" : "the new bake\x27s URLs; F2a itself not judged";
  if (!sample.length) out("INFO", `no posting URL to check (${basis} sitemap names none)`);
  else if (homeCopies === 0 && failed === 0) out("PASS", `${sample.length} posting URLs from ${basis}: ${live} live pages, ${stubs} noindex "no longer listed" pages, 0 homepage copies (${claim})`);
  else out("FAIL", `${sample.length} posting URLs from ${basis}: ${homeCopies} homepage copies, ${failed} non-200 (${live} live, ${stubs} noindex) (${claim}; F2a was 364 of 371)`);
  // F2b / F2c: the company links on a few posting pages
  const postPages = locs.filter((u) => u.includes("/jobs/posting/")).slice(0, 8);
  const hrefs = new Set();
  for (const u of postPages) { const r = await get(u, 20000); for (const m of r.body.matchAll(/href="(\/jobs\/company\/[^"?#]+)"/g)) hrefs.add(m[1]); }
  let dead = 0, copies = 0, dottedBare = 0;
  for (const h of [...hrefs].slice(0, 25)) {
    if (/\.[^/]*$/.test(h)) dottedBare++;
    const r = await get(h, 20000);
    if (r.status !== 200) dead++; else if (isHomeCopy(r.body)) copies++;
  }
  if (!hrefs.size) out("INFO", `the ${postPages.length} sampled posting pages link no company page (they link /jobs?company= where no page is written)`);
  else if (dead + copies + dottedBare === 0) out("PASS", `${Math.min(hrefs.size, 25)} company links on ${postPages.length} posting pages: every one a real page, no slashless dotted href (F2b, F2c)`);
  else out("FAIL", `company links on posting pages: ${copies} homepage copies, ${dead} non-200, ${dottedBare} dotted hrefs without the slash (F2b/F2c)`);
  // F1 on posting markup, judged POSITIVELY (S11-153): a posting page on a
  // token the override table names (ms~wd5~external is Morgan Stanley, rmit~
  // RMIT University) must carry exactly that name as hiringOrganization. The
  // sample is chosen to include such pages; the old line skipped every
  // override token, so a regression to "Ms" could never fail it. Then the
  // negative half: no page names a reviewed tenant code, or a vowelless code
  // the display left in lower case ("Bb"), as its employer. Both read the
  // tables the bake uses (supabase/functions/_shared/employer-names.ts,
  // src/lib/company-display.ts).
  const srcOf = (rel) => { try { return fs.readFileSync(`${REPO_ROOT}/${rel}`, "utf8"); } catch { return ""; } };
  const overrides = new Map([...((srcOf("supabase/functions/_shared/employer-names.ts").match(/EMPLOYER_NAME_OVERRIDES[^=]*= new Map\(\[([\s\S]*?)\n\]\);/) || [])[1] || "").matchAll(/\["([^"]+)", "([^"]*)"\]/g)].map((m) => [m[1], m[2]]));
  const reviewedCodes = new Set([...((srcOf("src/lib/company-display.ts").match(/REVIEWED_TENANT_CODES = new Set\(\[([\s\S]*?)\]\)/) || [])[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]));
  // employerNameOverride(): the exact full token first, then a Workday tenant slug.
  const overrideOf = (tok) => (tok.includes("~") && overrides.has(tok)) ? overrides.get(tok) : (tok.includes("~wd") && overrides.has(tok.split("~")[0].toLowerCase())) ? overrides.get(tok.split("~")[0].toLowerCase()) : null;
  const tokOf = (u) => { let t = (u.match(/\/jobs\/posting\/[^/]+\/([^/]+)\//) || [])[1] || ""; try { t = decodeURIComponent(t); } catch {} return t; };
  if (!overrides.size || !reviewedCodes.size) out("INFO", `the F1 lines read ${overrides.size} overrides and ${reviewedCodes.size} reviewed codes from the repo at ${REPO_ROOT}`);
  const allPostings = locs.filter((u) => u.includes("/jobs/posting/"));
  const overridePages = allPostings.filter((u) => overrideOf(tokOf(u)) !== null).slice(0, 8);
  let named = 0, misnamed = [];
  for (const u of overridePages) {
    const r = await get(u, 20000);
    const jp = lds(r.body).find((j) => j["@type"] === "JobPosting");
    if (!jp) continue; // a "no longer listed" stub carries no JobPosting
    const want = overrideOf(tokOf(u));
    const got = String((jp.hiringOrganization || {}).name || "").trim();
    if (got.toLowerCase() === want.trim().toLowerCase()) named++;
    else misnamed.push(`${tokOf(u)} "${got}" (want "${want}")`);
  }
  if (misnamed.length) out("FAIL", `${misnamed.length} of ${named + misnamed.length} posting pages on override tokens do not name the override as hiringOrganization: ${misnamed.slice(0, 4).join("; ")} (F1)`);
  else if (named) out("PASS", `${named} posting pages on override tokens name the employer by its override as hiringOrganization (F1)`);
  else out("INFO", `F1 not judged positively: ${overridePages.length ? `the ${overridePages.length} posting pages on override tokens carry no JobPosting` : "the sitemap names no posting page on a token the override table covers"}`);
  let codeNamed = [], orgs = 0;
  for (const u of [...new Set([...postPages, ...overridePages])]) {
    const r = await get(u, 20000);
    const jp = lds(r.body).find((j) => j["@type"] === "JobPosting");
    const tok = tokOf(u);
    if (!jp || !tok.includes("~")) continue;
    orgs++;
    const slug = tok.split("~")[0].toLowerCase();
    const got = String((jp.hiringOrganization || {}).name || "").trim();
    if (overrideOf(tok) === null && got.toLowerCase() === slug && (reviewedCodes.has(slug) || (!/[aeiouy]/.test(slug) && got !== got.toUpperCase()))) codeNamed.push(`${tok} "${got}"`);
  }
  if (!orgs) out("INFO", "no sampled posting page is on a compound (Workday/Oracle) token, so the tenant-code check had nothing to read");
  else if (!codeNamed.length) out("PASS", `${orgs} sampled Workday/Oracle posting pages: none names a reviewed tenant code or an unreadable code as hiringOrganization (F1)`);
  else out("FAIL", `${codeNamed.length} of ${orgs} sampled Workday/Oracle posting pages name a tenant code as hiringOrganization: ${codeNamed.slice(0, 4).join("; ")} (F1)`);
  // S11-013 positive controls: real one-word employers whose name IS their
  // tenant code keep indexable company pages. A noindex page that still lists
  // three or more openings of its own was not noindexed for being thin.
  const controls = [["intel~wd1~External", "Intel"], ["mastercard~wd1~CorporateCareers", "Mastercard"], ["medtronic~wd1~MedtronicCareers", "Medtronic"], ["menasha~wd12~MenashaCorp", "Menasha"], ["adient~wd3~External", "Adient"]];
  const ctl = { ok: [], bad: [], thin: [] };
  for (const [t, n] of controls) {
    const r = await get(`/jobs/company/${t}`, 20000);
    if (r.status !== 200 || isHomeCopy(r.body)) continue;
    const own = (r.body.match(/href="\/jobs\/posting\//g) || []).length + (r.body.match(/href="\/jobs\?job=/g) || []).length;
    if (!/noindex/.test(robotsOf(r.body))) ctl.ok.push(n);
    else if (own >= 3) ctl.bad.push(`${n} (${own} openings listed)`);
    else ctl.thin.push(n);
  }
  if (ctl.bad.length) out("FAIL", `real employers named by their tenant code have noindex company pages: ${ctl.bad.join(", ")} (S11-013)`);
  else if (ctl.ok.length) out("PASS", `real employers named by their tenant code keep indexable company pages: ${ctl.ok.join(", ")}${ctl.thin.length ? `; noindex with under three openings listed (not judged): ${ctl.thin.join(", ")}` : ""} (S11-013)`);
  else out("INFO", `S11-013 controls not judged: no company page is written for ${controls.map(([, n]) => n).join(", ")}${ctl.thin.length ? ` (noindex with under three openings: ${ctl.thin.join(", ")})` : ""}`);

  // ---- S2: the Ghost Job Index ----
  const g = await get("/ghost-job-index");
  if (/Daily re-check: \d+(?:\.\d+)?% of [\d,]+ decided sample postings still live at the source \(\d{4}-\d{2}-\d{2}\)/.test(textOf(g.body))) out("PASS", "/ghost-job-index prints its dated daily re-check (S2)");
  else out("FAIL", "/ghost-job-index prints no dated daily re-check line (S2; or the audit was unread at bake time)");
  const ds = lds(g.body).find((j) => j["@type"] === "Dataset");
  if (ds && ds.dateModified) out("PASS", `/ghost-job-index is Dataset markup dated ${ds.dateModified}${ds.license ? `, license ${ds.license}` : ", no license named (owner TODO)"}`);
  else out("FAIL", "/ghost-job-index carries no Dataset markup with dateModified (S2)");
  if (/actually fill|truly fill|roles actually filled/i.test(g.body)) out("FAIL", "/ghost-job-index still says companies fill roles");
  else out("PASS", "/ghost-job-index never says a takedown is a fill");
  const ht2 = await get("/hiring-trends");
  if (/<td class="py-1 pr-3">other<\/td>/.test(ht2.body)) out("FAIL", "/hiring-trends prints the raw field code \"other\"");
  else out("PASS", "/hiring-trends prints field labels, not raw codes");

  // ---- S4: /methodology ----
  const mth = await get("/methodology");
  const mt = textOf(mth.body);
  if (/50\+|90% of the job market|\+ ?40 more/.test(mt)) out("FAIL", "/methodology still claims 50+ / 90% of the job market / +40 more (S4)");
  else out("PASS", "/methodology makes no 50+, 90% or +40 claim");
  if (/ATS Platforms We Analyze Against[\s\S]{0,600}Taleo[\s\S]{0,200}BambooHR/.test(mt)) out("PASS", "/methodology lists the six systems the scan names under its heading");
  else out("FAIL", "/methodology has no system list under \"ATS Platforms We Analyze Against\" (S4)");

  // ---- L1-09: legal pages are their own pages ----
  for (const p of ["/terms", "/privacy"]) {
    const r = await get(p);
    if (r.status === 200 && !isHomeCopy(r.body) && canonOf(r.body) === `${SITE}${p}`) out("PASS", `${p} is its own page ("${titleOf(r.body)}"), canonical to itself`);
    else out("FAIL", `${p} serves the homepage copy or no self-canonical (L1-09)`);
  }

  // ---- llms files ----
  const lt = await get("/llms.txt");
  const rel = (lt.body.match(/\]\(\//g) || []).length;
  if (lt.status === 200 && rel === 0 && /work\.resumebooster\/jobs/.test(lt.body) && !/zero ghost|whether it was filled|10 languages|aggregator or a scrape/i.test(lt.body)) out("PASS", "/llms.txt names its domain on every link, names the registry entry, and drops zero-ghost, filled, 10 languages and never-a-scrape");
  else out("FAIL", `/llms.txt: ${rel} relative links${/zero ghost/i.test(lt.body) ? ", still says zero ghost jobs" : ""}${/whether it was filled/.test(lt.body) ? ", still says filled" : ""}${/10 languages/.test(lt.body) ? ", still says 10 languages" : ""}${/aggregator or a scrape/.test(lt.body) ? ", still says never a scrape" : ""}${/work\.resumebooster\/jobs/.test(lt.body) ? "" : ", no registry name"}`);
  const lf = await get("/llms-full.txt");
  if (/work\.resumebooster\/jobs/.test(lf.body) && !/raises both for its hours`?$/m.test(lf.body) && /never raises them on \/v1/.test(lf.body)) out("PASS", "/llms-full.txt names the registry entry and scopes the pass to the MCP server (L9-11)");
  else out("FAIL", "/llms-full.txt lacks the registry name or still says a pass raises the /v1 limits (L9-11)");
  if (/every employer with open roles/.test(lf.body)) out("FAIL", "/llms-full.txt still says /companies lists every employer with open roles (L4-11)");
  else if (/\/companies — the [\d,]+ employers this site gives a page/.test(lf.body)) out("PASS", "/llms-full.txt says /companies lists the employers with a page of their own, counted (L4-11)");
  else out("FAIL", "/llms-full.txt has no counted /companies line (L4-11)");

  // ---- L1-05: a role page calls the lists its field\x27s ----
  const rp = await get("/roles/pilot");
  const rpt = textOf(rp.body);
  if (rp.status === 200 && /Keywords from the [^<]+ tables/.test(rp.body) && !/expect on a pilot resume|anchor a pilot resume/i.test(rpt)) out("PASS", "/roles/pilot heads its lists as the field\x27s tables (L1-05)");
  else out("FAIL", "/roles/pilot still heads the field\x27s lists as written for the pilot title (L1-05)");

  // ---- L4-13: the share image is what it says ----
  const og = await get("/og-image.png");
  if (og.bytes.slice(0, 4).toString("hex") === "89504e47") out("PASS", "/og-image.png is a real PNG");
  else out("FAIL", `/og-image.png starts ${og.bytes.slice(0, 4).toString("hex")} (a JPEG served as PNG, L4-13)`);

  // ---- the seller: empty until the owner sets it ----
  out("INFO", /Sold by /.test(home.body) ? "the crawlable footer names a seller" : "no seller is named yet (src/config/seller.ts is empty by design until the owner sets it)");
})().catch((e) => out("FAIL", `section 76 could not finish: ${String(e).slice(0, 120)}`));
'
