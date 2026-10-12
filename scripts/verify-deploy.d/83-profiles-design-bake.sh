# shellcheck shell=bash
# ── 83. PROFILES + DESIGN, THE BAKE (branch pd/bake, inside the profiles 0-2
# and design upgrade integration): what crawlers and answer engines are served
# after the apply pivot and the product line of 2026-10-12. A FRONTEND +
# PRERENDER deploy (no edge function, no migration), so every claim is judged
# on the served documents with the Googlebot UA.
# Sourced by scripts/verify-deploy.sh; $SITE and $UA are in scope.
#
# THE CLAIMS:
#   C1  No served page sells or describes a retired product: the Apply Agent's
#       monthly plan, the pass, the Apply Assistant, the Premium package, an
#       agent that applies or submits for you, and the two absolutes the owner
#       ruled out. Read on /, /pricing, /agent, /agents, /guides and every
#       guide the sitemap names, /llms.txt, /llms-full.txt and three company
#       pages, prose and JSON-LD both, by this checkout's list
#       (scripts/prerender-retired.mjs, the list the bake checks its own
#       output against).
#   C2  No Offer on / or /pricing carries a retired price or a retired
#       product's name, and the homepage carries no Service block.
#   C3  The pages that talk about applying say the one true line: search from
#       your own AI (Claude, ChatGPT or Claude Code) and apply yourself.
#   C4  (SEO-002, S12-022) A company URL this site once published and the
#       current sitemap no longer names serves a noindex page of its own, with
#       its own canonical, never the homepage file (on 2026-10-12 MattelInc,
#       10kbi, 1800gotjunk, ABOUTYOUGmbH and APMGroup answered the homepage,
#       index, canonical "/"). A named URL that is back in the sitemap is
#       judged as an indexable page of its own.
#   C5  The served ledger carries the companies map the carry reads.
#
# Read-only: GETs of public pages, the sitemap, the ledger and llms files.
# Nothing is sent or written. Before the deploy C1-C5 FAIL by design.
echo "== 83. profiles + design bake: the crawler copy sells nothing retired, published company URLs keep a page =="

