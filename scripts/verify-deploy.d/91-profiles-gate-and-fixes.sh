# shellcheck shell=bash
# ── 91. COMPANY PROFILES PHASE 0 (branch profiles/gate-and-fixes): the shared
# hiring-record gate on the employer page's Hiring Health card, the LCA line,
# the undated headcount, llms.txt's /companies line, and the identity claims
# V3/V3b the profile plan's section 9 names. A FRONTEND + MIGRATION deploy
# (20261012102000); no edge function changes, so there is no build to check.
# Sourced by scripts/verify-deploy.sh; J R MC probe build_ge $B $K $SITE $UA are
# in scope. Plan: reports/company-profiles-plan-2026-10-11.md, section 9.
#
# THE CLAIMS:
#   V7  Domino's, O'Reilly and Dollar Tree (lap_proven boards) print no
#       fourteen-day share, no median and no thirty-day share; Domino's prints
#       no ninety-day count.
#   V7b Eurofins (1,293 taken down, 0 back on 2026-10-11) prints no "not
#       re-listed" count, on the hydrated page or the baked one.
#   V3  a page whose token two vendors share ('clear') hides every employer-
#       level block, filings and similar employers included.
#   V3b get_company_financials answers no BX for 'blackstone' (a shooting-
#       sports board) and no CSGP for 'costar' (the board "Co–Star").
#   and the LCA line replaces the dead H-1B card, a headcount prints only with
#   its date (company_profiles.as_of exists, every row null), and llms.txt's
#   /companies line counts the pages the bake made indexable.
#
# HOW THE PAGE IS JUDGED WITHOUT A BROWSER. The card hydrates, so the served
# Jobs chunk (and the chunks it imports) is searched for the gate's own keys
# -- string literals survive minification -- and the live rows are judged by
# this checkout's gate module (src/lib/hiring-record-gate.ts, through tsx).
# Both must hold for a PASS: a gate that would refuse but is not served is a
# FAIL, and so is a served gate that this checkout's module would let through.
# Read-only: GETs and the anon RPC reads the page itself makes.
echo "== 91. profiles phase 0: hiring-record gate, LCA line, headcount, llms.txt, identity =="

