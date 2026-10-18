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
#       guide the sitemap names, /trust, /privacy, /terms, /llms.txt,
#       /llms-full.txt and three company pages, prose and JSON-LD both, by
#       this checkout's list (scripts/prerender-retired.mjs, the list the bake
#       checks its own output against). A company title is one of the bake's
#       forms (the full "X jobs: N open roles from their own hiring system",
#       the shorter ones the 68-character budget gives, the agency and
#       USAJOBS forms), never "verified".
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
#   C6  /jobs/company/usajobs is the federal listing site's page (the hub's
#       H1, no "own hiring system", no "is hiring in"), and a staffing
#       agency's board (/jobs/company/surge) carries the SPA's disclosure.
#   C7  THE PAGE REACT RENDERS. React replaces the baked #root, so every
#       visitor and Googlebot (which runs scripts) read the SPA's strings, not
#       the bake's: the served entry, the English locale chunks and the Index
#       chunk carry none of the retired sentences the home hero, its strip,
#       the FAQ and /trust used to render ("The agent applies for you",
#       "submits where employers allow", the pass line, the Morning Queue,
#       "the employers it applies to for you", "re-verified all day"). C3
#       read only the pre-script H1 and passed on the bake alone.
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
  const pages = ["/", "/pricing", "/agent", "/agents", "/guides", ...guides, "/trust", "/privacy", "/terms", ...threeCompanies];
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
  const scope = `${read} documents: /, /pricing, /agent, /agents, /guides, ${guides.length} guides, /trust, /privacy, /terms, ${threeCompanies.length} company pages (${threeCompanies.join(", ")}), /llms.txt, /llms-full.txt`;
  if (!guides.length) out("FAIL", "the sitemap names no /guides/ page: the guides were not read");
  if (threeCompanies.length < 3) out("FAIL", `the sitemap names ${companies.length} company pages: three were to be read`);
  if (offenders.length) out("FAIL", `C1 ${offenders.length} retired claim(s) or unreadable pages: ${offenders.slice(0, 12).join("; ")}${offenders.length > 12 ? "; ..." : ""}`);
  else out("PASS", `C1 no retired claim (the plan\x27s $99, the $29 pass, the $7 Apply Assistant, the Premium package, an agent that applies for you, verified openings, zero ghost) in ${scope}`);
  // Company titles: one of the forms the bake writes. The 68-character budget gives
  // about one page in five the short form ("Albertsons Companies jobs: 6,239
  // open roles", "National Federation of Independent Business (NFIB) jobs"),
  // so requiring the full form failed a correct deploy whenever the sample
  // hit one. The real test is the basis and no "verified".
  const TITLE_OK = / jobs(?:: [\d,]+ (?:open roles(?: from their own hiring system)?|roles(?: listed by a staffing agency)?)|: (?:open roles from their own hiring system|roles listed by a staffing agency))?$|^Federal openings listed on USAJOBS(?:: [\d,]+ roles)?$/;
  const titles = threeCompanies.map((p) => [p, titleOf((docs.get(p) || {}).body || "")]);
  const badTitles = titles.filter(([, t]) => !TITLE_OK.test(t) || /verified/i.test(t));
  if (!titles.length) out("INFO", "C1 no company page to read a title from");
  else if (badTitles.length) out("FAIL", `C1 company titles not in one of the bake\x27s forms, or saying "verified": ${badTitles.map(([p, t]) => `${p} "${t}"`).join("; ")}`);
  else out("PASS", `C1 company titles name open roles in the bake\x27s forms, none "verified": ${titles.map(([p, t]) => `"${t}"`).join("; ")}`);

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
  const res = { own: [], homeCopies: [], other: [], back: [], canon: [] };
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
      // ONE EMPLOYER, ONE PAGE: a smaller board of an employer
      // whose larger board carries the page serves its own document with
      // its canonical on that larger page (the ledger state "canonical").
      // That is a page of its own, never the homepage file, as long as the
      // page it points to is one the sitemap names.
      else if (canon && pathOf(canon) !== p && pathOf(canon) !== "/" && inSitemap.has(pathOf(canon))) res.canon.push(`${p} -> ${pathOf(canon)}`);
      else res.other.push(`${p} is out of the sitemap but robots "${robots}", canonical "${canon || "none"}"`);
    }));
  }
  const tally = `${sample.length} once-published company URLs (${named.length} named by the S12 sweep, ${sample.length - named.length} from the seed of ${seed.length}): ${res.own.length} own noindex pages, ${res.canon.length} canonical to a larger board of the same employer that the sitemap names${res.canon.length ? " (" + res.canon.slice(0, 3).join(", ") + ")" : ""}, ${res.back.length} back in the sitemap as indexable pages, ${res.homeCopies.length} homepage copies`;
  if (!seed.length) out("FAIL", "C4 this checkout has no scripts/seo-seed/published-company-paths.txt: the carry has no seed to judge against");
  if (res.homeCopies.length || res.other.length) out("FAIL", `C4 ${tally}; homepage copies: ${res.homeCopies.slice(0, 8).join(", ") || "none"}; other: ${res.other.slice(0, 6).join("; ") || "none"} (S12-022)`);
  else out("PASS", `C4 ${tally} (S12-022: each serves a page of its own, never the homepage file)`);

  // ---- C6: USAJOBS and an agency board are baked as what they are ----
  {
    const u = await get("/jobs/company/usajobs");
    const ut = R.crawlerText(u.body);
    if (u.status !== 200 || isHomeCopy(u.body)) out("FAIL", `C6 /jobs/company/usajobs answered ${u.status}${isHomeCopy(u.body) ? " with the homepage file" : ""}`);
    else if (!/Federal openings listed on USAJOBS/.test(ut) || /own hiring system|is hiring in/.test(`${ut} ${titleOf(u.body)}`)) out("FAIL", `C6 /jobs/company/usajobs is baked as an employer: title "${titleOf(u.body)}"${/is hiring in/.test(ut) ? ", \"is hiring in\"" : ""}${/own hiring system/.test(ut) ? ", \"own hiring system\"" : ""}`);
    else out("PASS", `C6 /jobs/company/usajobs is the federal listing site\x27s page ("${titleOf(u.body)}"), with no own-hiring-system or is-hiring-in wording`);
    const a = await get("/jobs/company/surge");
    const at = R.crawlerText(a.body);
    if (a.status !== 200 || isHomeCopy(a.body)) out("INFO", `C6 /jobs/company/surge answered ${a.status}${isHomeCopy(a.body) ? " with the homepage file" : ""}: no agency page to judge`);
    else if (!/This is a staffing agency\x27s board/.test(at) || /is hiring in/.test(at)) out("FAIL", `C6 /jobs/company/surge (a staffing agency, agency: true in the catalogue) carries no agency disclosure, or says "is hiring in"`);
    else out("PASS", "C6 /jobs/company/surge says it is a staffing agency\x27s board whose roles are usually for its clients");
  }

  // ---- C7: the strings React renders ----
  {
    const RETIRED_SPA = [
      "The agent applies for you", "submits where employers allow", "Live job board + AI apply agent", "the agent can submit for you",
      "pass gives your agent", "Buy or open your pass", "where the apply agent prepares a shortlist", "To have your agent request applications",
      "the employers it applies to for you", "if you turn on the apply agent", "re-verified all day",
    ];
    const main = (home.body.match(/\/assets\/index-[^"]*\.js/) || [])[0];
    if (!main) out("FAIL", "C7 the served / names no /assets/index-*.js entry: the React strings were not read");
    else {
      const mainJs = (await get(main, 60000)).body;
      const chunks = [...new Set([...mainJs.matchAll(/"\.\/((?:en(?:-GB)?|Index)-[A-Za-z0-9_-]+\.js)"/g)].map((m) => m[1]))].slice(0, 12);
      let bundle = mainJs;
      for (const c of chunks) bundle += "\n" + (await get(`/assets/${c}`, 60000)).body;
      const found = RETIRED_SPA.filter((x) => bundle.includes(x));
      const hasIndex = chunks.some((c) => c.startsWith("Index-"));
      if (!bundle.includes("Live jobs, straight from employers")) out("FAIL", `C7 the entry and its ${chunks.length} English/Index chunks do not carry the home hero\x27s headline: the English strings were not found`);
      else if (found.length) out("FAIL", `C7 the React bundle still renders ${found.length} retired sentence(s): ${found.map((x) => `"${x}"`).join(", ")}`);
      else out("PASS", `C7 the React entry and ${chunks.length} English/Index chunk(s)${hasIndex ? "" : " (no Index chunk found: the entry carries it)"} render none of the ${RETIRED_SPA.length} retired home, FAQ and trust sentences`);
    }
  }

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