REPO_ROOT83="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE="$SITE" UA="$UA" REPO_ROOT="$REPO_ROOT83" node --input-type=module -e '
const { SITE, UA, REPO_ROOT } = process.env;
import("node:fs").then(async (fs) => {
  const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
  let R;
  try { R = await import(`${REPO_ROOT}/scripts/prerender-retired.mjs`); }
  catch (e) { out("FAIL", `this checkout has no scripts/prerender-retired.mjs (${String(e).slice(0, 80)}): nothing below can be judged`); return; }
  const get = async (path, ms = 30000) => {
    try {
      const r = await fetch(path.startsWith("http") ? path : SITE + path, { headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(ms) });
      return { status: r.status, body: await r.text() };
    } catch (e) { return { status: 0, body: "", err: String(e).slice(0, 80) }; }
  };
  const titleOf = (h) => (h.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
  const canonOf = (h) => (h.match(/<link rel="canonical" href="([^"]*)"/) || [])[1] || "";
  const robotsOf = (h) => (h.match(/<meta name="robots" content="([^"]*)"/) || [])[1] || "";
  const pathOf = (u) => u.replace(/^https?:\/\/[^/]+/, "").replace(/\/$/, "") || "/";
  // The host answers a dotted last segment (careers.ulta.com) only with the
  // trailing slash the sitemap gives it; without it, 404.
  const urlOf = (p) => (/\.[^/]*$/.test(p) ? `${p}/` : p);

  const home = await get("/");
  if (home.status !== 200) { out("FAIL", `/ answered ${home.status} ${home.err || ""}: nothing below can be judged`); return; }
  const homeTitle = titleOf(home.body);
  const homeH1 = (home.body.match(/<h1[^>]*>([^<]*)<\/h1>/) || [])[1] || "";
  // The homepage file under another address: the same title and the
  // homepage canonical, or the very same bytes. Canonicals are compared by
  // path, so the section reads a local copy of the build the same way.
  const isHomeCopy = (b) => b === home.body || (titleOf(b) === homeTitle && pathOf(canonOf(b)) === "/");

  const sm = await get("/sitemap.xml");
  const locs = [...sm.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => pathOf(m[1].trim()));
  if (!locs.length) out("FAIL", `/sitemap.xml answered ${sm.status} with no URL: the guide and company samples below come from it`);
  const inSitemap = new Set(locs);
  const guides = locs.filter((p) => p.startsWith("/guides/"));
  const companies = locs.filter((p) => p.startsWith("/jobs/company/"));
  const threeCompanies = companies.length >= 3 ? [companies[0], companies[Math.floor(companies.length / 2)], companies[companies.length - 1]] : companies;

  // ---- C1: the retired claims, page by page ----
  const pages = ["/", "/pricing", "/agent", "/agents", "/guides", ...guides, ...threeCompanies];
  const docs = new Map();
  for (let i = 0; i < pages.length; i += 6) {
    await Promise.all(pages.slice(i, i + 6).map(async (p) => { docs.set(p, p === "/" ? home : await get(urlOf(p))); }));
  }
  const offenders = [];
  let read = 0;
  for (const p of pages) {
    const d = docs.get(p);
    if (!d || d.status !== 200) { offenders.push(`${p}: answered ${d ? d.status : 0}`); continue; }
    if (p !== "/" && isHomeCopy(d.body)) { offenders.push(`${p}: served the homepage file, not its own page`); continue; }
    const text = `${R.crawlerText(d.body)} ${JSON.stringify(R.jsonLdBlocks(d.body))}`;
    for (const [claim, m] of R.retiredClaimsIn(text, { sales: p === "/" || p === "/pricing" })) offenders.push(`${p}: ${claim} ("${m.slice(0, 60)}")`);
    read++;
  }
  for (const f of ["/llms.txt", "/llms-full.txt"]) {
    const d = await get(f, 60000);
    if (d.status !== 200 || d.body.length < 2000) { offenders.push(`${f}: answered ${d.status} with ${d.body.length} bytes`); continue; }
    for (const [claim, m] of R.retiredClaimsIn(d.body)) offenders.push(`${f}: ${claim} ("${m.slice(0, 60)}")`);
    read++;
  }
  const scope = `${read} documents: /, /pricing, /agent, /agents, /guides, ${guides.length} guides, ${threeCompanies.length} company pages (${threeCompanies.join(", ")}), /llms.txt, /llms-full.txt`;
  if (!guides.length) out("FAIL", "the sitemap names no /guides/ page: the guides were not read");
  if (threeCompanies.length < 3) out("FAIL", `the sitemap names ${companies.length} company pages: three were to be read`);
  if (offenders.length) out("FAIL", `C1 ${offenders.length} retired claim(s) or unreadable pages: ${offenders.slice(0, 12).join("; ")}${offenders.length > 12 ? "; ..." : ""}`);
  else out("PASS", `C1 no retired claim (the plan\x27s $99, the $29 pass, the $7 Apply Assistant, the Premium package, an agent that applies for you, verified openings, zero ghost) in ${scope}`);
  // Company titles: the count is open roles from their own hiring system.
  const titles = threeCompanies.map((p) => [p, titleOf((docs.get(p) || {}).body || "")]);
  const badTitles = titles.filter(([, t]) => !/ jobs: [\d,]+ open roles from their own hiring system$/.test(t));
  if (!titles.length) out("INFO", "C1 no company page to read a title from");
  else if (badTitles.length) out("FAIL", `C1 company titles not in the "X jobs: N open roles from their own hiring system" form: ${badTitles.map(([p, t]) => `${p} "${t}"`).join("; ")}`);
  else out("PASS", `C1 company titles name open roles from the employer\x27s own hiring system: ${titles.map(([p, t]) => `"${t}"`).join("; ")}`);

  // ---- C2: Offers on the selling pages ----
  const offerBad = [];
  let offerCount = 0;
  for (const p of ["/", "/pricing"]) {
    const d = docs.get(p);
    if (!d || d.status !== 200) continue;
    const blocks = R.jsonLdBlocks(d.body);
    for (const o of R.offersIn(blocks)) {
      offerCount++;
      for (const k of ["price", "highPrice"]) if (k in o && ["99", "29", "7"].includes(String(o[k]))) offerBad.push(`${p} Offer ${k} ${o[k]}`);
      if (/Agent|Pass|Premium|Assistant|\/agents\/pass/.test(JSON.stringify(o))) offerBad.push(`${p} Offer names "${JSON.stringify(o).match(/Agent|Pass|Premium|Assistant|\/agents\/pass/)[0]}"`);
    }
    if (p === "/" && blocks.some((b) => b && b["@type"] === "Service")) offerBad.push("/ carries a Service block");
  }
  if (offerBad.length) out("FAIL", `C2 ${offerBad.join("; ")}`);
  else if (!offerCount) out("INFO", "C2 / and /pricing carry no Offer at all: nothing to judge (the free scan\x27s Offer was expected)");
  else out("PASS", `C2 ${offerCount} Offer(s) on / and /pricing: none at $99, $29 or $7, none naming a retired product; no Service block on /`);

  // ---- C3: the one true line ----
  const lineMissing = ["/", "/agents", "/agent", "/pricing"].filter((p) => {
    const d = docs.get(p);
    return !d || d.status !== 200 || !R.crawlerText(d.body).includes(R.APPLY_YOURSELF_LINE);
  });
  if (lineMissing.length) out("FAIL", `C3 the apply-yourself line ("${R.APPLY_YOURSELF_LINE.slice(0, 70)}...") is missing on ${lineMissing.join(", ")}`);
  else out("PASS", "C3 /, /agents, /agent and /pricing say: search from your own AI (Claude, ChatGPT or Claude Code) and apply yourself on the employer\x27s site");
  if (/applies for you|submits? (?:applications? )?for you/i.test(homeH1)) out("FAIL", `C3 the homepage H1 still says the agent applies: "${homeH1}"`);
  else out("PASS", `C3 the homepage H1 is "${homeH1}"`);

  // ---- C4: once-published company URLs outside the current set ----
  const named = ["/jobs/company/MattelInc", "/jobs/company/10kbi", "/jobs/company/1800gotjunk", "/jobs/company/ABOUTYOUGmbH", "/jobs/company/APMGroup"];
  let seed = [];
  try { seed = fs.readFileSync(`${REPO_ROOT}/scripts/seo-seed/published-company-paths.txt`, "utf8").split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/jobs/company/")); } catch { seed = []; }
  const outOfSet = seed.filter((p) => !inSitemap.has(p) && !named.includes(p));
  const step = Math.max(1, Math.floor(outOfSet.length / 15));
  const sample = [...named, ...outOfSet.filter((_, i) => i % step === 0).slice(0, 15)];
  const res = { own: [], homeCopies: [], other: [], back: [] };
  for (let i = 0; i < sample.length; i += 6) {
    await Promise.all(sample.slice(i, i + 6).map(async (p) => {
      const d = await get(urlOf(p), 20000);
      const robots = robotsOf(d.body), canon = canonOf(d.body);
      if (d.status !== 200) res.other.push(`${p} answered ${d.status}`);
      else if (isHomeCopy(d.body)) res.homeCopies.push(p);
      else if (inSitemap.has(p)) {
        if (/noindex/.test(robots) || pathOf(canon) !== p) res.other.push(`${p} is in the sitemap but robots "${robots}", canonical "${canon}"`);
        else res.back.push(p);
      } else if (/noindex/.test(robots) && canon && pathOf(canon) === p) res.own.push(p);
      else res.other.push(`${p} is out of the sitemap but robots "${robots}", canonical "${canon || "none"}"`);
    }));
  }
  const tally = `${sample.length} once-published company URLs (${named.length} named by the S12 sweep, ${sample.length - named.length} from the seed of ${seed.length}): ${res.own.length} own noindex pages, ${res.back.length} back in the sitemap as indexable pages, ${res.homeCopies.length} homepage copies`;
  if (!seed.length) out("FAIL", "C4 this checkout has no scripts/seo-seed/published-company-paths.txt: the carry has no seed to judge against");
  if (res.homeCopies.length || res.other.length) out("FAIL", `C4 ${tally}; homepage copies: ${res.homeCopies.slice(0, 8).join(", ") || "none"}; other: ${res.other.slice(0, 6).join("; ") || "none"} (S12-022)`);
  else out("PASS", `C4 ${tally} (S12-022: each serves a page of its own, never the homepage file)`);

  // ---- C5: the ledger carries the companies map ----
  const led = await get("/prerender-ledger.json", 60000);
  let ledger = null; try { ledger = JSON.parse(led.body); } catch { ledger = null; }
  const comp = ledger && ledger.companies && typeof ledger.companies === "object" ? ledger.companies : null;
  if (!comp) out("FAIL", `C5 /prerender-ledger.json answered ${led.status} with no companies map: the next publish cannot carry what this one dropped`);
  else {
    const st = {}; for (const e of Object.values(comp)) st[e.state] = (st[e.state] || 0) + 1;
    const bad = Object.keys(st).filter((s) => !["live", "canonical", "noindex", "stub", "tombstone"].includes(s));
    if (bad.length) out("FAIL", `C5 the ledger\x27s companies map carries unknown states ${bad.join(", ")}: ${JSON.stringify(st)}`);
    else out("PASS", `C5 the ledger (built ${ledger.builtAt}) carries ${Object.keys(comp).length} company paths by state ${JSON.stringify(st)}`);
  }
}).catch((e) => console.log(`FAIL  section 83 crashed: ${String(e).slice(0, 160)}`));
'