REPO_ROOT91="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
rm -f /tmp/vd_91_*.json /tmp/vd_91_*.txt
SITE="$SITE" UA="$UA" B="$B" K="$K" node -e '
const { SITE, UA, B, K } = process.env;
const fs = require("fs");
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };
const get = async (url, headers = {}) => { try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(30000) }); return { status: r.status, body: await r.text() }; } catch (e) { return { status: 0, body: "" }; } };
const rpc = async (fn, body) => { try { const r = await fetch(`${B}/rest/v1/rpc/${fn}`, { method: "POST", headers: H, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }); let j = null; try { j = await r.json(); } catch { j = null; } return { status: r.status, body: j }; } catch { return { status: 0, body: null }; } };
(async () => {
  // The live rows the card would read.
  const curves = await rpc("get_company_fill_curve", { p_tokens: ["dominos", "oreillyauto~wd1~oreilly", "dollartree~wd5~dollartreeus", "Eurofins"] });
  fs.writeFileSync("/tmp/vd_91_curves.json", JSON.stringify(curves));
  // The served bundle: the entry names the Jobs chunk; the chunk names what it imports.
  const home = await get(`${SITE}/`);
  const main = (home.body.match(/\/assets\/index-[^"]*\.js/) || [])[0];
  let bundle = "";
  let jobsChunk = "";
  if (main) {
    const mainJs = (await get(`${SITE}${main}`)).body;
    jobsChunk = ((mainJs.match(/"\.\/Jobs-[A-Za-z0-9_-]*\.js"/) || [])[0] || "").replace(/"/g, "").replace(/^\.\//, "");
    if (jobsChunk) {
      const jobsJs = (await get(`${SITE}/assets/${jobsChunk}`)).body;
      bundle = jobsJs;
      const deps = [...new Set([...jobsJs.matchAll(/"\.\/([A-Za-z0-9_.-]+\.js)"/g)].map((m) => m[1]))].slice(0, 40);
      for (const d of deps) bundle += "\n" + (await get(`${SITE}/assets/${d}`)).body;
    }
  }
  fs.writeFileSync("/tmp/vd_91_bundle.txt", bundle);
  fs.writeFileSync("/tmp/vd_91_meta.json", JSON.stringify({ main: main || null, jobsChunk: jobsChunk || null }));
  // V3b: the SEC reader for the two boards that carried another company s figures.
  const fin = {};
  for (const t of ["blackstone", "costar", "clear"]) fin[t] = await rpc("get_company_financials", { p_token: t });
  fs.writeFileSync("/tmp/vd_91_financials.json", JSON.stringify(fin));
  // V3: which vendors serve the token clear (a list read, the board s own).
  let sources = null;
  try {
    const r = await fetch(`${B}/functions/v1/job-board`, { method: "POST", headers: { ...H, "x-rb-budget": "probe" }, body: JSON.stringify({ action: "list", companies: ["clear"], limit: 60, includeFacets: false }), signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    sources = Array.isArray(j?.jobs) ? [...new Set(j.jobs.map((x) => x.source).filter(Boolean))] : null;
  } catch { sources = null; }
  fs.writeFileSync("/tmp/vd_91_clear.json", JSON.stringify({ sources }));
  // The headcount column (a real column, so a missing one answers 400, not 401).
  const prof = await get(`${B}/rest/v1/company_profiles?select=as_of&as_of=not.is.null&limit=1`, H);
  fs.writeFileSync("/tmp/vd_91_profiles.json", JSON.stringify({ status: prof.status, body: prof.body.slice(0, 400) }));
  // llms.txt, /companies and the baked Eurofins page, as a crawler gets them.
  const llms = await get(`${SITE}/llms.txt`, { "User-Agent": UA });
  const comps = await get(`${SITE}/companies`, { "User-Agent": UA });
  const euro = await get(`${SITE}/jobs/company/Eurofins`, { "User-Agent": UA });
  fs.writeFileSync("/tmp/vd_91_pages.json", JSON.stringify({ llms: llms.body, llmsStatus: llms.status, companies: comps.body, companiesStatus: comps.status, eurofins: euro.body, eurofinsStatus: euro.status, homeTitle: (home.body.match(/<title>([^<]*)<\/title>/) || [])[1] || "" }));
})();
'
# This checkout's gate, applied to the live rows (tsx, as section 1 uses it).
( cd "$REPO_ROOT91" && npx --no-install tsx -e '
import("./src/lib/hiring-record-gate.ts").then((m) => {
  const fs = require("fs");
  let rows = [];
  try { const c = JSON.parse(fs.readFileSync("/tmp/vd_91_curves.json", "utf8")); rows = Array.isArray(c.body) ? c.body : []; } catch { rows = []; }
  const out = {};
  for (const r of rows) out[r.company_token] = m.hiringRecordGate(r);
  fs.writeFileSync("/tmp/vd_91_gate.json", JSON.stringify(out));
}).catch(() => {});
' ) 2>/dev/null

node -e '
const fs = require("fs");
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return d; } };
const out = (s, m) => console.log(`${s.padEnd(5)} ${m}`);
const curves = read("/tmp/vd_91_curves.json", { status: 0, body: null });
const gate = read("/tmp/vd_91_gate.json", null);
const meta = read("/tmp/vd_91_meta.json", {});
let bundle = ""; try { bundle = fs.readFileSync("/tmp/vd_91_bundle.txt", "utf8"); } catch { bundle = ""; }
const fin = read("/tmp/vd_91_financials.json", {});
const clear = read("/tmp/vd_91_clear.json", { sources: null });
const prof = read("/tmp/vd_91_profiles.json", { status: 0, body: "" });
const pages = read("/tmp/vd_91_pages.json", {});
const has = (s) => bundle.includes(s);
const rows = Array.isArray(curves.body) ? curves.body : [];
const rowOf = (t) => rows.find((r) => r.company_token === t) || null;
const served = !!meta.jobsChunk && bundle.length > 0;
if (!served) out("FAIL", `could not read the served Jobs chunk from the live entry (${meta.main || "no entry"}): the card claims below cannot be judged`);
if (!gate) out("FAIL", "this checkout could not run its own gate (npx tsx unavailable or src/lib/hiring-record-gate.ts missing): V7/V7b cannot be judged");
const lapServed = served && has("jobsPage.hhGate.lap");
const countsServed = served && has("jobsPage.hhGate.relist") && has("jobsPage.hhGate.countsTrackingLap");

// ---- V7: the lap boards ----
for (const [label, t] of [["Domino\x27s", "dominos"], ["O\x27Reilly", "oreillyauto~wd1~oreilly"], ["Dollar Tree", "dollartree~wd5~dollartreeus"]]) {
  const r = rowOf(t);
  const g = gate && gate[t];
  if (!r || !g) { out("INFO", `V7 ${label} (${t}): get_company_fill_curve answered no row (HTTP ${curves.status}), nothing to judge`); continue; }
  const facts = `bucket ${r.observability_bucket}, ${r.tracking_days} tracking days, sufficient ${r.sufficient}, 14-day share ${r.fill_rate_14}`;
  if (r.observability_bucket !== "lap_proven") out("INFO", `V7 ${label}: no longer a lap_proven board (${facts}); the gate may print its share now`);
  else if (g.share14.ok || g.median.ok) out("FAIL", `V7 ${label}: this checkout\x27s gate lets a lap_proven row print its 14-day share or median (${facts})`);
  else if (!lapServed) out("FAIL", `V7 ${label}: the served Jobs chunk lacks jobsPage.hhGate.lap, so the employer page still prints a 14-day share and a median on this lap board (${facts})`);
  else out("PASS", `V7 ${label}: no 14-day share and no median (gate: ${g.share14.reason}; served chunk carries the lap refusal) [${facts}]`);
  if (r.sufficient_30 === true && r.observability_bucket === "lap_proven") out("FAIL", `V7 ${label}: get_company_fill_curve calls the 30-day share sufficient on a lap_proven board`);
  else if (g.share30.ok) out("FAIL", `V7 ${label}: this checkout\x27s gate admits a 30-day share (${facts})`);
  else out("PASS", `V7 ${label}: no 30-day share (sufficient_30 ${r.sufficient_30}, reason ${r.insufficient_reason_30 ?? "none"}; gate: ${g.share30.reason})`);
}
{
  const r = rowOf("dominos");
  const g = gate && gate.dominos;
  if (r && g) {
    const facts = `${r.filled_roles_90d} taken down, ${r.relisted_roles_90d} back, ${r.tracking_days} tracking days`;
    if (g.counts90.ok) out("INFO", `V7 Domino\x27s: the gate now lets the 90-day count print (${facts}); the claim no longer applies`);
    else if (!countsServed) out("FAIL", `V7 Domino\x27s: the served Jobs chunk lacks the 90-day count refusals (jobsPage.hhGate.relist / countsTrackingLap): the card still prints ${r.filled_roles_90d} roles "taken down for good, not re-listed" (${facts})`);
    else out("PASS", `V7 Domino\x27s: no 90-day count (gate: ${g.counts90.reason}; ${facts})`);
  }
}

// ---- V7b: Eurofins ----
{
  const r = rowOf("Eurofins");
  const g = gate && gate.Eurofins;
  if (!r || !g) out("INFO", "V7b Eurofins: get_company_fill_curve answered no row; nothing to judge");
  else {
    const facts = `${r.filled_roles_90d} taken down, ${r.relisted_roles_90d} back, ${r.tracking_days} tracking days`;
    const control = Number(r.filled_roles_90d) >= 200 && Number(r.relisted_roles_90d) === 0;
    if (!control) out("INFO", `V7b Eurofins: re-listings are now seen on this board (${facts}); the relist control no longer applies`);
    else if (g.counts90.reason !== "relist detection unproven") out("FAIL", `V7b Eurofins: this checkout\x27s gate does not refuse ${facts} as relist detection unproven (said ${g.counts90.reason ?? "ok"})`);
    else if (!(served && has("jobsPage.hhGate.relist"))) out("FAIL", `V7b Eurofins: the served Jobs chunk lacks jobsPage.hhGate.relist, so the page still prints a "not re-listed" count over ${facts}`);
    else out("PASS", `V7b Eurofins: no "not re-listed" count on the employer page (relist detection unproven; ${facts})`);
  }
  const e = String(pages.eurofins || "");
  const baked = pages.eurofinsStatus === 200 && /Eurofins/i.test((e.match(/<title>([^<]*)<\/title>/) || [])[1] || "") && ((e.match(/<title>([^<]*)<\/title>/) || [])[1] || "") !== pages.homeTitle;
  if (!baked) out("INFO", `V7b Eurofins: no baked company page served at /jobs/company/Eurofins (HTTP ${pages.eurofinsStatus}); judged on the hydrated page only`);
  else if (/not re-listed|taken down for good|stayed down/i.test(e)) out("FAIL", "V7b Eurofins: the baked page prints a taken-down-and-not-re-listed count");
  else out("PASS", "V7b Eurofins: the baked page prints no taken-down-and-not-re-listed count");
}

// ---- V3b: SEC figures on the board they were matched for ----
for (const [t, ticker, who] of [["blackstone", "BX", "Blackstone Shooting Sports"], ["costar", "CSGP", "the board Co–Star"]]) {
  const a = fin[t] || { status: 0, body: null };
  if (a.status !== 200) out("FAIL", `V3b ${t}: get_company_financials answered HTTP ${a.status}; the card cannot be judged`);
  else if (a.body && a.body.ticker === ticker) out("FAIL", `V3b ${t}: get_company_financials still answers ${ticker} (${a.body.sec_name}) for ${who}`);
  else out("PASS", `V3b ${t}: no ${ticker} card for ${who} (reader answered ${a.body ? `ticker ${a.body.ticker}` : "null"})`);
}

// ---- V3: a page two vendors share hides every employer-level block ----
{
  const src = Array.isArray(clear.sources) ? clear.sources : null;
  if (!src) out("INFO", "V3 clear: the board list did not answer for clear; nothing to judge");
  else if (src.length < 2) out("INFO", `V3 clear: served by ${src.length} vendor(s) today (${src.join(", ") || "none"}); not a two-vendor page on this read`);
  else {
    out("INFO", `V3 clear: served by ${src.join(" and ")}, one token for two employers`);
    if (!served) out("FAIL", "V3 clear: the served Jobs chunk could not be read");
    else if (!/collision/i.test(bundle)) out("FAIL", "V3 clear: the served Jobs chunk carries no collision decision, so a page two vendors share still shows one employer\x27s filings, SEC card and similar employers (baseline 2026-10-11: no such literal)");
    else out("PASS", "V3 clear: the served Jobs chunk carries the collision decision that hides the employer-level blocks (intel, SEC, Hiring Health, filings, LCA, similar)");
    const c = fin.clear || {};
    out("INFO", `V3 clear: get_company_financials answers ${c.body ? `ticker ${c.body.ticker}` : "null"} (the page hides the card on a two-vendor token either way)`);
  }
}

// ---- the LCA line, the headcount, llms.txt ----
if (!served) out("FAIL", "LCA line: the served Jobs chunk could not be read");
else if (has("jobsPage.h1b.chip")) out("FAIL", "LCA line: the served chunk still carries the dead H-1B card (jobsPage.h1b.chip)");
else if (!has("jobsPage.lcaWhyThisCellEmployer")) out("FAIL", "LCA line: the served chunks lack jobsPage.lcaWhyThisCellEmployer: the employer page has no filed-wage line");
else out("PASS", "LCA line: the employer page prints the working reader\x27s line (quarter, file and date from the row); the dead H-1B card is gone");
if (prof.status === 200) {
  let dated = [];
  try { dated = JSON.parse(prof.body); } catch { dated = []; }
  out("PASS", "headcount: company_profiles.as_of exists (20261012102000 applied)");
  out("INFO", `headcount: ${Array.isArray(dated) && dated.length ? "at least one row is dated now" : "no row is dated, so no headcount prints anywhere"}`);
} else if ((prof.status === 401 || prof.status === 403) && /"42501"/.test(String(prof.body))) {
  // 20261012130000 took the table away from clients; its own self-check
  // raises unless company_profiles.as_of exists, and section 81 proves the
  // lock is live, so the refusal itself says the column is there.
  out("PASS", "headcount: company_profiles is refused to anon (42501, locked by 20261012130000, whose self-check requires as_of; section 81 checks the lock)");
} else out("FAIL", `headcount: company_profiles.as_of answered HTTP ${prof.status} (${String(prof.body).slice(0, 120)}): 20261012102000 is not applied`);
if (served && has("jobsPage.intel.asOf")) out("PASS", "headcount: the served chunk prints a count only beside its date (jobsPage.intel.asOf)");
else out("FAIL", "headcount: the served chunk lacks jobsPage.intel.asOf: an undated headcount may still print");
{
  const l = String(pages.llms || "");
  const m = l.match(/The ([\d,]+ )?employers this site gives a page of their own/);
  if (pages.llmsStatus !== 200) out("FAIL", `llms.txt answered HTTP ${pages.llmsStatus}`);
  else if (!m) out("FAIL", "llms.txt: the /companies line does not say how many employers have a page of their own");
  else if (/companies\)[^\n]*live count/i.test(l)) out("FAIL", "llms.txt: the /companies line still promises a live count");
  else {
    const n = m[1] ? Number(m[1].replace(/[, ]/g, "")) : null;
    const linked = pages.companiesStatus === 200 ? (String(pages.companies).match(/<li><a href="\/jobs\/company\//g) || []).length : null;
    if (n === null) out("INFO", "llms.txt: the /companies line carries no number (the bake that built it counted none)");
    else if (linked === null || linked === 0) out("INFO", `llms.txt: the /companies line says ${n}; /companies could not be counted (HTTP ${pages.companiesStatus})`);
    else if (n !== linked) out("FAIL", `llms.txt says ${n} employers have a page of their own; /companies links ${linked}`);
    else out("PASS", `llms.txt: ${n} employers with a page of their own, the number /companies links`);
  }
}
'
